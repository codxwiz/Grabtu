import { createHmac } from "node:crypto";

export type RazorpaySubscriptionRequest = {
  plan_id: string;
  total_count: number;
  quantity: number;
  customer_notify: boolean;
  start_at?: number;
  notes: { restaurantId: string; plan: string; trialEndsAt?: string };
};

export function buildRazorpaySubscriptionRequest(input: {
  planId: string;
  restaurantId: string;
  plan: string;
  startAt?: Date | null;
}): RazorpaySubscriptionRequest {
  const startAtSeconds = input.startAt ? Math.floor(input.startAt.getTime() / 1000) : undefined;
  return {
    plan_id: input.planId,
    total_count: 12,
    quantity: 1,
    customer_notify: true,
    ...(startAtSeconds ? { start_at: startAtSeconds } : {}),
    notes: {
      restaurantId: input.restaurantId,
      plan: input.plan,
      ...(input.startAt ? { trialEndsAt: input.startAt.toISOString() } : {}),
    },
  };
}

export function createMandateSignature(paymentId: string, subscriptionId: string, keySecret: string) {
  return createHmac("sha256", keySecret).update(`${paymentId}|${subscriptionId}`).digest("hex");
}
