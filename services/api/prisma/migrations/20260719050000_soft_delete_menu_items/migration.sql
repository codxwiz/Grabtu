ALTER TABLE "MenuItem" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "MenuItem_restaurantId_deletedAt_idx" ON "MenuItem"("restaurantId", "deletedAt");
