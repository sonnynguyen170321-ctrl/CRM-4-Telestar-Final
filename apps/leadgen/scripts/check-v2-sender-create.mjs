// OL4 createSender smoke — proves credentials are encrypted before the DB and a
// new sender starts gated. Pure (injected db; node crypto for the envelope).

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { createSender, validateCreateSenderInput } = loadTsModule(
  "lib/v2/outreach/senders/createSender.ts"
);

const PLAINTEXT_PASS = "SuperSecret-SMTP-Pass-123";
const PLAINTEXT_IMAP = "SuperSecret-IMAP-Pass-456";

function makeDb() {
  const calls = [];
  return { calls, async $executeRawUnsafe(query, ...values) { calls.push({ query, values }); return 1; } };
}

const validInput = {
  organizationId: "org_1",
  createdByUserId: "user_1",
  kind: "MAILBOX",
  displayName: "Ada Outreach",
  fromAddress: "Ada@Example.com",
  fromName: "Ada",
  domain: "Example.com",
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "ada@example.com",
  smtpPass: PLAINTEXT_PASS,
  imapHost: "imap.example.com",
  imapPort: 993,
  imapSecure: true,
  imapUser: "ada@example.com",
  imapPass: PLAINTEXT_IMAP,
  dailyCapTarget: 40,
};

// 1. With the master key set: creds encrypted, no plaintext, sender gated.
{
  process.env.V2_OUTREACH_CREDENTIAL_KEY = Buffer.alloc(32, 7).toString("base64");
  const db = makeDb();
  const { id } = await createSender(db, validInput, process.env);
  assert.ok(id.startsWith("snd_"), "returns a sender id");
  assert.equal(db.calls.length, 1, "one insert");
  const { query, values } = db.calls[0];

  assert.ok(query.includes('INSERT INTO "V2SenderAccount"'), "inserts a sender row");
  assert.ok(query.includes("'ACTIVE', false,"), "liveSendEnabled hardcoded false (gated until cutover)");

  // No raw value equals or contains the plaintext passwords.
  for (const v of values) {
    if (typeof v === "string") {
      assert.ok(!v.includes(PLAINTEXT_PASS), "SMTP plaintext password never in an insert param");
      assert.ok(!v.includes(PLAINTEXT_IMAP), "IMAP plaintext password never in an insert param");
    }
  }
  // Two encrypted envelopes (smtp + imap) are present.
  const envelopes = values.filter((v) => typeof v === "string" && v.includes("ciphertext") && v.includes("authTag"));
  assert.equal(envelopes.length, 2, "smtp + imap creds stored as encrypted envelopes");
  // The from address + domain are normalized to lowercase.
  assert.ok(values.includes("ada@example.com"), "from address normalized lowercase");
  assert.ok(values.includes("example.com"), "domain normalized lowercase");
}
console.log("PASS createSender encrypts creds (no plaintext) + starts gated");

// 2. Validation rejects bad input.
{
  assert.equal(validateCreateSenderInput({ ...validInput, smtpPass: "" }), "SMTP credentials are required.");
  assert.equal(validateCreateSenderInput({ ...validInput, fromAddress: "not-an-email" }), "A valid from address is required.");
  assert.equal(validateCreateSenderInput({ ...validInput, imapHost: "imap.x.com", imapUser: "", imapPass: "" }), "IMAP host requires IMAP credentials.");
  assert.equal(validateCreateSenderInput(validInput), null);
}
console.log("PASS createSender input validation");

// 3. Fail closed: no master key -> throws, no DB write.
{
  delete process.env.V2_OUTREACH_CREDENTIAL_KEY;
  const db = makeDb();
  await assert.rejects(() => createSender(db, validInput, process.env), /V2_OUTREACH_CREDENTIAL_KEY/);
  assert.equal(db.calls.length, 0, "no insert attempted when encryption is unavailable (fail closed)");
}
console.log("PASS createSender fails closed without the master key");

console.log("PASS V2 sender create (OL4)");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled.split("import.meta.url").join(moduleUrl).split("import.meta").join(`({ url: ${moduleUrl} })`);
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "@/lib/server/prisma" || specifier.endsWith("lib/server/prisma")) return { prisma: null };
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
