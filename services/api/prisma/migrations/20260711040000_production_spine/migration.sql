ALTER TABLE "Restaurant" ADD COLUMN "nextOrderNumber" INTEGER NOT NULL DEFAULT 1;
UPDATE "Restaurant" r SET "nextOrderNumber" = COALESCE((SELECT COUNT(*) + 1 FROM "Order" o WHERE o."restaurantId" = r."id"), 1);
ALTER TABLE "StaffUser" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StaffUser" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;
UPDATE "Order" SET "idempotencyKey" = gen_random_uuid()::text WHERE "idempotencyKey" IS NULL;
ALTER TABLE "Order" ALTER COLUMN "idempotencyKey" SET NOT NULL;
CREATE UNIQUE INDEX "Order_restaurantId_idempotencyKey_key" ON "Order"("restaurantId", "idempotencyKey");
