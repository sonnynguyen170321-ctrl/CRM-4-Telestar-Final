import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const runtime = read("lib/v2/outreach/campaigns/campaignRuntime.ts");
const worker = read("lib/v2/outreach/sequences/sequenceStepHandler.ts");
const schedule = read("lib/v2/outreach/campaigns/schedule.ts");
const rendering = read("lib/v2/outreach/campaigns/rendering.ts");

assert.match(runtime, /db\.\$transaction/);
assert.match(runtime, /pg_advisory_xact_lock/);
assert.match(runtime, /organizationId: input\.organizationId/);
assert.match(runtime, /deletedAt: null/);
assert.match(runtime, /V2_OUTREACH_KILL_SWITCH/);
assert.match(runtime, /qualificationOverrideReason/);
assert.match(runtime, /recipientEmailSnapshot/);
assert.match(runtime, /renderContextSnapshotJson/);
assert.match(runtime, /campaign\.qualification_override/);
assert.match(runtime, /campaign\.launched/);
assert.match(runtime, /campaign\.paused/);
assert.match(runtime, /campaign\.resumed/);
assert.match(runtime, /idempotencyKey: "campaign-launch:/);
assert.match(runtime, /idempotencyKey: "campaign-pause:/);
assert.match(runtime, /idempotencyKey: "campaign-resume:/);
assert.match(runtime, /selectSender/);
assert.doesNotMatch(runtime, /qualification.*update/i);

assert.match(worker, /recipientEmailSnapshot/);
assert.match(worker, /prepareCampaignStepMessage/);
assert.match(worker, /sequenceStepVariantId/);
assert.match(worker, /isWithinCampaignWindow/);
assert.match(worker, /nextCampaignWindow/);
assert.match(worker, /EMAIL_SEND/);
assert.doesNotMatch(worker, /resolveUtcOffsetMinutes/);

assert.match(schedule, /Intl\.DateTimeFormat/);
assert.doesNotMatch(schedule, /COMMON_ZONE_OFFSETS/);
assert.match(rendering, /new Liquid/);
assert.match(rendering, /ownPropertyOnly: true/);
assert.match(rendering, /strictVariables: true/);
assert.match(rendering, /templates: \{\}/);
assert.match(rendering, /createHash\("sha256"\)/);

console.log("PASS V2 campaign runtime contract");