import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { billingWebhookInternals } from "./billing-hardening.js";

const request = (eventId = "evt_test") => ({
  header(name: string) {
    return name.toLowerCase() === "x-razorpay-event-id" ? eventId : undefined;
  },
}) as Request;

test("normalizes Razorpay subscription lifecycle states", () => {
  assert.equal(billingWebhookInternals.normalizeEvent("subscription.activated"), "subscription.active");
  assert.equal(billingWebhookInternals.normalizeEvent("subscription.charged"), "subscription.charged");
  assert.equal(billingWebhookInternals.normalizeEvent("subscription.pending"), "subscription.pending");
  assert.equal(billingWebhookInternals.normalizeEvent("subscription.halted"), "subscription.halted");
  assert.equal(billingWebhookInternals.normalizeEvent("subscription.completed"), "subscription.completed");
  assert.equal(billingWebhookInternals.normalizeEvent("subscription.authenticated"), "subscription.authenticated");
  assert.equal(billingWebhookInternals.normalizeEvent("subscription.cancelled"), "subscription.cancelled");
  assert.equal(billingWebhookInternals.normalizeEvent("subscription.resumed"), "subscription.active");
});

test("maps Starter and reconciles recurring invoice fields", () => {
  process.env.RAZORPAY_PLAN_STARTER_ID = "plan_starter";
  const normalized = billingWebhookInternals.normalizeWebhook(request(), {
    event: "subscription.charged",
    payload: {
      subscription: { entity: { id: "sub_123", plan_id: "plan_starter", current_start: 1_700_000_000, current_end: 1_702_592_000, paid_count: 2, notes: { restaurantId: "restaurant_123" } } },
      payment: { entity: { id: "pay_123", invoice_id: "inv_123", amount: 149_900, currency: "INR" } },
    },
  });
  assert.equal(normalized.restaurantId, "restaurant_123");
  assert.equal(normalized.plan, "starter");
  assert.equal(normalized.providerSubscriptionId, "sub_123");
  assert.equal(normalized.invoiceNumber, "inv_123");
  assert.equal(normalized.amount, 1499);
  assert.equal(normalized.hasProviderInvoice, true);
});

test("distinguishes an order payment from a subscription payment", () => {
  const normalized = billingWebhookInternals.normalizeWebhook(request("evt_order"), {
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_order", amount: 25_000, notes: { restaurantId: "restaurant_123", orderId: "order_123" } } } },
  });
  assert.equal(normalized.providerSubscriptionId, "");
  assert.equal(normalized.providerPaymentId, "pay_order");
});
