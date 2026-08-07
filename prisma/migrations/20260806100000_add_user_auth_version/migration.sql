-- Session revocation for stateless JWTs.
--
-- Sessions are JWTs with no server-side store, so there was no way to revoke one: a
-- deactivated, demoted or password-reset user kept full access until their token expired.
-- `authVersion` is stamped into the token at sign-in and re-checked against this column on
-- every protected request; bumping it invalidates every token issued before the bump.
--
-- Additive and backfilled to 1, matching the Prisma default. Existing tokens carry no
-- authVersion claim and are treated as version 1, so this migration does not sign anyone out.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "authVersion" INTEGER NOT NULL DEFAULT 1;
