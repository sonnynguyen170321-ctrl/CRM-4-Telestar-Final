import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const page = readFileSync("app/v2/outreach/sequences/page.tsx", "utf8");

assert.match(page, /SequenceOpsPanel/, "sequence page must expose an operations panel");
assert.match(page, /EnrolledLeadsPanel/, "sequence page must show enrolled leads");
assert.match(page, /EligibleLeadsPanel/, "sequence page must show ready lead pool");
assert.match(page, /enrollReadyLeadsAction/, "sequence page must enroll ready leads from the ops surface");
assert.match(page, /requirePermission\("workflow\.update"\)/, "enrollment action must use workflow.update");
assert.match(page, /liveSendEnabled/, "sequence page must surface sender live gate");
assert.match(page, /Gated: jobs run, provider will not send real mail/, "live gate must be user-visible");
assert.match(page, /V2SequenceEnrollment/, "sequence page must query enrollments");
assert.match(page, /V2OutreachMessage/, "sequence page must query message runtime state");
assert.match(page, /hra\."qualification" = 'QUALIFIED'/, "ready pool must require qualified leads");
assert.match(page, /ci\."type" = 'EMAIL' AND ci\."isValid" = true/, "ready pool must require valid email");
assert.match(page, /NOT EXISTS \([\s\S]*"V2SequenceEnrollment"[\s\S]*"sequenceId" = \$2/, "ready pool must exclude leads already enrolled in selected sequence");
assert.match(page, /tickDueEnrollments/, "run due action must tick sequence enrollments");
assert.match(page, /processNextV2Job/, "run due/enroll actions must drain jobs visibly");

console.log("PASS v2 sequence ops smoke");
