ALTER TABLE "PlatformAdmin" ADD COLUMN "phone" TEXT;
CREATE UNIQUE INDEX "PlatformAdmin_phone_key" ON "PlatformAdmin"("phone");
