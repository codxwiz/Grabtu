CREATE TYPE "PaymentReconciliationKind" AS ENUM ('PAYMENT', 'REFUND');
CREATE TYPE "PaymentReconciliationStatus" AS ENUM ('PENDING', 'MATCHED', 'MISMATCH', 'MANUAL_REVIEW', 'FAILED', 'RESOLVED');

CREATE TABLE "PaymentReconciliation" (
    "id" TEXT NOT NULL,
    "reconciliationKey" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT,
    "provider" TEXT NOT NULL,
    "kind" "PaymentReconciliationKind" NOT NULL,
    "status" "PaymentReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "providerReference" TEXT,
    "expectedAmount" INTEGER NOT NULL,
    "providerAmount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "providerCurrency" TEXT,
    "localStatus" TEXT NOT NULL,
    "providerStatus" TEXT,
    "mismatchCode" TEXT,
    "details" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentReconciliation_reconciliationKey_key" ON "PaymentReconciliation"("reconciliationKey");
CREATE INDEX "PaymentReconciliation_restaurantId_status_updatedAt_idx" ON "PaymentReconciliation"("restaurantId", "status", "updatedAt");
CREATE INDEX "PaymentReconciliation_orderId_kind_idx" ON "PaymentReconciliation"("orderId", "kind");
CREATE INDEX "PaymentReconciliation_status_nextCheckAt_idx" ON "PaymentReconciliation"("status", "nextCheckAt");
CREATE INDEX "PaymentReconciliation_provider_providerReference_idx" ON "PaymentReconciliation"("provider", "providerReference");

ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
