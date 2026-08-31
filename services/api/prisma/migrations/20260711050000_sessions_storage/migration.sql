ALTER TABLE "StaffUser" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StaffUser" ADD COLUMN "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "PaymentMethod" ALTER COLUMN "qrImageData" DROP NOT NULL;
ALTER TABLE "PaymentMethod" ADD COLUMN "qrImageKey" TEXT;
CREATE TABLE "StaffSession" (
  "id" TEXT NOT NULL,
  "staffUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "userAgent" TEXT,
  "ipAddress" TEXT,
  CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffSession_staffUserId_expiresAt_idx" ON "StaffSession"("staffUserId", "expiresAt");
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
