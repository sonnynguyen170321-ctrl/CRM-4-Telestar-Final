-- Signature images (lib/email/signature.ts). Nullable, no default, no backfill: every existing
-- mailbox keeps exactly the signature it had, and a column add is metadata-only in Postgres.
ALTER TABLE "EmailAccount" ADD COLUMN "signatureImages" JSONB;
