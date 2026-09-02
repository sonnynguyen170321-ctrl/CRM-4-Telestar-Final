import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";

import { prisma } from "@/lib/server/prisma";

const DEFAULT_COOKIE_NAME = "v2_session";
const DEFAULT_SESSION_DAYS = 14;

export function getAuthCookieName(env: NodeJS.ProcessEnv = process.env): string {
  const name = (env.V2_AUTH_COOKIE_NAME ?? DEFAULT_COOKIE_NAME).trim();
  return name || DEFAULT_COOKIE_NAME;
}

export function getAuthSessionDays(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.V2_AUTH_SESSION_DAYS ?? DEFAULT_SESSION_DAYS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 90) : DEFAULT_SESSION_DAYS;
}

export function requireAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = (env.V2_AUTH_SECRET ?? "").trim();
  if (!secret) throw new Error("V2_AUTH_SECRET is required for self-hosted V2 auth.");
  return secret;
}

export function hashSessionToken(token: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac("sha256", requireAuthSecret(env)).update(token).digest("base64url");
}

export function hashRequestValue(value: string | null): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("base64url");
}

export async function createAuthSession(input: { userId: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  const env = input.env ?? process.env;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token, env);
  const expiresAt = new Date(Date.now() + getAuthSessionDays(env) * 24 * 60 * 60 * 1000);
  const h = await headers();
  const userAgentHash = hashRequestValue(h.get("user-agent"));
  const ipHash = hashRequestValue(clientIpFromHeaders(h));
  const id = `v2sess_${Date.now().toString(36)}_${randomBytes(6).toString("base64url")}`;

  await prisma.$executeRaw`
    INSERT INTO "V2AuthSession" ("id", "userId", "tokenHash", "expiresAt", "userAgentHash", "ipHash", "createdAt", "updatedAt")
    VALUES (${id}, ${input.userId}, ${tokenHash}, ${expiresAt}, ${userAgentHash}, ${ipHash}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;

  const cookieStore = await cookies();
  cookieStore.set(getAuthCookieName(env), token, {
    httpOnly: true,
    secure: isSecureCookie(env),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function readAuthSessionToken(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(getAuthCookieName(env))?.value ?? null;
}

export async function revokeCurrentAuthSession(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const token = await readAuthSessionToken(env);
  if (token) {
    const tokenHash = hashSessionToken(token, env);
    await prisma.$executeRaw`
      UPDATE "V2AuthSession" SET "revokedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "tokenHash" = ${tokenHash} AND "revokedAt" IS NULL
    `;
  }
  await clearAuthCookie(env);
}

export async function clearAuthCookie(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(getAuthCookieName(env), "", {
    httpOnly: true,
    secure: isSecureCookie(env),
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}

export function isSecureCookie(env: NodeJS.ProcessEnv = process.env): boolean {
  const appUrl = env.APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? env.APP_BASE_URL ?? "";
  return env.NODE_ENV === "production" || appUrl.startsWith("https://");
}

function clientIpFromHeaders(h: Headers): string | null {
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  return h.get("x-real-ip");
}