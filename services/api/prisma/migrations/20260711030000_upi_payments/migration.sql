CREATE EXTENSION IF NOT EXISTS "pgcrypto";
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REPORTED';

ALTER TABLE "Order" ADD COLUMN "trackingToken" TEXT;
UPDATE "Order" SET "trackingToken" = gen_random_uuid()::text WHERE "trackingToken" IS NULL;
ALTER TABLE "Order" ALTER COLUMN "trackingToken" SET NOT NULL;
CREATE UNIQUE INDEX "Order_trackingToken_key" ON "Order"("trackingToken");

CREATE TABLE "PaymentMethod" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "upiId" TEXT,
  "phone" TEXT,
  "qrImageData" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PaymentMethod_restaurantId_isActive_idx" ON "PaymentMethod"("restaurantId", "isActive");
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "paymentMethodId" TEXT;
ALTER TABLE "Order" ADD COLUMN "paymentReference" TEXT;
ALTER TABLE "Order" ADD COLUMN "paymentReportedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "paymentConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD CONSTRAINT "Order_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
