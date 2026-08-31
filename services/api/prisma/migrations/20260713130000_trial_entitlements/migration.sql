ALTER TABLE "Restaurant" ADD COLUMN "featuresLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Restaurant" ADD COLUMN "featureLockReason" TEXT;
