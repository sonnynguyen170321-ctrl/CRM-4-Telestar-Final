// S6 sender connection-verify smoke — pure, no network.
// Proves: SMTP/IMAP verify ok/fail mapping, fixed error categories, NO credential
// leak in the result, IMAP skipped when unconfigured, lazy imapflow import.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { verifySenderConnection, classifyError } = loadTsModule(
  "lib/v2/outreach/senders/verifySenderConnection.ts"
);

const baseSender = {
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpSecure: false,
  smtpAuthEnc: { ciphertext: "x", iv: "y", authTag: "z", keyVersion: 1 },
  fromAddress: "sdr@example.com",
};

// 1. SMTP + IMAP both ok
{
  const res = await verifySenderConnection(
    { ...baseSender, imapHost: "imap.example.com", imapAuthEnc: { ciphertext: "x" } },
    { verifySmtp: async () => {}, verifyImap: async () => {} }
  );
  assert.equal(res.smtp.ok, true);
  assert.equal(res.imap?.ok, true);
  assert.equal(res.ok, true);
}

// 2. No IMAP configured -> imap is null, ok from smtp alone
{
  const res = await verifySenderConnection(baseSender, { verifySmtp: async () => {} });
  assert.equal(res.imap, null);
  assert.equal(res.ok, true);
}

// 3. SMTP auth failure -> AUTH_FAILED + overall not ok
{
  const res = await verifySenderConnection(baseSender, {
    verifySmtp: async () => {
      throw new Error("Invalid login: 535 5.7.8 authentication failed");
    },
  });
  assert.equal(res.smtp.ok, false);
  assert.equal(res.smtp.error, "AUTH_FAILED");
  assert.equal(res.ok, false);
}

// 4. CRED-LEAK GUARD: provider error echoes the password -> result must carry a
// fixed category, never the secret (Invariant 9).
{
  const SECRET = "P@ssw0rd-MUST-NOT-LEAK-123";
  const res = await verifySenderConnection(
    { ...baseSender, imapHost: "imap.example.com", imapAuthEnc: { ciphertext: "x" } },
    {
      verifySmtp: async () => {
        throw new Error(`535 auth failed user=sdr pass=${SECRET}`);
      },
      verifyImap: async () => {
        throw new Error(`LOGIN failed for pass ${SECRET}`);
      },
    }
  );
  assert.equal(res.smtp.error, "AUTH_FAILED");
  assert.equal(res.imap?.error, "AUTH_FAILED");
  assert.ok(
    !JSON.stringify(res).includes(SECRET),
    "verify result must never contain the credential"
  );
}

// 5. IMAP fails while SMTP ok -> overall not ok
{
  const res = await verifySenderConnection(
    { ...baseSender, imapHost: "imap.example.com", imapAuthEnc: { ciphertext: "x" } },
    {
      verifySmtp: async () => {},
      verifyImap: async () => {
        throw new Error("connect ETIMEDOUT");
      },
    }
  );
  assert.equal(res.smtp.ok, true);
  assert.equal(res.imap?.ok, false);
  assert.equal(res.imap?.error, "TIMEOUT");
  assert.equal(res.ok, false);
}

console.log("PASS verifySenderConnection orchestration + cred-leak guard");

// 6. classifyError category mapping (timeout checked before connection)
assert.equal(classifyError(new Error("Invalid login: 535")), "AUTH_FAILED");
assert.equal(classifyError(new Error("connect ETIMEDOUT 1.2.3.4:587")), "TIMEOUT");
assert.equal(classifyError(new Error("self signed certificate in chain")), "TLS_ERROR");
assert.equal(classifyError(new Error("getaddrinfo ENOTFOUND smtp.bad")), "CONNECTION_FAILED");
assert.equal(classifyError(new Error("something unexpected")), "VERIFY_FAILED");

console.log("PASS classifyError category mapping");

// 7. Source guards
const verifySrc = readFileSync(
  resolve(rootDir, "lib/v2/outreach/senders/verifySenderConnection.ts"),
  "utf8"
);
assert.ok(
  verifySrc.includes("error: classifyError(error)"),
  "failed checks must return a fixed category via classifyError, not a raw message"
);
assert.ok(
  verifySrc.includes('await import("imapflow")'),
  "imapflow must be imported lazily so SMTP-only / injected paths never load it"
);
const transportSrc = readFileSync(
  resolve(rootDir, "lib/v2/outreach/providers/smtpTransport.ts"),
  "utf8"
);
assert.ok(
  transportSrc.includes("export async function verifySmtpConnection") &&
    transportSrc.includes("transporter.verify()"),
  "smtpTransport must expose verifySmtpConnection using nodemailer verify()"
);

console.log("PASS source guards (no raw-error passthrough, lazy imap, smtp verify)");

console.log("PASS V2 S6 sender connection-verify smoke");

// ---------------------------------------------------------------------------
// Loader
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
    if (specifier === "@/lib/server/prisma" || specifier.endsWith("lib/server/prisma")) {
      return { prisma: null };
    }
    if (specifier.startsWith("@/")) return resolveAndLoad(resolve(rootDir, specifier.slice(2)));
    if (specifier.startsWith(".")) return resolveAndLoad(resolve(dirname(absolutePath), specifier));
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(
    localRequire,
    loadedModule,
    loadedModule.exports
  );
  return loadedModule.exports;
}

function resolveAndLoad(base) {
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) return loadTsModule(candidate.slice(rootDir.length + 1));
  }
  return require(base);
}
