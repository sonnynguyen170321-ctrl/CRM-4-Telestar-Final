-- S6c-runtime: OAuth sender connection (Authorization Code + PKCE).

-- XOAUTH2 auth on senders (additive).
ALTER TABLE "V2SenderAccount" ADD COLUMN "authMode" TEXT NOT NULL DEFAULT 'PASSWORD';
ALTER TABLE "V2SenderAccount" ADD COLUMN "oauthProvider" TEXT;
ALTER TABLE "V2SenderAccount" ADD COLUMN "oauthRefreshEnc" JSONB;

-- One-time, tenant-bound OAuth state (encrypted PKCE verifier).
CREATE TABLE "V2OutreachOAuthState" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "codeVerifierEnc" JSONB NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V2OutreachOAuthState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "V2OutreachOAuthState_organizationId_state_key" ON "V2OutreachOAuthState"("organizationId", "state");
CREATE INDEX "V2OutreachOAuthState_expiresAt_idx" ON "V2OutreachOAuthState"("expiresAt");
