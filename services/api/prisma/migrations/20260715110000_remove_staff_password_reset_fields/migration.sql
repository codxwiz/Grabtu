ALTER TABLE "StaffUser" DROP COLUMN IF EXISTS "passwordResetTokenHash";
ALTER TABLE "StaffUser" DROP COLUMN IF EXISTS "passwordResetRequestedAt";
ALTER TABLE "StaffUser" DROP COLUMN IF EXISTS "passwordResetExpiresAt";
