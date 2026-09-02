CREATE TABLE "V2UserCredential" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "passwordUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V2UserCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "V2AuthSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "userAgentHash" TEXT,
  "ipHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V2AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "V2UserCredential_userId_key" ON "V2UserCredential"("userId");
CREATE INDEX "V2UserCredential_lockedUntil_idx" ON "V2UserCredential"("lockedUntil");
CREATE INDEX "V2UserCredential_updatedAt_idx" ON "V2UserCredential"("updatedAt");

CREATE UNIQUE INDEX "V2AuthSession_tokenHash_key" ON "V2AuthSession"("tokenHash");
CREATE INDEX "V2AuthSession_userId_idx" ON "V2AuthSession"("userId");
CREATE INDEX "V2AuthSession_expiresAt_idx" ON "V2AuthSession"("expiresAt");
CREATE INDEX "V2AuthSession_revokedAt_idx" ON "V2AuthSession"("revokedAt");
CREATE INDEX "V2AuthSession_lastSeenAt_idx" ON "V2AuthSession"("lastSeenAt");

ALTER TABLE "V2UserCredential"
  ADD CONSTRAINT "V2UserCredential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "V2User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "V2AuthSession"
  ADD CONSTRAINT "V2AuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "V2User"("id") ON DELETE CASCADE ON UPDATE CASCADE;