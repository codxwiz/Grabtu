ALTER TABLE "ServiceRequest" DROP CONSTRAINT IF EXISTS "ServiceRequest_tableId_fkey";
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_tableId_restaurantId_fkey" FOREIGN KEY ("tableId", "restaurantId") REFERENCES "Table"("id", "restaurantId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Invoice_subscriptionId_idx" ON "Invoice"("subscriptionId");
