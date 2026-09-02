-- S6b: durable sender connection-verification state (additive, nullable).
ALTER TABLE "V2SenderAccount" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "V2SenderAccount" ADD COLUMN "lastVerifyError" TEXT;
ALTER TABLE "V2SenderAccount" ADD COLUMN "lastVerifyCheckedAt" TIMESTAMP(3);
