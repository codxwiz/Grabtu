ALTER TABLE "PlatformAdmin" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "StaffUser" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "StaffUser" DROP COLUMN IF EXISTS "mustChangePassword";
ALTER TABLE "StaffUser" DROP COLUMN IF EXISTS "passwordChangedAt";
