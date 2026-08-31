import assert from "node:assert/strict";
import test from "node:test";
import { buildRazorpaySubscriptionRequest, createMandateSignature } from "./razorpay-subscription.js";

test("schedules the first recurring charge at the trial expiry", () => {
  const trialEndsAt = new Date("2026-08-01T10:30:00.000Z");
  const request = buildRazorpaySubscriptionRequest({
    planId: "plan_starter",
    restaurantId: "restaurant_123",
    plan: "starter",
    startAt: trialEndsAt,
  });
  assert.equal(request.start_at, Math.floor(trialEndsAt.getTime() / 1000));
  assert.equal(request.customer_notify, true);
  assert.equal(request.total_count, 12);
  assert.equal(request.notes.trialEndsAt, trialEndsAt.toISOString());
});

test("does not add a delayed start for an immediate paid subscription", () => {
  const request = buildRazorpaySubscriptionRequest({
    planId: "plan_growth",
    restaurantId: "restaurant_456",
    plan: "growth",
  });
  assert.equal(request.start_at, undefined);
  assert.equal(request.notes.trialEndsAt, undefined);
});

test("creates the Razorpay subscription authorization signature in payment-subscription order", () => {
  assert.equal(
    createMandateSignature("pay_example", "sub_example", "secret_example"),
    "e024fb803037e33c9a8a007d1b5cfa2783c0d3ddbd5cf8587d0ce70a98b94351",
  );
});
