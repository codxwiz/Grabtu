import type { PrismaClient } from "@prisma/client";
import webpush from "web-push";

export type RestaurantPushMessage = {
  title: string;
  body: string;
  tag: string;
  kind: "new-order" | "payment-reported" | "order-ready" | "waiter-call" | "payment-confirmed" | "feedback-received";
  url?: string;
};

const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:support@example.com";
const configured = Boolean(publicKey && privateKey);

if (configured) webpush.setVapidDetails(subject, publicKey, privateKey);

export function pushPublicKey() {
  return configured ? publicKey : null;
}

export async function sendRestaurantPush(prisma: PrismaClient, restaurantId: string, message: RestaurantPushMessage) {
  if (!configured) return;
  const subscriptions = await prisma.pushSubscription.findMany({ where: { restaurantId } });
  await Promise.allSettled(subscriptions.map(async subscription => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify({ ...message, url: message.url || "/" }), { TTL: 300, urgency: "high" });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription.deleteMany({ where: { endpoint: subscription.endpoint } });
        return;
      }
      console.error("Push notification delivery failed", { restaurantId, statusCode });
    }
  }));
}
