import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// O1 schema guard: assert the outreach schema encodes the design decisions
// (docs/v2/plan/V2_OUTREACH_PILLAR_DESIGN.md) and the T1 timeline contract §3.
// Reads prisma/schema.prisma; pure, no DB/network.

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = readFileSync(resolve(rootDir, "prisma/schema.prisma"), "utf8").replace(/\r\n/g, "\n");

function modelBlock(name) {
  const m = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `model ${name} must exist`);
  return m[1];
}

// 1. All 8 outreach models present
const models = [
  "V2SenderAccount",
  "V2SenderDailySend",
  "V2Sequence",
  "V2SequenceStep",
  "V2SequenceEnrollment",
  "V2OutreachMessage",
  "V2OutreachActivity",
  "V2InboundMailEvent",
];
const blocks = Object.fromEntries(models.map((m) => [m, modelBlock(m)]));
console.log(`PASS all ${models.length} outreach models present`);

// 2. Enums (incl. the send state machine + sender kinds)
for (const [name, values] of [
  ["V2SenderKind", ["RELAY", "MAILBOX"]],
  ["V2OutreachMessageStatus", ["QUEUED", "SENDING", "SENT", "FAILED", "BOUNCED"]],
  ["V2InboundEventKind", ["REPLY", "BOUNCE_DSN", "UNSUBSCRIBE", "UNCORRELATED"]],
]) {
  const e = schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(e, `enum ${name} must exist`);
  for (const v of values) assert.ok(e[1].includes(v), `enum ${name} must include ${v}`);
}
console.log("PASS outreach enums (sender kinds + send state machine + inbound kinds)");

// 3. B1 — credentials are encrypted envelopes, NEVER plaintext
const sender = blocks.V2SenderAccount;
assert.ok(/smtpAuthEnc\s+Json/.test(sender), "V2SenderAccount.smtpAuthEnc is an encrypted Json envelope");
assert.ok(/imapAuthEnc\s+Json\?/.test(sender), "V2SenderAccount.imapAuthEnc is an encrypted Json envelope");
// match field declarations only (e.g. "smtpPassword String"), not prose in comments
for (const forbidden of ["smtpPassword", "imapPassword", "password", "smtpPass", "imapPass"]) {
  assert.ok(
    !new RegExp(`^\\s*${forbidden}\\s+(String|Json|Bytes)`, "im").test(sender),
    `V2SenderAccount must not have a plaintext secret field (${forbidden})`
  );
}
assert.ok(/liveSendEnabled\s+Boolean\s+@default\(false\)/.test(sender), "live send disabled by default (O9 gate)");
assert.ok(/warmupStage/.test(sender) && /dailyCapTarget/.test(sender) && /dailyCapCurrent/.test(sender), "warmup + cap fields present");
assert.ok(/bounceRate/.test(sender) && /complaintRate/.test(sender), "rolling health fields present");
console.log("PASS B1 sender credentials are encrypted envelopes (no plaintext) + warmup/health/live-gate fields");

// 4. B6 — atomic per-sender-per-day cap counter
assert.ok(/@@unique\(\[senderAccountId, sendDate\]\)/.test(blocks.V2SenderDailySend), "V2SenderDailySend unique per (sender, day)");
console.log("PASS B6 atomic per-sender-per-day cap table");

// 5. B2 — send state machine + B13 idempotency + B3 high-entropy Message-ID on V2OutreachMessage
const msg = blocks.V2OutreachMessage;
for (const f of ["status", "sendAttemptToken", "sendingAt", "sentAt", "providerMessageId", "idempotencyKey", "inReplyToId", "listUnsubscribeToken"]) {
  assert.ok(new RegExp(`\\b${f}\\b`).test(msg), `V2OutreachMessage.${f} present`);
}
assert.ok(/@@unique\(\[organizationId, idempotencyKey\]\)/.test(msg), "message idempotency unique (B13)");
assert.ok(/@@unique\(\[providerMessageId\]\)/.test(msg), "providerMessageId globally unique (B3/B14)");
console.log("PASS B2/B13/B3 send state machine + idempotency key + unique Message-ID");

// 6. B7 — Link A timeline union fields on V2OutreachActivity (T1 contract §3)
const act = blocks.V2OutreachActivity;
for (const f of ["leadAssignmentId", "occurredAt", "eventKind", "channel"]) {
  assert.ok(new RegExp(`\\b${f}\\b`).test(act), `V2OutreachActivity exposes Link A field ${f}`);
}
assert.ok(/@@index\(\[organizationId, leadAssignmentId, occurredAt\]\)/.test(act), "timeline hot-path index present");
console.log("PASS B7 Link A timeline union fields (leadAssignmentId/occurredAt/eventKind/channel)");

// 7. B12 — sticky sender + idempotent enrollment
const enr = blocks.V2SequenceEnrollment;
assert.ok(/senderAccountId\s+String/.test(enr), "enrollment binds a sticky senderAccountId (B12)");
assert.ok(/@@unique\(\[organizationId, sequenceId, leadAssignmentId\]\)/.test(enr), "enrollment idempotent per (org, sequence, lead)");
console.log("PASS B12 sticky sender + idempotent enrollment");

// 8. B3/B14 — inbound correlation idempotency + tenant-scoped correlation
const inbound = blocks.V2InboundMailEvent;
assert.ok(/@@unique\(\[senderAccountId, mailboxUid\]\)/.test(inbound), "inbound idempotent per (sender, mailbox UID)");
assert.ok(/correlatedMessageId/.test(inbound), "inbound correlates to an outbound Message-ID");
console.log("PASS B3/B14 inbound correlation idempotency + tenant-scoped correlation");

// 9. Invariant 2 — outreach attaches to LeadAssignment, never a global company score
for (const m of ["V2OutreachMessage", "V2OutreachActivity", "V2SequenceEnrollment"]) {
  assert.ok(/leadAssignmentId\s+String/.test(blocks[m]), `${m} attaches to leadAssignmentId (Invariant 2)`);
}
console.log("PASS Invariant 2 outreach attaches to LeadAssignment (no global company score)");
console.log("PASS V2 outreach schema (O1) guard");
