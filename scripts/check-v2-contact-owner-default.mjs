import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("app/v2/leads/score-icp/route.ts", "utf8");
const runtime = readFileSync("lib/v2/scoring/runtime/scoreLeadsAgainstIcp.ts", "utf8");

const bulkBar = readFileSync("components/v2/contacts/ContactBulkActionBar.tsx", "utf8");
const ownerDialog = readFileSync("components/v2/contacts/AssignOwnerDialog.tsx", "utf8");
const assignAction = readFileSync("app/v2/contacts/assignOwnerAction.ts", "utf8");
const suggestions = readFileSync("lib/v2/crm/contactFilterSuggestions.ts", "utf8");

assert.ok(
  route.includes('ownerUserId: context.role === "SDR" ? context.userId : null'),
  "score-ICP route should default owner only for SDR actors"
);
assert.ok(
  route.includes("ownerAssigned: result.ownerAssigned"),
  "score-ICP route should return the owner assignment count"
);
assert.ok(
  runtime.includes("ownerUserId?: string | null"),
  "scoreLeadsAgainstIcp should accept an optional owner default"
);
assert.ok(
  runtime.includes('"ownerUserId" IS NULL'),
  "existing leads should only be auto-owned when still unassigned"
);
assert.ok(
  runtime.includes('eventType: "lead.assigned"'),
  "auto-owner changes should be audited as lead assignments"
);
assert.ok(
  runtime.includes('source: "contacts.add_to_leads"'),
  "audit metadata should identify the Contacts Add to Leads source"
);
assert.equal(
  runtime.includes('context.role === "MANAGER" ? context.userId : null'),
  false,
  "manager/admin Add to Leads must not self-claim ownership"
);

assert.ok(
  bulkBar.includes("BulkAssignOwnerDialog"),
  "Contacts bulk bar should render a large Assign owner action"
);
assert.ok(
  bulkBar.includes("canAssign ?"),
  "Bulk Assign should stay gated by lead.assign permission"
);
assert.ok(
  ownerDialog.includes("router.refresh()"),
  "Assign owner dialogs should refresh the contacts table after assignment"
);
assert.ok(
  assignAction.includes("export async function assignOwnersAction"),
  "Bulk assign should have a server action"
);
assert.ok(
  assignAction.includes("assignLead(prisma as unknown as AssignLeadDb"),
  "Bulk assign should reuse assignLead so audit wiring stays centralized"
);
assert.ok(
  suggestions.includes("queryCachedContactFilterSuggestions") && suggestions.includes("queryAssignableMembers(organizationId)"),
  "Contact owner options should be queried fresh instead of cached with facets"
);

console.log("PASS V2 contacts owner default and bulk assign contract");
