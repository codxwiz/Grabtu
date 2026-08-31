CREATE TYPE "OutboxEventStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'DELIVERED',
  'FAILED'
);

CREATE TABLE "DomainEventOutbox" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT,
  "topic" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT,
  "payload" JSONB NOT NULL,
  "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DomainEventOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DomainEventOutbox_status_availableAt_createdAt_idx"
ON "DomainEventOutbox"("status", "availableAt", "createdAt");
CREATE INDEX "DomainEventOutbox_restaurantId_createdAt_idx"
ON "DomainEventOutbox"("restaurantId", "createdAt");
CREATE INDEX "DomainEventOutbox_aggregateType_aggregateId_createdAt_idx"
ON "DomainEventOutbox"("aggregateType", "aggregateId", "createdAt");

ALTER TABLE "DomainEventOutbox"
ADD CONSTRAINT "DomainEventOutbox_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
