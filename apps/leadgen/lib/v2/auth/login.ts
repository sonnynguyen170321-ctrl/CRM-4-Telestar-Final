import "server-only";

import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/server/prisma";

import { normalizeEmail } from "./getCurrentAuthIdentity";
import { hashPassword, verifyPassword } from "./password";

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export type LoginResult =
  | { ok: true; userId: string }
  | { ok: false; code: "INVALID_CREDENTIALS" | "LOCKED" | "AUTH_NOT_CONFIGURED" };

type LoginRow = {
  userId: string;
  status: string;
  passwordHash: string | null;
  failedLoginCount: number | null;
  lockedUntil: Date | null;
};

export async function authenticatePassword(input: { email: string; password: string; env?: NodeJS.ProcessEnv }): Promise<LoginResult> {
  const env = input.env ?? process.env;
  if (!(env.V2_AUTH_SECRET ?? "").trim()) return { ok: false, code: "AUTH_NOT_CONFIGURED" };
  const emailNormalized = normalizeEmail(input.email);
  if (!emailNormalized || !input.password) return { ok: false, code: "INVALID_CREDENTIALS" };

  const [row] = await prisma.$queryRaw<LoginRow[]>`
    SELECT u."id" AS "userId", u."status"::text AS "status", c."passwordHash",
           c."failedLoginCount", c."lockedUntil"
    FROM "V2User" u
    LEFT JOIN "V2UserCredential" c ON c."userId" = u."id"
    WHERE u."emailNormalized" = ${emailNormalized}
    LIMIT 1
  `;

  if (!row || row.status !== "ACTIVE" || !row.passwordHash) {
    return { ok: false, code: "INVALID_CREDENTIALS" };
  }

  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    return { ok: false, code: "LOCKED" };
  }

  const valid = await verifyPassword(input.password, row.passwordHash, env);
  if (!valid) {
    await recordFailedLogin(row.userId, Number(row.failedLoginCount ?? 0));
    return { ok: false, code: "INVALID_CREDENTIALS" };
  }

  await prisma.$executeRaw`
    UPDATE "V2UserCredential"
    SET "failedLoginCount" = 0, "lockedUntil" = NULL, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "userId" = ${row.userId}
  `;
  return { ok: true, userId: row.userId };
}

export async function upsertPasswordCredential(input: { userId: string; password: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  const passwordHash = await hashPassword(input.password, input.env ?? process.env);
  const id = `v2cred_${Date.now().toString(36)}_${randomBytes(6).toString("base64url")}`;
  await prisma.$executeRaw`
    INSERT INTO "V2UserCredential" ("id", "userId", "passwordHash", "passwordUpdatedAt", "failedLoginCount", "lockedUntil", "createdAt", "updatedAt")
    VALUES (${id}, ${input.userId}, ${passwordHash}, CURRENT_TIMESTAMP, 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("userId") DO UPDATE SET
      "passwordHash" = EXCLUDED."passwordHash",
      "passwordUpdatedAt" = CURRENT_TIMESTAMP,
      "failedLoginCount" = 0,
      "lockedUntil" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

async function recordFailedLogin(userId: string, currentFailedCount: number): Promise<void> {
  const nextCount = currentFailedCount + 1;
  const lockedUntil = nextCount >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null;
  await prisma.$executeRaw`
    UPDATE "V2UserCredential"
    SET "failedLoginCount" = ${nextCount}, "lockedUntil" = ${lockedUntil}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "userId" = ${userId}
  `;
}