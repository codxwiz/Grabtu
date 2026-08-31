CREATE TYPE "UpiPaymentStatus" AS ENUM ('CREATED', 'PENDING', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REQUIRES_REVIEW');

CREATE TABLE "UpiPaymentAttempt" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "paymentMethodId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'manual_upi',
  "method" TEXT NOT NULL DEFAULT 'UPI',
  "status" "UpiPaymentStatus" NOT NULL DEFAULT 'CREATED',
  "amountPaise" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "transactionReference" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "providerTransactionId" TEXT,
  "merchantVpa" TEXT NOT NULL,
  "merchantName" TEXT NOT NULL,
  "customerSelectedApp" TEXT,
  "customerReference" TEXT,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UpiPaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UpiPaymentEvent" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "providerEventId" TEXT,
  "sanitizedPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UpiPaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UpiPaymentAttempt_transactionReference_key" ON "UpiPaymentAttempt"("transactionReference");
CREATE UNIQUE INDEX "UpiPaymentAttempt_providerPaymentId_key" ON "UpiPaymentAttempt"("providerPaymentId");
CREATE INDEX "UpiPaymentAttempt_restaurantId_status_createdAt_idx" ON "UpiPaymentAttempt"("restaurantId", "status", "createdAt");
CREATE INDEX "UpiPaymentAttempt_orderId_status_idx" ON "UpiPaymentAttempt"("orderId", "status");
CREATE UNIQUE INDEX "UpiPaymentEvent_providerEventId_key" ON "UpiPaymentEvent"("providerEventId");
CREATE INDEX "UpiPaymentEvent_paymentId_createdAt_idx" ON "UpiPaymentEvent"("paymentId", "createdAt");
ALTER TABLE "UpiPaymentAttempt" ADD CONSTRAINT "UpiPaymentAttempt_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UpiPaymentAttempt" ADD CONSTRAINT "UpiPaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UpiPaymentAttempt" ADD CONSTRAINT "UpiPaymentAttempt_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UpiPaymentEvent" ADD CONSTRAINT "UpiPaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "UpiPaymentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
