CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaAsset_key_key" ON "MediaAsset"("key");
CREATE INDEX "MediaAsset_restaurantId_kind_createdAt_idx" ON "MediaAsset"("restaurantId", "kind", "createdAt");

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
