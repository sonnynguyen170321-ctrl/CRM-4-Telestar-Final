// OL2 inbound APPLY runtime smoke — pure logic over an injected fake db (no real
// DB, no network). Proves the inbound runtime closes Link B correctly:
//  - idempotent: a duplicate (senderAccountId, mailboxUid) re-processes nothing.
//  - forged / uncorrelated mail is stored UNCORRELATED and otherwise IGNORED
//    (no suppression / halt / activity) — trust-by-correlation (B3/B14).
//  - hard bounce  => BOUNCE suppression + halt + message BOUNCED + activity.
//  - unsubscribe  => UNSUBSCRIBE suppression + halt + activity.
//  - reply        => halt + message REPLIED + activity + workflow -> RESPONDED, no suppression.
//  - soft bounce  => activity only (no suppression, no halt).

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { applyInboundEvent, inboundEventKind } = loadTsModule(
  "lib/v2/outreach/inbound/applyInboundEvent.ts"
);

const OUR_ID = "<msg-abc-123@telestar.ai>";

function makeDb({ message } = {}) {
  const seen = new Set();
  const executed = [];
  const tx = {
    async $queryRawUnsafe(query, ...values) {
      if (query.includes('FROM "V2OutreachMessage"')) {
        const providerMessageId = values[1];
        return message && providerMessageId === OUR_ID ? [message] : [];
      }
      return [];
    },
    async $executeRawUnsafe(query, ...values) {
      if (query.includes('INSERT INTO "V2InboundMailEvent"')) {
        const key = `${values[2]}|${values[3]}`; // senderAccountId|mailboxUid
        if (seen.has(key)) return 0;
        seen.add(key);
        executed.push({ kind: "inbound_event", query, values });
        return 1;
      }
      if (query.includes('INSERT INTO "V2SuppressionEntry"')) executed.push({ kind: "suppression", query, values });
      else if (query.includes('UPDATE "V2SequenceEnrollment"')) executed.push({ kind: "halt", query, values });
      else if (query.includes('UPDATE "V2OutreachMessage"')) executed.push({ kind: "message_status", query, values });
      else if (query.includes('INSERT INTO "V2OutreachActivity"')) executed.push({ kind: "activity", query, values });
      else if (query.includes('UPDATE "V2LeadAssignment"')) executed.push({ kind: "workflow", query, values });
      return 1;
    },
  };
  return {
    ...tx,
    async $transaction(fn) {
      return fn(tx);
    },
    executed,
  };
}

const message = {
  id: "msg_row_1",
  leadAssignmentId: "la_1",
  contactId: "ct_1",
  enrollmentId: "enr_1",
  toAddress: "Prospect@Example.com",
  status: "SENT",
};

function input(headers, mailboxUid = "uid_1") {
  return {
    organizationId: "org_1",
    senderAccountId: "snd_1",
    mailboxUid,
    inboundMessageId: "<inbound@example.com>",
    headers,
    ourOutboundMessageIds: new Set([OUR_ID]),
  };
}

function kinds(db) {
  return db.executed.map((e) => e.kind);
}

// 1. Reply correlated -> halt + REPLIED + activity + workflow RESPONDED, no suppression.
{
  const db = makeDb({ message });
  const r = await applyInboundEvent(db, input({
    inReplyTo: OUR_ID,
    subject: "Re: your note",
    rawHeaders: "From: prospect@example.com",
    rawBody: "Sounds good, let's talk.",
  }));
  assert.equal(r.applied, true);
  assert.equal(r.eventKind, "REPLY");
  assert.equal(r.haltedSequence, true);
  assert.equal(r.activityEventKind, "outreach.replied");
  const k = kinds(db);
  assert.ok(k.includes("halt"), "reply halts the enrollment");
  assert.ok(k.includes("message_status"), "reply advances the message to REPLIED");
  assert.ok(k.includes("activity"), "reply writes a Link A activity");
  assert.ok(k.includes("workflow"), "reply nudges workflow -> RESPONDED");
  assert.ok(!k.includes("suppression"), "reply NEVER suppresses");
}
console.log("PASS reply -> halt + REPLIED + activity + RESPONDED, no suppression");

// 2. Hard bounce DSN -> BOUNCE suppression + halt + BOUNCED + activity.
{
  const db = makeDb({ message });
  const r = await applyInboundEvent(db, input({
    subject: "Delivery Status Notification (Failure)",
    rawHeaders: "From: MAILER-DAEMON@example.com\nContent-Type: multipart/report; report-type=delivery-status",
    rawBody: `Status: 5.1.1\nFinal-Recipient: rfc822; prospect@example.com\nOriginal-Message-ID: ${OUR_ID}`,
  }));
  assert.equal(r.eventKind, "BOUNCE_DSN");
  assert.equal(r.createdSuppression, true);
  const k = kinds(db);
  assert.ok(k.includes("suppression"), "hard bounce creates suppression");
  assert.ok(k.includes("halt"), "hard bounce halts the enrollment");
  assert.ok(k.includes("message_status"), "hard bounce advances the message to BOUNCED");
  assert.ok(k.includes("activity"), "hard bounce writes activity");
  // suppression on the lowercased recipient
  const supp = db.executed.find((e) => e.kind === "suppression");
  assert.ok(supp.values.includes("prospect@example.com"), "suppression normalizes the recipient to lowercase");
}
console.log("PASS hard bounce -> suppression + halt + BOUNCED + activity");

// 3. Unsubscribe -> UNSUBSCRIBE suppression + halt + activity.
{
  const db = makeDb({ message });
  const r = await applyInboundEvent(db, input({
    inReplyTo: OUR_ID,
    subject: "unsubscribe",
    rawHeaders: "From: prospect@example.com",
    rawBody: "unsubscribe",
  }));
  assert.equal(r.eventKind, "UNSUBSCRIBE");
  assert.equal(r.createdSuppression, true);
  const k = kinds(db);
  assert.ok(k.includes("suppression") && k.includes("halt") && k.includes("activity"));
}
console.log("PASS unsubscribe -> suppression + halt + activity");

// 4. Forged / uncorrelated -> stored UNCORRELATED, NO side effects.
{
  const db = makeDb({ message });
  const r = await applyInboundEvent(db, input({
    inReplyTo: "<not-ours@evil.com>",
    subject: "Re: spoofed",
    rawHeaders: "From: attacker@evil.com",
    rawBody: "click here",
  }));
  assert.equal(r.eventKind, "UNCORRELATED");
  assert.equal(r.applied, true);
  assert.equal(r.createdSuppression, false);
  assert.equal(r.haltedSequence, false);
  const k = kinds(db);
  assert.deepEqual(k, ["inbound_event"], "forged mail records ONLY the event, no suppression/halt/activity");
}
console.log("PASS forged/uncorrelated -> stored only, ignored (B3/B14)");

// 5. Soft bounce -> activity only, no suppression, no halt.
{
  const db = makeDb({ message });
  const r = await applyInboundEvent(db, input({
    subject: "Delayed",
    rawHeaders: "From: postmaster@example.com\nContent-Type: multipart/report; report-type=delivery-status",
    rawBody: `Status: 4.2.2\nOriginal-Message-ID: ${OUR_ID}`,
  }));
  assert.equal(r.eventKind, "BOUNCE_DSN");
  assert.equal(r.createdSuppression, false);
  const k = kinds(db);
  assert.ok(k.includes("activity"), "soft bounce writes activity");
  assert.ok(!k.includes("suppression"), "soft bounce never suppresses");
  assert.ok(!k.includes("halt"), "soft bounce does not halt");
  assert.ok(!k.includes("message_status"), "soft bounce does not flip the message status");
}
console.log("PASS soft bounce -> activity only");

// 6. Idempotency: same (sender, uid) twice -> second is a no-op.
{
  const db = makeDb({ message });
  const headers = { inReplyTo: OUR_ID, subject: "Re: hi", rawHeaders: "From: p@example.com", rawBody: "hi" };
  const first = await applyInboundEvent(db, input(headers, "uid_dup"));
  const second = await applyInboundEvent(db, input(headers, "uid_dup"));
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(second.duplicate, true);
  // The second run wrote no new side effects (only the first's effects exist).
  const haltCount = db.executed.filter((e) => e.kind === "halt").length;
  assert.equal(haltCount, 1, "duplicate poll does not re-halt");
}
console.log("PASS idempotent on (senderAccountId, mailboxUid)");

assert.equal(inboundEventKind("reply"), "REPLY");
assert.equal(inboundEventKind("uncorrelated"), "UNCORRELATED");

console.log("PASS V2 inbound APPLY runtime (OL2)");

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

  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function resolveAndLoad(base) {
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) return loadTsModule(candidate.slice(rootDir.length + 1));
  }
  return require(base);
}
