CREATE TABLE "MutationIdempotencyKey" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "statusCode" INTEGER,
  "responseBody" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MutationIdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MutationIdempotencyKey_restaurantId_actorId_key_key"
ON "MutationIdempotencyKey"("restaurantId", "actorId", "key");
CREATE INDEX "MutationIdempotencyKey_expiresAt_idx"
ON "MutationIdempotencyKey"("expiresAt");
CREATE INDEX "MutationIdempotencyKey_restaurantId_status_createdAt_idx"
ON "MutationIdempotencyKey"("restaurantId", "status", "createdAt");

ALTER TABLE "MutationIdempotencyKey"
ADD CONSTRAINT "MutationIdempotencyKey_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
