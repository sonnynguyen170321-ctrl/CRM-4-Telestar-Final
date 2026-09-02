import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(resolve(rootDir, path), "utf8");

for (const path of [
  "lib/v2/auth/types.ts",
  "lib/v2/auth/password.ts",
  "lib/v2/auth/session.ts",
  "lib/v2/auth/login.ts",
  "lib/v2/auth/getCurrentAuthIdentity.ts",
  "lib/v2/tenant/requireTenantContext.ts",
  "proxy.ts",
  "app/v2/login/page.tsx",
  "app/v2/login/actions.ts",
  "app/v2/login/LoginForm.tsx",
  "app/v2/logout/route.ts",
]) {
  assert.equal(existsSync(resolve(rootDir, path)), true, `${path} exists`);
}

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.dependencies?.["@auth0/nextjs-auth0"], undefined, "Auth0 dependency removed");
assert.equal(packageJson.scripts?.["v2:signup"], "node scripts/v2-signup.mjs", "signup CLI script registered");
assert.doesNotMatch(read("package-lock.json"), /@auth0\/nextjs-auth0/, "lockfile has no Auth0 package");

for (const path of ["app", "lib", "proxy.ts"]) {
  const text = path.endsWith(".ts") ? read(path) : readTree(path);
  assert.doesNotMatch(text, /@auth0|auth0\.|["']\/auth\/login|["']\/auth\/logout/, `${path} has no Auth0 wiring`);
}

const schema = read("prisma/schema.prisma");
assert.match(schema, /model V2UserCredential/);
assert.match(schema, /model V2AuthSession/);
assert.match(schema, /tokenHash\s+String\s+@unique/);
assert.match(schema, /passwordHash\s+String/);

const password = read("lib/v2/auth/password.ts");
assert.match(password, /scrypt/);
assert.match(password, /randomBytes\(16\)/);
assert.match(password, /timingSafeEqual/);
assert.doesNotMatch(password, /bcrypt|argon/);

const session = read("lib/v2/auth/session.ts");
assert.match(session, /createHmac\("sha256"/);
assert.match(session, /httpOnly: true/);
assert.match(session, /sameSite: "lax"/);
assert.match(session, /revokedAt/);
assert.match(session, /V2_AUTH_SECRET/);

const identity = read("lib/v2/auth/getCurrentAuthIdentity.ts");
assert.match(identity, /readAuthSessionToken/);
assert.match(identity, /"V2AuthSession"/);
assert.match(identity, /revokedAt/);
assert.match(identity, /expiresAt/);
assert.match(identity, /provider: "local"/);

const proxy = read("proxy.ts");
assert.match(proxy, /new URL\("\/v2\/login"/);
assert.match(proxy, /request\.cookies\.get\(SESSION_COOKIE_NAME\)/);
assert.match(proxy, /pathname === "\/v2\/outreach\/drain"/);
assert.match(proxy, /pathname\.startsWith\("\/v2\/outreach\/track\/"\)/);
assert.doesNotMatch(proxy, /auth0/);

const loginPage = read("app/v2/login/page.tsx");
assert.match(loginPage, /LoginForm/);
assert.match(loginPage, /getTenantErrorMessage\(error\)/);
assert.match(loginPage, /Self-hosted identity/);
const loginForm = read("app/v2/login/LoginForm.tsx");
assert.match(loginForm, /type=\{showPassword \? "text" : "password"\}/);
assert.match(loginForm, /useFormStatus/);

console.log("PASS V2 self-hosted auth foundation checks complete");

function readTree(path) {
  const absolute = resolve(rootDir, path);
  let out = "";
  for (const name of readdirSync(absolute)) {
    const child = resolve(absolute, name);
    if (name === "generated" || name === ".next" || name === "node_modules") continue;
    const stat = statSync(child);
    if (stat.isDirectory()) out += readTree(child.slice(rootDir.length + 1));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out += readFileSync(child, "utf8") + "\n";
  }
  return out;
}