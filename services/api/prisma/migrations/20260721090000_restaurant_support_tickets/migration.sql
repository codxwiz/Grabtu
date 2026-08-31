CREATE TABLE "RestaurantSupportTicket" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "RestaurantSupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RestaurantSupportTicket_restaurantId_createdAt_idx" ON "RestaurantSupportTicket"("restaurantId", "createdAt");
CREATE INDEX "RestaurantSupportTicket_status_priority_createdAt_idx" ON "RestaurantSupportTicket"("status", "priority", "createdAt");

ALTER TABLE "RestaurantSupportTicket"
  ADD CONSTRAINT "RestaurantSupportTicket_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
