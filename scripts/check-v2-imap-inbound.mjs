import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// O7 smoke (security): inbound trust = correlation to a real outbound Message-ID
// (B3/B14). Un-correlatable mail (forged DSN / spoofed reply) is IGNORED. Hard
// bounce -> suppression; reply -> timeline + halt; unsubscribe -> suppression.
// Pure: no DB/network.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { correlateInbound, decideInboundAction } = loadTsModule("lib/v2/outreach/inbound/correlateInbound.ts");
const { parseDsn } = loadTsModule("lib/v2/outreach/inbound/parseDsn.ts");

const ours = new Set(["<sent1@telestar.io>", "<sent2@telestar.io>"]);

// 1. Reply correlated -> process + halt + timeline
const reply = correlateInbound(
  { inReplyTo: "<sent1@telestar.io>", subject: "Re: hello", rawHeaders: "From: prospect@acme.com\nSubject: Re: hello", rawBody: "Sounds interesting, let's talk." },
  ours
);
assert.equal(reply.kind, "reply");
assert.equal(reply.correlatedMessageId, "<sent1@telestar.io>");
const replyAction = decideInboundAction(reply);
assert.deepEqual([replyAction.action, replyAction.haltSequence, replyAction.activityEventKind], ["process", true, "outreach.replied"]);
console.log("PASS reply correlated -> process + halt + timeline");

// 2. Hard-bounce DSN correlated -> suppress + halt
const hardBody = "Final-Recipient: rfc822; prospect@acme.com\nAction: failed\nStatus: 5.1.1\nMessage-ID: <sent2@telestar.io>";
const hard = correlateInbound(
  { rawHeaders: "From: MAILER-DAEMON@telestar.io\nContent-Type: multipart/report; report-type=delivery-status", rawBody: hardBody },
  ours
);
assert.equal(hard.kind, "bounce_dsn");
assert.equal(hard.correlatedMessageId, "<sent2@telestar.io>");
assert.equal(hard.dsn.isHardBounce, true);
const hardAction = decideInboundAction(hard);
assert.deepEqual([hardAction.action, hardAction.createSuppression, hardAction.suppressionType, hardAction.haltSequence], ["process", true, "BOUNCE", true]);
console.log("PASS hard-bounce DSN correlated -> suppress + halt");

// 3. Soft bounce -> retry, no permanent suppression
const soft = correlateInbound(
  { rawHeaders: "From: MAILER-DAEMON@telestar.io\nContent-Type: multipart/report; report-type=delivery-status", rawBody: "Final-Recipient: rfc822; p@acme.com\nStatus: 4.2.2\nMessage-ID: <sent1@telestar.io>" },
  ours
);
const softAction = decideInboundAction(soft);
assert.equal(soft.dsn.isSoftBounce, true);
assert.deepEqual([softAction.createSuppression, softAction.retrySoftBounce], [false, true]);
console.log("PASS soft bounce -> retry, no suppression");

// 4. SECURITY: forged DSN naming a Message-ID we never sent -> IGNORED (B3)
const forgedDsn = correlateInbound(
  { rawHeaders: "From: MAILER-DAEMON@evil.com\nContent-Type: multipart/report; report-type=delivery-status", rawBody: "Final-Recipient: rfc822; victim@competitor.com\nStatus: 5.1.1\nMessage-ID: <forged@evil.com>" },
  ours
);
assert.equal(forgedDsn.kind, "uncorrelated");
assert.equal(forgedDsn.correlatedMessageId, null);
assert.equal(decideInboundAction(forgedDsn).action, "ignore", "forged DSN cannot suppress an arbitrary address");
assert.equal(decideInboundAction(forgedDsn).createSuppression, false);

// spoofed reply referencing an unknown Message-ID -> ignored
const spoofReply = correlateInbound({ inReplyTo: "<unknown@evil.com>", subject: "Re:", rawHeaders: "From: x", rawBody: "hi" }, ours);
assert.equal(spoofReply.kind, "uncorrelated");
assert.equal(decideInboundAction(spoofReply).action, "ignore");
console.log("PASS SECURITY: un-correlatable inbound (forged DSN / spoofed reply) is ignored");

// 5. Unsubscribe correlated -> suppress (UNSUBSCRIBE) + halt
const unsub = correlateInbound({ inReplyTo: "<sent1@telestar.io>", subject: "unsubscribe", rawHeaders: "From: p@acme.com", rawBody: "unsubscribe" }, ours);
assert.equal(unsub.kind, "unsubscribe");
const unsubAction = decideInboundAction(unsub);
assert.deepEqual([unsubAction.createSuppression, unsubAction.suppressionType, unsubAction.haltSequence], [true, "UNSUBSCRIBE", true]);
console.log("PASS unsubscribe correlated -> suppress (UNSUBSCRIBE) + halt");

// 6. parseDsn basics
const p = parseDsn("Content-Type: multipart/report; report-type=delivery-status", "Status: 5.7.1\nFinal-Recipient: rfc822; a@b.com\nMessage-ID: <m@x>");
assert.equal(p.isDsn, true);
assert.equal(p.dsnStatus, "5.7.1");
assert.equal(p.isHardBounce, true);
assert.equal(p.originalRecipient, "a@b.com");
console.log("PASS parseDsn extracts status/recipient/original-message-id");
console.log("PASS V2 IMAP inbound correlation (O7)");

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
