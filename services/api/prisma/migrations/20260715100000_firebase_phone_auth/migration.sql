ALTER TABLE "StaffUser" ADD COLUMN "phone" TEXT;
ALTER TABLE "StaffUser" ADD COLUMN "firebaseUid" TEXT;

CREATE UNIQUE INDEX "StaffUser_phone_key" ON "StaffUser"("phone");
CREATE UNIQUE INDEX "StaffUser_firebaseUid_key" ON "StaffUser"("firebaseUid");
