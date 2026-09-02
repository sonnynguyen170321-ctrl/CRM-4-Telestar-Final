import "server-only";

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const KEY_LEN = 64;
const HASH_PREFIX = "scrypt";

export async function hashPassword(password: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  assertPassword(password);
  const salt = randomBytes(16).toString("base64url");
  const key = (await scrypt(passwordWithPepper(password, env), salt, KEY_LEN)) as Buffer;
  return `${HASH_PREFIX}$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== HASH_PREFIX || !parts[1] || !parts[2]) return false;
  const [, salt, expectedRaw] = parts;
  const expected = Buffer.from(expectedRaw, "base64url");
  if (expected.length !== KEY_LEN) return false;
  const actual = (await scrypt(passwordWithPepper(password, env), salt, KEY_LEN)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function passwordWithPepper(password: string, env: NodeJS.ProcessEnv): string {
  const secret = (env.V2_AUTH_SECRET ?? "").trim();
  if (!secret) throw new Error("V2_AUTH_SECRET is required for password auth.");
  return `${password}\u0000${secret}`;
}

function assertPassword(password: string): void {
  if (password.length < 10) {
    throw new Error("Password must be at least 10 characters.");
  }
}