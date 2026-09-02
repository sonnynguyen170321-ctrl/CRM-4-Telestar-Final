#!/usr/bin/env node
import { createHash, randomBytes, scrypt as scryptCb } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const scrypt = promisify(scryptCb);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "TEAM_LEAD", "SDR", "VIEWER"]);

loadEnvFiles([".env.local", ".env", ".env.production"]);

const args = parseArgs(process.argv.slice(2));
const email = normalizeEmail(args.email ?? process.env.V2_SIGNUP_EMAIL ?? "");
if (!email) fail("Set --email you@example.com.");
const name = (args.name ?? process.env.V2_SIGNUP_NAME ?? email.split("@")[0]).trim();
const orgName = (args.org ?? process.env.V2_SIGNUP_ORG ?? `${name}'s Organization`).trim();
const role = (args.role ?? process.env.V2_SIGNUP_ROLE ?? "OWNER").trim().toUpperCase();
if (!ROLES.has(role)) fail(`Invalid --role ${role}. Use one of: ${Array.from(ROLES).join(", ")}.`);
if (!process.env.DATABASE_URL) fail("DATABASE_URL is required.");
if (!process.env.V2_AUTH_SECRET) fail("V2_AUTH_SECRET is required to hash passwords.");

const generatedPassword = !args.password;
const password = args.password ?? generatePassword();
if (password.length < 10) fail("Password must be at least 10 characters.");
const resetPassword = args["reset-password"] !== undefined || Boolean(args.password) || generatedPassword;

const hash = createHash("sha256").update(email).digest("hex").slice(0, 12);
const ids = {
  organization: `v2_org_${hash}`,
  user: `v2_user_${hash}`,
  membership: `v2_membership_${hash}`,
};
const slug = slugify(orgName, hash);
const passwordHash = await hashPassword(password);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query("BEGIN");
  await pool.query(
    `INSERT INTO "V2Organization" ("id", "name", "slug", "status", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "status" = 'ACTIVE', "updatedAt" = CURRENT_TIMESTAMP`,
    [ids.organization, orgName, slug]
  );

  await pool.query(
    `INSERT INTO "V2User" ("id", "email", "emailNormalized", "name", "status", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("emailNormalized") DO UPDATE SET "email" = EXCLUDED."email", "name" = EXCLUDED."name", "status" = 'ACTIVE', "updatedAt" = CURRENT_TIMESTAMP`,
    [ids.user, email, email, name]
  );

  const userRow = await pool.query(`SELECT "id" FROM "V2User" WHERE "emailNormalized" = $1`, [email]);
  const userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("Unable to load provisioned V2User.");

  await pool.query(
    `INSERT INTO "V2OrganizationMembership" ("id", "organizationId", "userId", "role", "status", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4::"V2MembershipRole", 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("organizationId", "userId") DO UPDATE SET "role" = EXCLUDED."role", "status" = 'ACTIVE', "updatedAt" = CURRENT_TIMESTAMP`,
    [ids.membership, ids.organization, userId, role]
  );

  if (resetPassword) {
    const credentialId = `v2cred_${hash}`;
    await pool.query(
      `INSERT INTO "V2UserCredential" ("id", "userId", "passwordHash", "passwordUpdatedAt", "failedLoginCount", "lockedUntil", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT ("userId") DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", "passwordUpdatedAt" = CURRENT_TIMESTAMP, "failedLoginCount" = 0, "lockedUntil" = NULL, "updatedAt" = CURRENT_TIMESTAMP`,
      [credentialId, userId, passwordHash]
    );
  }

  await pool.query("COMMIT");
  console.log("PASS provisioned V2 user");
  console.log(JSON.stringify({ emailNormalized: email, userId, organizationId: ids.organization, organizationName: orgName, role, passwordUpdated: resetPassword }, null, 2));
  if (generatedPassword) {
    console.log(`TEMP_PASSWORD=${password}`);
  }
  console.log("Next: open /v2/login and sign in with this email/password.");
} catch (error) {
  await pool.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "reset-password") {
      out[key] = true;
    } else {
      out[key] = argv[++i];
    }
  }
  return out;
}

function normalizeEmail(value) {
  const email = String(value).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const key = await scrypt(`${password}\u0000${process.env.V2_AUTH_SECRET}`, salt, 64);
  return `scrypt$${salt}$${Buffer.from(key).toString("base64url")}`;
}

function generatePassword() {
  return `${randomBytes(18).toString("base64url")}A1!`;
}

function slugify(value, fallback) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return slug || `org-${fallback}`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function loadEnvFiles(fileNames) {
  for (const fileName of fileNames) {
    const filePath = resolve(rootDir, fileName);
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}