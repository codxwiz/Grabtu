import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request, RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

type Auth = RequestHandler;

const webhookInput = z.object({
  eventId: z.string().min(4).max(200).optional(),
  event: z.string().min(3).max(100),
  restaurantId: z.string().optional(),
  plan: z.string().optional(),
  periodEnd: z.union([z.coerce.date(), z.number()]).optional(),
  invoiceId: z.string().optional(),
  amount: z.number().int().nonnegative().optional(),
  payload: z.any().optional(),
});

function canonicalPlan(plan: string) {
  return plan === "pro" ? "business" : plan;
}

function normalizeEvent(event: string) {
  switch (event) {
    case "subscription.activated":
    case "subscription.active":
      return "subscription.active";
    case "subscription.cancelled":
    case "subscription.cancelled_by_customer":
      return "subscription.cancelled";
    case "subscription.charged":
      return "subscription.charged";
    case "subscription.pending":
      return "subscription.pending";
    case "subscription.halted":
      return "subscription.halted";
    case "subscription.completed":
      return "subscription.completed";
    case "subscription.authenticated":
      return "subscription.authenticated";
    case "subscription.paused":
      return "subscription.paused";
    case "subscription.resumed":
      return "subscription.active";
    case "payment.failed":
      return "invoice.payment_failed";
    case "payment.captured":
      return "invoice.paid";
    default:
      return event;
  }
}

function planFromProviderId(value: unknown) {
  const id = String(value || "");
  if (id && id === process.env.RAZORPAY_PLAN_STARTER_ID) return "starter";
  if (id && id === process.env.RAZORPAY_PLAN_GROWTH_ID) return "growth";
  if (id && (id === process.env.RAZORPAY_PLAN_BUSINESS_ID || id === process.env.RAZORPAY_PLAN_PRO_ID)) return "business";
  return "";
}

function toDate(value: unknown) {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value > 1e12 ? value : value * 1000);
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function extractNotes(payload: Record<string, unknown> | undefined) {
  const payment = payload?.payment && typeof payload.payment === "object" ? payload.payment as Record<string, unknown> : undefined;
  const invoice = payload?.invoice && typeof payload.invoice === "object" ? payload.invoice as Record<string, unknown> : undefined;
  const subscription = payload?.subscription && typeof payload.subscription === "object" ? payload.subscription as Record<string, unknown> : undefined;
  const paymentEntity = payment?.entity && typeof payment.entity === "object" ? payment.entity as Record<string, unknown> : undefined;
  const invoiceEntity = invoice?.entity && typeof invoice.entity === "object" ? invoice.entity as Record<string, unknown> : undefined;
  const subscriptionEntity = subscription?.entity && typeof subscription.entity === "object" ? subscription.entity as Record<string, unknown> : undefined;
  const notes = [subscriptionEntity?.notes, invoiceEntity?.notes, paymentEntity?.notes].find(entry => entry && typeof entry === "object" && !Array.isArray(entry)) as Record<string, unknown> | undefined;
  return { paymentEntity, invoiceEntity, subscriptionEntity, notes };
}

function normalizeWebhook(req: Request, data: z.infer<typeof webhookInput>) {
  const payload = data.payload;
  const { paymentEntity, invoiceEntity, subscriptionEntity, notes } = extractNotes(payload);
  const providerEventId =
    req.header("x-razorpay-event-id")
    || req.header("x-white_label-event-id")
    || data.eventId
    || `${data.event}:${String(invoiceEntity?.id || paymentEntity?.id || subscriptionEntity?.id || Date.now())}`;
  const restaurantId = String(data.restaurantId || notes?.restaurantId || "");
  const plan = canonicalPlan(String(data.plan || planFromProviderId(subscriptionEntity?.plan_id) || notes?.plan || ""));
  const providerSubscriptionId = String(subscriptionEntity?.id || invoiceEntity?.subscription_id || paymentEntity?.subscription_id || "");
  const cycleReference = data.event === "subscription.pending" || data.event === "subscription.halted"
    ? `${data.event}-${String(subscriptionEntity?.charge_at || subscriptionEntity?.current_end || providerEventId)}`
    : `charge-${String(subscriptionEntity?.paid_count || providerEventId)}`;
  const hasProviderInvoice = Boolean(data.invoiceId || invoiceEntity?.id || paymentEntity?.invoice_id);
  const invoiceNumber = String(data.invoiceId || invoiceEntity?.id || paymentEntity?.invoice_id || (providerSubscriptionId ? `${providerSubscriptionId}-${cycleReference}` : `EQ-${providerEventId}`));
  const providerPaymentId = String(paymentEntity?.id || "");
  const periodStart = toDate(subscriptionEntity?.current_start || invoiceEntity?.billing_start || invoiceEntity?.period_start);
  const periodEnd = toDate(data.periodEnd || subscriptionEntity?.current_end || subscriptionEntity?.ended_at || invoiceEntity?.billing_end || invoiceEntity?.period_end || subscriptionEntity?.charge_at);
  const amountPaise = Number(data.amount ?? paymentEntity?.amount ?? invoiceEntity?.amount_paid ?? invoiceEntity?.amount ?? 0);
  const amount = data.amount !== undefined ? data.amount : Math.round(amountPaise / 100);
  const currency = String(paymentEntity?.currency || invoiceEntity?.currency || "INR");
  const hostedUrl = String(invoiceEntity?.short_url || invoiceEntity?.hosted_url || "") || null;
  return { providerEventId, restaurantId, plan, invoiceNumber, hasProviderInvoice, providerSubscriptionId, providerPaymentId, periodStart, periodEnd, amount, currency, hostedUrl };
}

function isUniqueError(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");
}

function rawBodyText(req: Request & { rawBody?: Buffer }) {
  return req.rawBody?.length ? req.rawBody.toString("utf8") : JSON.stringify(req.body);
}

export const billingWebhookInternals = { normalizeEvent, normalizeWebhook };

export function registerBillingHardening(app: Express, prisma: PrismaClient, authenticate: Auth, authorize: (...roles: string[]) => Auth, authenticateMaster: Auth, onRestaurantChanged?: (restaurantId: string, scope: string) => void) {
  app.post("/api/billing/webhook", async (req: Request & { rawBody?: Buffer }, res) => {
    const signature = String(req.header("x-white_label-billing-signature") || req.header("x-razorpay-signature") || "");
    const secret = process.env.BILLING_WEBHOOK_SECRET || "local-billing-secret";
    const body = rawBodyText(req);
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return res.status(401).json({ message: "Invalid billing signature" });
    }

    const parsed = webhookInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid billing event" });
    const event = normalizeEvent(parsed.data.event);
    const normalized = normalizeWebhook(req, parsed.data);

    try {
      let changedRestaurantId = "";
      await prisma.$transaction(async tx => {
        await tx.billingWebhookEvent.create({ data: { providerEventId: normalized.providerEventId, eventType: event, payload: req.body } });
        const now = new Date();
        const matchedSubscription = normalized.providerSubscriptionId
          ? await tx.subscription.findFirst({ where: { providerSubscriptionId: normalized.providerSubscriptionId } })
          : null;
        const restaurantId = normalized.restaurantId || matchedSubscription?.restaurantId || "";
        if (!restaurantId) throw new Error("RESTAURANT_REFERENCE_MISSING");
        changedRestaurantId = restaurantId;
        const restaurant = await tx.restaurant.findUnique({ where: { id: restaurantId } });
        if (!restaurant) throw new Error("RESTAURANT_NOT_FOUND");
        const currentSubscription = await tx.subscription.findUnique({ where: { restaurantId: restaurant.id } });
        if ((event === "invoice.paid" || event === "invoice.payment_failed") && !normalized.providerSubscriptionId) {
          if (event === "invoice.paid" && normalized.providerPaymentId) await tx.order.updateMany({ where: { restaurantId: restaurant.id, providerPaymentId: normalized.providerPaymentId }, data: { paymentStatus: "PAID", paymentConfirmedAt: now, refundStatus: null } });
          await tx.billingWebhookEvent.update({ where: { providerEventId: normalized.providerEventId }, data: { processedAt: now } });
          return;
        }
        if (normalized.providerSubscriptionId && currentSubscription?.providerSubscriptionId && currentSubscription.providerSubscriptionId !== normalized.providerSubscriptionId) {
          await tx.billingWebhookEvent.update({ where: { providerEventId: normalized.providerEventId }, data: { processedAt: now } });
          return;
        }

        const periodStart = normalized.periodStart || currentSubscription?.currentPeriodStart || now;
        const periodEnd = normalized.periodEnd || currentSubscription?.currentPeriodEnd || new Date(now.getTime() + 30 * 86400000);
        const plan = normalized.plan || currentSubscription?.plan || canonicalPlan(restaurant.plan);
        const subscription = await tx.subscription.upsert({
          where: { restaurantId: restaurant.id },
          create: { restaurantId: restaurant.id, provider: "razorpay", providerSubscriptionId: normalized.providerSubscriptionId || null, plan, status: "PAST_DUE", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
          update: { provider: "razorpay", ...(normalized.providerSubscriptionId ? { providerSubscriptionId: normalized.providerSubscriptionId } : {}), ...(normalized.plan ? { plan } : {}), currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
        });

        const reconcileInvoice = async (status: "paid" | "failed") => {
          const existing = await tx.invoice.findUnique({ where: { number: normalized.invoiceNumber } });
          if (existing && existing.restaurantId !== restaurant.id) throw new Error("INVOICE_OWNERSHIP_MISMATCH");
          await tx.invoice.upsert({
            where: { number: normalized.invoiceNumber },
            create: { restaurantId: restaurant.id, subscriptionId: subscription.id, number: normalized.invoiceNumber, status, amount: normalized.amount, currency: normalized.currency, periodStart, periodEnd, hostedUrl: normalized.hostedUrl, paidAt: status === "paid" ? now : null },
            update: { subscriptionId: subscription.id, status, amount: normalized.amount, currency: normalized.currency, periodStart, periodEnd, hostedUrl: normalized.hostedUrl, paidAt: status === "paid" ? now : null },
          });
        };

        if (event === "invoice.payment_failed" || event === "subscription.pending" || event === "subscription.halted") {
          if (normalized.hasProviderInvoice || normalized.amount > 0) await reconcileInvoice("failed");
          const halted = event === "subscription.halted";
          await tx.restaurant.update({
            where: { id: restaurant.id },
            data: {
              planStatus: "past_due",
              featuresLocked: true,
              featureLockReason: halted ? "Razorpay exhausted payment retries. Update the payment method to restore access." : "Payment is pending or failed. Complete the Razorpay payment to restore access.",
            },
          });
          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              status: "PAST_DUE",
              retryCount: { increment: 1 },
              lastPaymentError: halted ? "Razorpay payment retries exhausted" : "Razorpay subscription payment pending",
              nextRetryAt: halted ? null : new Date(now.getTime() + 24 * 60 * 60 * 1000),
            },
          });
        } else if (event === "subscription.cancelled") {
          const trialStillActive = currentSubscription?.status === "TRIALING" && currentSubscription.currentPeriodEnd > now;
          await tx.restaurant.update({
            where: { id: restaurant.id },
            data: trialStillActive ? {
              planStatus: "trialing",
              featuresLocked: false,
              featureLockReason: null,
            } : {
              planStatus: "cancelled",
              featuresLocked: true,
              featureLockReason: "Subscription cancelled. Choose a paid plan to restore access.",
            },
          });
          await tx.subscription.update({
            where: { id: subscription.id },
            data: trialStillActive
              ? { status: "TRIALING", cancelAtPeriodEnd: true }
              : { status: "CANCELLED", cancelAtPeriodEnd: false },
          });
        } else if (event === "subscription.completed") {
          await tx.restaurant.update({ where: { id: restaurant.id }, data: { planStatus: "expired", featuresLocked: true, featureLockReason: "Subscription completed. Choose a plan to continue using Restaurant Platform." } });
          await tx.subscription.update({ where: { id: subscription.id }, data: { status: "EXPIRED", cancelAtPeriodEnd: false, nextRetryAt: null } });
        } else if (event === "subscription.paused") {
          await tx.restaurant.update({ where: { id: restaurant.id }, data: { planStatus: "paused", featuresLocked: true, featureLockReason: "Subscription is paused in Razorpay. Resume it to restore access." } });
          await tx.subscription.update({ where: { id: subscription.id }, data: { status: "PAST_DUE", nextRetryAt: null, lastPaymentError: "Razorpay subscription paused" } });
        } else if (event === "subscription.authenticated") {
          const trialStillActive = currentSubscription?.status === "TRIALING" && currentSubscription.currentPeriodEnd > now;
          if (trialStillActive) await tx.restaurant.update({
            where: { id: restaurant.id },
            data: { plan, planStatus: "trialing", featuresLocked: false, featureLockReason: null },
          });
          await tx.subscription.update({ where: { id: subscription.id }, data: { plan, status: trialStillActive ? "TRIALING" : "PAST_DUE", retryCount: 0, lastPaymentError: null, nextRetryAt: null } });
        } else if (event === "subscription.updated") {
          await tx.restaurant.update({ where: { id: restaurant.id }, data: { plan } });
          await tx.subscription.update({ where: { id: subscription.id }, data: { plan, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd } });
        } else if (event === "subscription.active" || event === "subscription.charged" || event === "invoice.paid") {
          if (event === "subscription.charged" || event === "invoice.paid" || normalized.amount > 0) await reconcileInvoice("paid");
          await tx.restaurant.update({
            where: { id: restaurant.id },
            data: {
              plan,
              planStatus: "active",
              trialEndsAt: null,
              featuresLocked: false,
              featureLockReason: null,
            },
          });
          if (normalized.providerPaymentId) {
            await tx.order.updateMany({
              where: { restaurantId: restaurant.id, providerPaymentId: normalized.providerPaymentId },
              data: { paymentStatus: "PAID", paymentConfirmedAt: now, refundStatus: null },
            });
          }
          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              status: "ACTIVE",
              plan,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              retryCount: 0,
              lastPaymentError: null,
              nextRetryAt: null,
            },
          });
        }

        await tx.billingWebhookEvent.update({
          where: { providerEventId: normalized.providerEventId },
          data: { processedAt: new Date() },
        });
      });
      if(changedRestaurantId)onRestaurantChanged?.(changedRestaurantId,`billing:${event}`);
      return res.json({ received: true, status: event });
    } catch (error) {
      if (isUniqueError(error)) return res.json({ received: true, duplicate: true });
      if (error instanceof Error && error.message === "RESTAURANT_NOT_FOUND") {
        return res.status(404).json({ message: "Restaurant not found" });
      }
      if (error instanceof Error && error.message === "RESTAURANT_REFERENCE_MISSING") return res.status(400).json({ message: "Billing event is missing a restaurant reference" });
      if (error instanceof Error && error.message === "INVOICE_OWNERSHIP_MISMATCH") return res.status(409).json({ message: "Invoice reference belongs to another account" });
      throw error;
    }
  });

  app.post("/api/admin/billing/refund/:orderId",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:any,res)=>{const order=await prisma.order.findFirst({where:{displayId:String(req.params.orderId),restaurantId:req.staff.restaurantId}});if(!order)return res.status(404).json({message:"Order not found"});if(order.paymentStatus!=="PAID")return res.status(409).json({message:"Only paid orders can be refunded"});if(order.refundStatus==="processed")return res.json(order);const keyId=process.env.RAZORPAY_KEY_ID,secret=process.env.RAZORPAY_KEY_SECRET;if(!keyId||!secret||!order.providerPaymentId)return res.status(503).json({message:"Razorpay payment reference is not configured"});const response=await fetch(`https://api.razorpay.com/v1/payments/${order.providerPaymentId}/refund`,{method:"POST",headers:{Authorization:`Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`,"Content-Type":"application/json"},body:JSON.stringify({amount:order.totalAmount*100,notes:{orderId:order.displayId}})});if(!response.ok)return res.status(502).json({message:"Razorpay refund failed"});const refund=await response.json() as {id:string;status?:string};res.json(await prisma.order.update({where:{id:order.id},data:{refundId:refund.id,refundStatus:refund.status||"processed",paymentStatus:"REFUNDED"}}))});
  app.get("/api/admin/billing/reconcile",authenticate,authorize("OWNER"),async(req:any,res)=>{const restaurantId=req.staff.restaurantId;const [paid,pending,refunded]=await Promise.all([prisma.order.count({where:{restaurantId,paymentStatus:"PAID"}}),prisma.order.count({where:{restaurantId,paymentStatus:"PENDING"}}),prisma.order.count({where:{restaurantId,refundStatus:{not:null}}})]);res.json({paid,pending,refunded})});
}
