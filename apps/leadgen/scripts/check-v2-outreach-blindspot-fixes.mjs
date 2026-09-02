import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Blindspot fixes: B1 credential loader (decrypt sender auth, fail-closed) and
// B8 timezone resolution for send windows. Pure.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const cred = loadTsModule("lib/v2/outreach/credentials/credentialLoader.ts");
const tz = loadTsModule("lib/v2/outreach/sequences/resolveTimezone.ts");

// B1: credential loader round-trip + fail-closed + no plaintext
const key = require("node:crypto").randomBytes(32).toString("base64");
const env = { V2_OUTREACH_CREDENTIAL_KEY: key };
const envelope = cred.encryptSenderAuth({ user: "smtp-user", pass: "s3cr3t-app-pass" }, env);
assert.ok(!JSON.stringify(envelope).includes("s3cr3t-app-pass"), "no plaintext password in envelope (B1)");
const back = cred.decryptSenderAuth(envelope, env);
assert.deepEqual(back, { user: "smtp-user", pass: "s3cr3t-app-pass" }, "round-trip decrypts {user,pass}");
assert.throws(() => cred.encryptSenderAuth({ user: "u", pass: "p" }, {}), "encrypt fails closed without master key");
assert.throws(() => cred.decryptSenderAuth(envelope, {}), "decrypt fails closed without master key");
assert.throws(() => cred.decryptSenderAuth({ not: "an envelope" }, env), "rejects non-envelope");

const smtp = cred.loadSmtpConnectionConfig({ smtpHost: "smtp.x.io", smtpPort: 587, smtpSecure: true, smtpAuthEnc: envelope }, env);
assert.deepEqual([smtp.host, smtp.port, smtp.secure, smtp.auth.user], ["smtp.x.io", 587, true, "smtp-user"]);
assert.equal(cred.loadImapConnectionConfig({ smtpHost: "x", smtpPort: 1, smtpSecure: true, smtpAuthEnc: envelope }, env), null, "no IMAP config when fields absent");
const imap = cred.loadImapConnectionConfig({ smtpHost: "x", smtpPort: 1, smtpSecure: true, smtpAuthEnc: envelope, imapHost: "imap.x.io", imapPort: 993, imapSecure: true, imapAuthEnc: envelope }, env);
assert.deepEqual([imap.host, imap.port], ["imap.x.io", 993]);
console.log("PASS B1 credential loader (round-trip, fail-closed, no plaintext, smtp/imap config)");

// B8: timezone -> offset
assert.equal(tz.resolveUtcOffsetMinutes("+07:00"), 420);
assert.equal(tz.resolveUtcOffsetMinutes("-0530"), -330);
assert.equal(tz.resolveUtcOffsetMinutes("Asia/Ho_Chi_Minh"), 420);
assert.equal(tz.resolveUtcOffsetMinutes("America/New_York"), -300);
assert.equal(tz.resolveUtcOffsetMinutes(""), 0, "empty -> UTC");
assert.equal(tz.resolveUtcOffsetMinutes("Not/AZone"), 0, "unknown -> UTC (never throws)");
assert.equal(tz.resolveUtcOffsetMinutes(null), 0);
console.log("PASS B8 timezone resolution (offset strings + common zones + safe default)");
console.log("PASS V2 outreach blindspot fixes (B1 loader + B8 tz)");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith(".")) { const base = resolve(dirname(absolutePath), specifier); for (const c of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(c)) return loadTsModule(c.slice(rootDir.length + 1)); }
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
