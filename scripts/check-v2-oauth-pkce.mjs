// S6c OAuth + PKCE security-core smoke — pure, no network, no DB.
// Proves: S256 PKCE derivation, authorize URL exposes only public values (no
// secret / verifier), one-time tenant-bound state validation (replay / expiry /
// cross-tenant / mismatch), and token parsing requires a refresh token without
// leaking secrets.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const {
  generatePkce,
  deriveCodeChallenge,
  buildAuthorizeUrl,
  createOAuthState,
  validateOAuthState,
  parseTokenResponse,
  parseAccessTokenResponse,
  mintAccessToken,
  isOAuthProvider,
} = loadTsModule("lib/v2/outreach/oauth/index.ts");

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 1. PKCE S256 derivation matches an independent computation; verifier is url-safe.
{
  const pkce = generatePkce();
  assert.equal(pkce.codeChallengeMethod, "S256");
  assert.equal(
    pkce.codeChallenge,
    b64url(createHash("sha256").update(pkce.codeVerifier, "ascii").digest()),
    "challenge must be base64url(SHA-256(verifier))"
  );
  assert.ok(!/[+/=]/.test(pkce.codeChallenge), "challenge is base64url (no +/=)");
  assert.ok(!/[+/=]/.test(pkce.codeVerifier), "verifier is base64url");
  assert.ok(pkce.codeVerifier.length >= 43, "verifier is >= 43 chars (RFC 7636)");
  assert.equal(deriveCodeChallenge(pkce.codeVerifier), pkce.codeChallenge);
}

console.log("PASS PKCE S256 derivation");

// 2. Authorize URL: only public values; no client_secret / verifier.
{
  const pkce = generatePkce();
  const url = buildAuthorizeUrl({
    provider: "google",
    clientId: "client-123.apps.googleusercontent.com",
    redirectUri: "https://app.example.com/v2/outreach/senders/oauth/google/callback",
    state: "STATE_TOKEN",
    codeChallenge: pkce.codeChallenge,
  });
  assert.ok(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"));
  assert.match(url, /response_type=code/);
  assert.match(url, /code_challenge_method=S256/);
  assert.match(url, /access_type=offline/);
  assert.match(url, /prompt=consent/);
  assert.ok(url.includes("state=STATE_TOKEN"));
  assert.ok(url.includes(encodeURIComponent(pkce.codeChallenge)));
  assert.ok(!url.includes("client_secret"), "authorize URL must never carry a client secret");
  assert.ok(!url.includes(pkce.codeVerifier), "authorize URL must never carry the code verifier");

  const ms = buildAuthorizeUrl({
    provider: "microsoft",
    clientId: "ms-app",
    redirectUri: "https://app.example.com/cb",
    state: "S2",
    codeChallenge: pkce.codeChallenge,
  });
  assert.ok(ms.startsWith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?"));
  assert.ok(ms.includes(encodeURIComponent("offline_access")), "MS scope includes offline_access");
}

console.log("PASS authorize URL exposes only public values");

// 3. One-time tenant-bound state validation.
{
  const created = createOAuthState(new Date("2026-06-20T00:00:00Z"));
  assert.ok(created.state.length >= 16);
  assert.equal(deriveCodeChallenge(created.codeVerifier), created.codeChallenge);

  const record = {
    state: created.state,
    organizationId: "org_1",
    provider: "google",
    codeVerifier: created.codeVerifier,
    redirectUri: "https://app/cb",
    expiresAt: new Date("2026-06-20T00:10:00Z"),
    consumedAt: null,
  };
  const now = new Date("2026-06-20T00:05:00Z");

  // happy path
  assert.equal(
    validateOAuthState(record, { state: created.state, organizationId: "org_1", now }).ok,
    true
  );
  // wrong/forged state, or no record found
  assert.equal(
    validateOAuthState(record, { state: "WRONG", organizationId: "org_1", now }).reason,
    "STATE_MISMATCH"
  );
  assert.equal(
    validateOAuthState(null, { state: created.state, organizationId: "org_1", now }).reason,
    "STATE_MISMATCH"
  );
  // cross-tenant
  assert.equal(
    validateOAuthState(record, { state: created.state, organizationId: "org_2", now }).reason,
    "TENANT_MISMATCH"
  );
  // replay (already consumed)
  assert.equal(
    validateOAuthState(
      { ...record, consumedAt: new Date("2026-06-20T00:04:00Z") },
      { state: created.state, organizationId: "org_1", now }
    ).reason,
    "ALREADY_USED"
  );
  // expired
  assert.equal(
    validateOAuthState(record, {
      state: created.state,
      organizationId: "org_1",
      now: new Date("2026-06-20T00:11:00Z"),
    }).reason,
    "EXPIRED"
  );
}

console.log("PASS one-time tenant-bound state validation (replay/expiry/cross-tenant)");

// 4. Token parsing requires a refresh token; errors carry no secret.
{
  const ok = parseTokenResponse({
    access_token: "AT",
    refresh_token: "RT",
    expires_in: 3599,
    token_type: "Bearer",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.tokens.refreshToken, "RT");

  assert.equal(parseTokenResponse({ access_token: "AT" }).reason, "MISSING_REFRESH_TOKEN");
  assert.equal(parseTokenResponse({ refresh_token: "RT" }).reason, "MISSING_ACCESS_TOKEN");
  const err = parseTokenResponse({ error: "invalid_grant", error_description: "secret-ish" });
  assert.equal(err.reason, "PROVIDER_ERROR");
  assert.equal(err.detail, "invalid_grant", "only the provider error CODE is surfaced");

  assert.equal(isOAuthProvider("google"), true);
  assert.equal(isOAuthProvider("yahoo"), false);
}

console.log("PASS token parsing requires refresh token, no secret leak");

// 5. Refresh grant: parse + mint access token (refresh token NOT required back).
{
  const ok = parseAccessTokenResponse({ access_token: "AT2", expires_in: 3599 });
  assert.equal(ok.ok, true);
  assert.equal(ok.accessToken, "AT2");
  assert.equal(parseAccessTokenResponse({ token_type: "Bearer" }).reason, "MISSING_ACCESS_TOKEN");

  // mint with injected fetch; client creds from env.
  const env = { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret" };
  let sentBody = "";
  const fetchImpl = async (_url, init) => {
    sentBody = init.body;
    return { json: async () => ({ access_token: "MINTED", expires_in: 3599 }) };
  };
  const minted = await mintAccessToken({
    provider: "google",
    refreshToken: "RT-SECRET",
    env,
    fetchImpl,
  });
  assert.equal(minted.ok, true);
  assert.equal(minted.accessToken, "MINTED");
  assert.ok(sentBody.includes("grant_type=refresh_token"));
  // refresh token goes in the POST body (server-to-server), never in the result.
  assert.ok(!JSON.stringify(minted).includes("RT-SECRET"), "mint result must not echo the refresh token");

  const noCreds = await mintAccessToken({ provider: "google", refreshToken: "x", env: {}, fetchImpl });
  assert.equal(noCreds.reason, "PROVIDER_NOT_CONFIGURED");

  const failFetch = async () => ({ json: async () => ({ error: "invalid_grant" }) });
  const failed = await mintAccessToken({ provider: "google", refreshToken: "x", env, fetchImpl: failFetch });
  assert.equal(failed.reason, "REFRESH_FAILED");
}

console.log("PASS refresh-grant mint access token (no secret leak)");

console.log("PASS V2 S6c OAuth + PKCE security-core smoke");

// ---------------------------------------------------------------------------
function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled
    .split("import.meta.url").join(moduleUrl)
    .split("import.meta").join(`({ url: ${moduleUrl} })`);
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith("@/")) return resolveAndLoad(resolve(rootDir, specifier.slice(2)));
    if (specifier.startsWith(".")) return resolveAndLoad(resolve(dirname(absolutePath), specifier));
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function resolveAndLoad(base) {
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) return loadTsModule(candidate.slice(rootDir.length + 1));
  }
  return require(base);
}
