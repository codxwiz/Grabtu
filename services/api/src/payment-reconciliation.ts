import type { PrismaClient } from "@prisma/client";

export type ProviderFinancialState = {
  reference: string;
  orderReference?: string | null;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  error?: string | null;
};

export type ReconciliationDecision = {
  status: "MATCHED" | "MISMATCH" | "PENDING" | "FAILED";
  mismatchCode: string | null;
};

export function classifyProviderState(input: {
  kind: "PAYMENT" | "REFUND";
  expectedAmount: number;
  expectedCurrency: string;
  expectedOrderReference?: string | null;
  provider: ProviderFinancialState;
}): ReconciliationDecision {
  if (input.provider.amount == null) return { status: "MISMATCH", mismatchCode: "PROVIDER_AMOUNT_MISSING" };
  if (!input.provider.currency) return { status: "MISMATCH", mismatchCode: "PROVIDER_CURRENCY_MISSING" };
  if (input.expectedOrderReference && !input.provider.orderReference) return { status: "MISMATCH", mismatchCode: "PROVIDER_ORDER_REFERENCE_MISSING" };
  if (input.provider.amount != null && input.provider.amount !== input.expectedAmount) {
    return { status: "MISMATCH", mismatchCode: "AMOUNT_MISMATCH" };
  }
  if (input.provider.currency && input.provider.currency.toUpperCase() !== input.expectedCurrency.toUpperCase()) {
    return { status: "MISMATCH", mismatchCode: "CURRENCY_MISMATCH" };
  }
  if (input.expectedOrderReference && input.provider.orderReference && input.provider.orderReference !== input.expectedOrderReference) {
    return { status: "MISMATCH", mismatchCode: "ORDER_REFERENCE_MISMATCH" };
  }
  const providerStatus = input.provider.status?.toLowerCase();
  if (input.kind === "PAYMENT") {
    if (providerStatus === "captured") return { status: "MATCHED", mismatchCode: null };
    if (providerStatus === "failed") return { status: "FAILED", mismatchCode: "PROVIDER_PAYMENT_FAILED" };
  } else {
    if (providerStatus === "processed") return { status: "MATCHED", mismatchCode: null };
    if (providerStatus === "failed") return { status: "FAILED", mismatchCode: "PROVIDER_REFUND_FAILED" };
  }
  return { status: "PENDING", mismatchCode: null };
}

function nextRetry(attempts: number) {
  const seconds = Math.min(3600, 30 * 2 ** Math.min(attempts, 7));
  return new Date(Date.now() + seconds * 1000);
}

export async function recordManualUpiReview(
  prisma: PrismaClient,
  input: { restaurantId: string; orderId: string; paymentAttemptId?: string; expectedAmount: number; localStatus: string },
) {
  return prisma.paymentReconciliation.upsert({
    where: { reconciliationKey: `manual_upi:payment:${input.orderId}` },
    create: {
      reconciliationKey: `manual_upi:payment:${input.orderId}`,
      restaurantId: input.restaurantId,
      orderId: input.orderId,
      provider: "manual_upi",
      kind: "PAYMENT",
      status: "MANUAL_REVIEW",
      providerReference: input.paymentAttemptId,
      expectedAmount: input.expectedAmount,
      currency: "INR",
      localStatus: input.localStatus,
      details: { verification: "restaurant_external_confirmation" },
    },
    update: {
      status: "MANUAL_REVIEW",
      providerReference: input.paymentAttemptId,
      expectedAmount: input.expectedAmount,
      localStatus: input.localStatus,
      mismatchCode: null,
      nextCheckAt: null,
      resolvedAt: null,
      resolvedBy: null,
    },
  });
}

export async function resolveManualUpiReview(
  prisma: PrismaClient,
  input: { orderId: string; status: "paid" | "pending"; resolvedBy: string },
) {
  return prisma.paymentReconciliation.updateMany({
    where: { orderId: input.orderId, provider: "manual_upi", kind: "PAYMENT" },
    data: input.status === "paid"
      ? { status: "MATCHED", localStatus: "PAID", resolvedAt: new Date(), resolvedBy: input.resolvedBy, nextCheckAt: null }
      : { status: "MANUAL_REVIEW", localStatus: "PENDING", resolvedAt: null, resolvedBy: null, nextCheckAt: null },
  });
}

export async function recordProviderReconciliation(
  prisma: PrismaClient,
  input: {
    restaurantId: string;
    orderId: string;
    kind: "PAYMENT" | "REFUND";
    provider: string;
    expectedAmount: number;
    expectedCurrency: string;
    expectedOrderReference?: string | null;
    localStatus: string;
    providerState: ProviderFinancialState;
    source: "checkout" | "webhook" | "scheduled" | "manual";
  },
) {
  const decision = classifyProviderState({
    kind: input.kind,
    expectedAmount: input.expectedAmount,
    expectedCurrency: input.expectedCurrency,
    expectedOrderReference: input.expectedOrderReference,
    provider: input.providerState,
  });
  const key = `${input.provider}:${input.kind.toLowerCase()}:${input.providerState.reference}`;
  const existing = await prisma.paymentReconciliation.findUnique({ where: { reconciliationKey: key }, select: { attempts: true } });
  const attempts = (existing?.attempts ?? 0) + 1;
  const terminal = decision.status === "MATCHED" || decision.status === "MISMATCH" || decision.status === "FAILED";
  return prisma.paymentReconciliation.upsert({
    where: { reconciliationKey: key },
    create: {
      reconciliationKey: key,
      restaurantId: input.restaurantId,
      orderId: input.orderId,
      provider: input.provider,
      kind: input.kind,
      status: decision.status,
      providerReference: input.providerState.reference,
      expectedAmount: input.expectedAmount,
      providerAmount: input.providerState.amount,
      currency: input.expectedCurrency,
      providerCurrency: input.providerState.currency,
      localStatus: input.localStatus,
      providerStatus: input.providerState.status,
      mismatchCode: decision.mismatchCode,
      details: { source: input.source, providerError: input.providerState.error ?? null },
      attempts,
      lastCheckedAt: new Date(),
      nextCheckAt: terminal ? null : nextRetry(attempts),
      resolvedAt: decision.status === "MATCHED" ? new Date() : null,
    },
    update: {
      status: decision.status,
      providerAmount: input.providerState.amount,
      providerCurrency: input.providerState.currency,
      localStatus: input.localStatus,
      providerStatus: input.providerState.status,
      mismatchCode: decision.mismatchCode,
      details: { source: input.source, providerError: input.providerState.error ?? null },
      attempts,
      lastCheckedAt: new Date(),
      nextCheckAt: terminal ? null : nextRetry(attempts),
      resolvedAt: decision.status === "MATCHED" ? new Date() : null,
    },
  });
}

export async function reconcileRazorpayOrder(
  prisma: PrismaClient,
  input: {
    orderId: string;
    keyId: string;
    secret: string;
    request: (path: string, keyId: string, secret: string) => Promise<Response>;
    source?: "scheduled" | "manual";
  },
) {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order) return null;
  const kind = order.refundId ? "REFUND" : "PAYMENT";
  const reference = order.refundId || order.providerPaymentId || order.providerOrderId;
  if (!reference) return null;
  const lookupByOrder = kind === "PAYMENT" && !order.providerPaymentId && Boolean(order.providerOrderId);
  const path = kind === "REFUND"
    ? `/refunds/${encodeURIComponent(reference)}`
    : lookupByOrder
      ? `/orders/${encodeURIComponent(reference)}/payments`
      : `/payments/${encodeURIComponent(reference)}`;
  try {
    const response = await input.request(path, input.keyId, input.secret);
    const providerResponse = await response.json().catch(() => ({})) as {
      id?: string; payment_id?: string; order_id?: string; amount?: number; currency?: string; status?: string;
      error?: { description?: string }; error_description?: string;
      items?: Array<{ id?: string; payment_id?: string; order_id?: string; amount?: number; currency?: string; status?: string; error_description?: string }>;
    };
    const entity = lookupByOrder
      ? providerResponse.items?.find(item => item.status === "captured") || providerResponse.items?.[0] || {}
      : providerResponse;
    if (!response.ok || !entity.id) throw new Error(providerResponse.error?.description || "Provider lookup failed");
    const reconciliation = await recordProviderReconciliation(prisma, {
      restaurantId: order.restaurantId,
      orderId: order.id,
      kind,
      provider: "razorpay",
      expectedAmount: order.totalAmount * 100,
      expectedCurrency: "INR",
      expectedOrderReference: kind === "PAYMENT" ? order.providerOrderId : order.providerPaymentId,
      localStatus: kind === "PAYMENT" ? order.paymentStatus : order.refundStatus || "pending",
      providerState: {
        reference: entity.id,
        orderReference: kind === "PAYMENT" ? entity.order_id : entity.payment_id,
        amount: entity.amount,
        currency: entity.currency,
        status: entity.status,
        error: entity.error_description,
      },
      source: input.source || "scheduled",
    });
    if (reconciliation.status === "MATCHED") {
      await prisma.order.update({
        where: { id: order.id },
        data: kind === "PAYMENT"
          ? { providerPaymentId: entity.id, paymentReference: entity.id, paymentStatus: "PAID", paymentConfirmedAt: order.paymentConfirmedAt || new Date(), lastPaymentError: null, nextRetryAt: null }
          : { paymentStatus: "REFUNDED", refundStatus: "processed", lastPaymentError: null, nextRetryAt: null },
      });
    } else if (reconciliation.status === "FAILED") {
      await prisma.order.update({ where: { id: order.id }, data: { lastPaymentError: entity.error_description || `${kind.toLowerCase()} failed`, nextRetryAt: null } });
    } else if (reconciliation.status === "PENDING") {
      await prisma.order.update({ where: { id: order.id }, data: { retryCount: { increment: 1 }, nextRetryAt: reconciliation.nextCheckAt } });
    }
    return reconciliation;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider lookup failed";
    return prisma.paymentReconciliation.upsert({
      where: { reconciliationKey: `razorpay:${kind.toLowerCase()}:${reference}` },
      create: {
        reconciliationKey: `razorpay:${kind.toLowerCase()}:${reference}`,
        restaurantId: order.restaurantId,
        orderId: order.id,
        provider: "razorpay",
        kind,
        status: "PENDING",
        providerReference: reference,
        expectedAmount: order.totalAmount * 100,
        currency: "INR",
        localStatus: kind === "PAYMENT" ? order.paymentStatus : order.refundStatus || "pending",
        details: { source: input.source || "scheduled", lookupError: message },
        attempts: 1,
        lastCheckedAt: new Date(),
        nextCheckAt: nextRetry(1),
      },
      update: {
        status: "PENDING",
        details: { source: input.source || "scheduled", lookupError: message },
        attempts: { increment: 1 },
        lastCheckedAt: new Date(),
        nextCheckAt: nextRetry(1),
      },
    });
  }
}
