ALTER TABLE "Table" ADD COLUMN "qrToken" TEXT;
UPDATE "Table" SET "qrToken" = 't_' || md5(random()::text || clock_timestamp()::text || "id") WHERE "qrToken" IS NULL;
ALTER TABLE "Table" ALTER COLUMN "qrToken" SET NOT NULL;
CREATE UNIQUE INDEX "Table_qrToken_key" ON "Table"("qrToken");
ALTER TABLE "Restaurant" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'starter';
ALTER TABLE "Restaurant" ADD COLUMN "planStatus" TEXT NOT NULL DEFAULT 'trialing';
ALTER TABLE "Restaurant" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
