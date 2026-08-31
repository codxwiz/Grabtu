ALTER TABLE "Order" ADD COLUMN "providerPaymentId" TEXT;
ALTER TABLE "Order" ADD COLUMN "providerOrderId" TEXT;
ALTER TABLE "Order" ADD COLUMN "refundId" TEXT;
ALTER TABLE "Order" ADD COLUMN "refundStatus" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN "lastPaymentError" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "nextRetryAt" TIMESTAMP(3);
CREATE TABLE "BillingWebhookEvent" (
  "id" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingWebhookEvent_providerEventId_key" ON "BillingWebhookEvent"("providerEventId");
CREATE INDEX "BillingWebhookEvent_eventType_createdAt_idx" ON "BillingWebhookEvent"("eventType", "createdAt");
