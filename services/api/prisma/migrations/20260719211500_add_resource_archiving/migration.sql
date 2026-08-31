ALTER TABLE "Table" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "PaymentMethod" ADD COLUMN "deletedAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "PaymentMethod_restaurantId_isActive_idx";
CREATE INDEX "PaymentMethod_restaurantId_isActive_deletedAt_idx" ON "PaymentMethod"("restaurantId", "isActive", "deletedAt");
