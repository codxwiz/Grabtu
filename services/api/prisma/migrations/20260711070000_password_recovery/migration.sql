ALTER TABLE "StaffUser" ADD COLUMN "passwordResetTokenHash" TEXT;
ALTER TABLE "StaffUser" ADD COLUMN "passwordResetRequestedAt" TIMESTAMP(3);
ALTER TABLE "StaffUser" ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);
