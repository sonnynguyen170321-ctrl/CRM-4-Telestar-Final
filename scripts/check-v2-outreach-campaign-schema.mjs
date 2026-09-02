import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/202606191600_v2_outreach_campaign_contract/migration.sql");
const permissions = read("lib/v2/tenant/permissions.ts");
const permissionTypes = read("lib/v2/tenant/types.ts");
const domainTypes = read("lib/v2/outreach/campaigns/types.ts");

function model(name) {
  const match = schema.match(new RegExp("model " + name + " \\{([\\s\\S]*?)\\n\\}"));
  assert.ok(match, name + " must exist");
  return match[1];
}

for (const name of [
  "V2SequenceSenderAccount",
  "V2SequenceStepVariant",
  "V2LeadOutreachProfile",
  "V2TrackingDomain",
  "V2OutreachTrackingLink",
  "V2OutreachTrackingEvent",
  "V2OutreachAuditEvent",
]) model(name);

const pool = model("V2SequenceSenderAccount");
assert.match(pool, /organizationId\s+String/);
assert.match(pool, /@@unique\(\[organizationId, sequenceId, senderAccountId\](?:,\s*map:\s*"[^"]+")?\)/);
assert.match(model("V2SequenceEnrollment"), /senderAccountId\s+String/);

const variant = model("V2SequenceStepVariant");
assert.match(variant, /weight\s+Int\s+@default\(100\)/);
assert.match(model("V2OutreachMessage"), /sequenceStepVariantId\s+String\?/);

const profile = model("V2LeadOutreachProfile");
assert.match(profile, /leadAssignmentId\s+String/);
assert.doesNotMatch(profile, /companyId/);
assert.match(profile, /sourceFingerprint\s+String/);

const enrollment = model("V2SequenceEnrollment");
for (const field of [
  "recipientEmailSnapshot",
  "timezoneSnapshot",
  "renderContextSnapshotJson",
  "outreachProfileFingerprint",
  "qualificationOverrideReason",
  "qualificationOverrideByUserId",
  "qualificationOverrideAt",
]) assert.match(enrollment, new RegExp("\\b" + field + "\\b"));

const trackingDomain = model("V2TrackingDomain");
assert.match(trackingDomain, /organizationId\s+String/);
assert.match(trackingDomain, /deletedAt\s+DateTime\?/);
assert.match(model("V2OutreachTrackingLink"), /token\s+String\s+@unique(?:\(map:\s*"[^"]+"\))?/);
assert.match(model("V2OutreachTrackingEvent"), /botClassification\s+V2TrackingBotClassification/);

const audit = model("V2OutreachAuditEvent");
assert.match(audit, /@@unique\(\[organizationId, idempotencyKey\](?:,\s*map:\s*"[^"]+")?\)/);
assert.doesNotMatch(audit, /deletedAt/);

assert.match(permissionTypes, /"outreach\.admin"/);
assert.match(permissions, /"outreach\.admin": \["OWNER", "ADMIN"\]/);
assert.doesNotMatch(permissions, /"outreach\.admin": \[[^\]]*"MANAGER"/);

assert.match(domainTypes, /v2\.campaign-schedule\.v1/);
assert.match(domainTypes, /V2CampaignReadinessBlockerCode/);

assert.match(migration, /Backfill each existing EMAIL step/);
assert.match(migration, /Preserve current sticky senders/);
assert.match(migration, /ON CONFLICT \("organizationId", "sequenceStepId", "variantKey"\) DO NOTHING/);
assert.match(migration, /V2OutreachAuditEvent_org_idempotency_key/);
assert.ok(
  migration.indexOf("V2SequenceStepVariant_org_step_key_key") <
    migration.indexOf("Backfill each existing EMAIL step"),
  "variant unique index must exist before ON CONFLICT backfill"
);
assert.ok(
  migration.indexOf("V2SequenceSenderAccount_org_sequence_sender_key") <
    migration.indexOf("Preserve current sticky senders"),
  "sender-pool unique index must exist before ON CONFLICT backfill"
);

console.log("PASS V2 outreach campaign schema/domain contract");