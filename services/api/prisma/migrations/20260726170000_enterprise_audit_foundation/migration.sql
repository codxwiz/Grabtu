CREATE TYPE "AuditActorType" AS ENUM (
  'PLATFORM_ADMIN',
  'STAFF',
  'CUSTOMER',
  'SYSTEM',
  'INTEGRATION'
);

CREATE TABLE "EnterpriseAuditEvent" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT,
  "actorType" "AuditActorType" NOT NULL,
  "actorId" TEXT,
  "actorRole" TEXT,
  "action" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "requestId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "metadata" JSONB,
  "previousHash" TEXT,
  "hash" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EnterpriseAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EnterpriseAuditEvent_hash_key" ON "EnterpriseAuditEvent"("hash");
CREATE INDEX "EnterpriseAuditEvent_restaurantId_occurredAt_idx" ON "EnterpriseAuditEvent"("restaurantId", "occurredAt");
CREATE INDEX "EnterpriseAuditEvent_actorType_actorId_occurredAt_idx" ON "EnterpriseAuditEvent"("actorType", "actorId", "occurredAt");
CREATE INDEX "EnterpriseAuditEvent_resourceType_resourceId_occurredAt_idx" ON "EnterpriseAuditEvent"("resourceType", "resourceId", "occurredAt");
CREATE INDEX "EnterpriseAuditEvent_requestId_idx" ON "EnterpriseAuditEvent"("requestId");

ALTER TABLE "EnterpriseAuditEvent"
ADD CONSTRAINT "EnterpriseAuditEvent_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
