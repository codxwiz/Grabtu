DROP INDEX IF EXISTS "PlatformAdmin_email_key";
ALTER TABLE "PlatformAdmin" DROP COLUMN IF EXISTS "email";

DROP INDEX IF EXISTS "StaffUser_email_key";
ALTER TABLE "StaffUser" DROP COLUMN IF EXISTS "email";
