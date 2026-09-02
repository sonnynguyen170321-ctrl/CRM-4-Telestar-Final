import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// O3 smoke: credential encryption (B1), sender-pool selector + warmup (B6/B9), and
// the provider boundary that cannot send without the suppression gate (B5). Also
// covers warmup (the plan's check-v2-warmup). Pure: no DB, no network.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const enc = loadTsModule("lib/v2/outreach/credentials/encryption.ts");
const pool = loadTsModule("lib/v2/outreach/senderPool/policy.ts");
const providers = loadTsModule("lib/v2/outreach/providers/index.ts");

// 1. Credential encryption (B1)
const key = Buffer.from(enc.generateMasterKeyBase64(), "base64");
assert.equal(key.length, 32);
const envelope = enc.encryptSecret("smtp-app-password-123", key);
assert.ok(envelope.ciphertext && envelope.iv && envelope.authTag && envelope.keyVersion === 1);
assert.ok(!JSON.stringify(envelope).includes("smtp-app-password-123"), "plaintext never appears in the envelope");
assert.equal(enc.decryptSecret(envelope, key), "smtp-app-password-123", "round-trip decrypts");
const tampered = { ...envelope, authTag: Buffer.from("0".repeat(16)).toString("base64") };
assert.throws(() => enc.decryptSecret(tampered, key), "tampered envelope fails auth tag");
assert.throws(() => enc.loadMasterKey({}), "missing master key fails closed");
assert.throws(() => enc.loadMasterKey({ V2_OUTREACH_CREDENTIAL_KEY: Buffer.from("short").toString("base64") }), "wrong key size fails");
assert.ok(enc.loadMasterKey({ V2_OUTREACH_CREDENTIAL_KEY: enc.generateMasterKeyBase64() }).length === 32);
console.log("PASS B1 credential encryption (round-trip, no plaintext, tamper-detected, fail-closed)");

// 2. Sender-pool selector + caps (B6) + warmup (B9)
const sender = (over) => ({
  id: "s", kind: "MAILBOX", status: "ACTIVE", dailyCapCurrent: 100, dailyCapTarget: 500,
  warmupStage: 5, bounceRate: 0.005, complaintRate: 0, sentToday: 0, lastSendAt: null, ...over,
});
assert.equal(pool.effectiveDailyCap(sender({ kind: "MAILBOX", dailyCapCurrent: 100, dailyCapTarget: 500 })), 100, "mailbox bounded by warmup");
assert.equal(pool.effectiveDailyCap(sender({ kind: "RELAY", dailyCapTarget: 5000 })), 5000, "relay uses target");
assert.equal(pool.remainingCap(sender({ dailyCapCurrent: 100, sentToday: 90 })), 10);
assert.equal(pool.wouldExceedCap(100, 100), true);
assert.equal(pool.wouldExceedCap(99, 100), false);

const relay = sender({ id: "relay", kind: "RELAY", dailyCapTarget: 5000, sentToday: 100 });
const warm = sender({ id: "warm", dailyCapCurrent: 200, sentToday: 10 });
const degraded = sender({ id: "deg", status: "DEGRADED" });
const overCap = sender({ id: "full", dailyCapCurrent: 50, sentToday: 50 });
const unhealthy = sender({ id: "bouncy", bounceRate: 0.2 });

const pick = pool.selectSender([degraded, overCap, unhealthy, warm, relay]);
assert.ok(pick && (pick.id === "relay" || pick.id === "warm"), "selects a healthy sender with remaining cap");
assert.equal(pool.selectSender([degraded, overCap, unhealthy]), null, "no healthy/capped sender -> null");
assert.equal(pool.selectSender([relay, warm], { kind: "MAILBOX" }).id, "warm", "kind filter respected");

const up = pool.advanceWarmup(sender({ dailyCapCurrent: 100, dailyCapTarget: 500 }), { healthy: true });
assert.ok(up.dailyCapCurrent > 100 && up.dailyCapCurrent <= 500 && !up.rolledBack, "healthy day ramps cap up");
const back = pool.advanceWarmup(sender({ dailyCapCurrent: 200 }), { healthy: false });
assert.ok(back.dailyCapCurrent < 200 && back.rolledBack && back.status === "DEGRADED", "bad health rolls back + degrades");
assert.equal(pool.advanceWarmup(sender({ kind: "RELAY" }), { healthy: false }).rolledBack, false, "relay does not warm up");
assert.equal(pool.isWarmedForSteadyState(sender({ warmupStage: 2 })), false);
assert.equal(pool.isWarmedForSteadyState(sender({ kind: "RELAY", warmupStage: 0 })), true);
console.log("PASS B6/B9 sender selector + caps + warmup ramp/rollback");

// 3. Provider boundary cannot send without the gate (B5)
const sandbox = new providers.SandboxProvider();
await assert.rejects(
  () => sandbox.send({ from: "a@x.io", to: "b@y.io", subject: "s", body: "b", messageId: "<m1@x.io>" }, {}),
  /requires a GatePassToken/,
  "provider rejects a forged token"
);
const clean = async () => [];
const result = await providers.executeSend({
  provider: sandbox,
  organizationId: "org1",
  loadCandidates: clean,
  request: { from: "a@x.io", to: "b@y.io", subject: "Hi", body: "Body", messageId: "<m1@x.io>" },
});
assert.ok(result.accepted && result.providerMessageId === "<m1@x.io>", "executeSend sends through the gate");
assert.equal(sandbox.sent.length, 1);

// suppressed recipient blocks before the provider is called
const hit = async () => [{ id: "s", identifierType: "EMAIL", identifierValueNormalized: "b@y.io", suppressionType: "BOUNCE", deletedAt: null, expiresAt: null }];
await assert.rejects(
  () => providers.executeSend({ provider: sandbox, organizationId: "org1", loadCandidates: hit, request: { from: "a@x.io", to: "b@y.io", subject: "Hi", body: "B", messageId: "<m2@x.io>" } }),
  (e) => e.code === "SUPPRESSED"
);
assert.equal(sandbox.sent.length, 1, "suppressed send never reached the provider");

// SMTP adapter is inert until O9
const smtp = new providers.SmtpAdapter({ liveSendEnabled: false });
const tokenViaGate = await providers.executeSend({
  provider: { name: "capture", send: async (_r, t) => ({ providerMessageId: "x", accepted: true, _t: t }) },
  organizationId: "org1", loadCandidates: clean,
  request: { from: "a@x.io", to: "ok@z.io", subject: "s", body: "b", messageId: "<m3@x.io>" },
});
await assert.rejects(
  () => smtp.send({ from: "a@x.io", to: "ok@z.io", subject: "s", body: "b", messageId: "<m4@x.io>" }, tokenViaGate._t),
  /SMTP live send is disabled/,
  "SMTP adapter inert until O9 even with a valid token"
);
console.log("PASS B5 provider boundary requires the gate; suppressed blocked; SMTP inert until O9");
console.log("PASS V2 provider abstraction + sender pool + warmup (O3)");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith(".")) {
      const base = resolve(dirname(absolutePath), specifier);
      for (const c of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(c)) return loadTsModule(c.slice(rootDir.length + 1));
    }
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
