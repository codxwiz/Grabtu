ALTER TABLE "Restaurant"
  ADD COLUMN "cardPaymentProvider" TEXT,
  ADD COLUMN "cardMerchantKeyId" TEXT,
  ADD COLUMN "cardMerchantSecretCiphertext" TEXT,
  ADD COLUMN "cardPaymentsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cardMerchantVerifiedAt" TIMESTAMP(3);
