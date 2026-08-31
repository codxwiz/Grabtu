DROP INDEX IF EXISTS "Order_displayId_key";
CREATE UNIQUE INDEX "Order_restaurantId_displayId_key" ON "Order"("restaurantId", "displayId");
