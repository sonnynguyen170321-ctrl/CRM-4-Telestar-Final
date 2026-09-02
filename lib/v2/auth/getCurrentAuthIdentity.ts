import "server-only";

import { prisma } from "@/lib/server/prisma";

import { hashSessionToken, readAuthSessionToken } from "./session";
import { V2AuthError, type V2AuthIdentity } from "./types";

type SessionUserRow = {
  sessionId: string;
  userId: string;
  email: string;
  emailNormalized: string;
  name: string | null;
  status: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export async function getCurrentAuthIdentity(): Promise<V2AuthIdentity> {
  const token = await readAuthSessionToken();
  if (!token) {
    throw new V2AuthError("UNAUTHENTICATED", "Authentication is required.");
  }

  const tokenHash = hashSessionToken(token);
  const [row] = await prisma.$queryRaw<SessionUserRow[]>`
    SELECT s."id" AS "sessionId", s."userId", s."expiresAt", s."revokedAt",
           u."email", u."emailNormalized", u."name", u."status"::text AS "status"
    FROM "V2AuthSession" s
    INNER JOIN "V2User" u ON u."id" = s."userId"
    WHERE s."tokenHash" = ${tokenHash}
    LIMIT 1
  `;

  if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
    throw new V2AuthError("UNAUTHENTICATED", "Authentication is required.");
  }

  const emailNormalized = normalizeEmail(row.emailNormalized || row.email);
  if (!row.userId || !row.email || !emailNormalized) {
    throw new V2AuthError("AUTH_IDENTITY_INVALID", "Authenticated identity is missing a user or email.");
  }

  await prisma.$executeRaw`
    UPDATE "V2AuthSession" SET "lastSeenAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${row.sessionId}
  `;

  return {
    provider: "local",
    email: row.email,
    emailNormalized,
    emailVerified: true,
    name: row.name,
    pictureUrl: null,
  };
}

export function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}