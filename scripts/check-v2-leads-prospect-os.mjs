import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (path) => readFileSync(path, "utf8");

const filters = read("components/v2/leads/LeadWorkspaceFilters.tsx");
assert.match(filters, /name="clientAccountId"/, "sidebar must own Account context");
assert.match(filters, /name="projectId"/, "sidebar must own Project context");
assert.match(filters, /name="icpVersionId"/, "sidebar must own ICP context");
assert.match(filters, /FacetSelect/, "sidebar must expose grouped prospect facets");
assert.match(filters, /type="submit"[\s\S]*Apply/, "Apply button must submit filters");
assert.doesNotMatch(filters, /fetch\(["']\/v2\/leads\/rescore-view/, "Apply/sidebar must not call scoring");

const chips = read("components/v2/leads/LeadContextBar.tsx");
for (const key of [
  "clientAccountId",
  "projectId",
  "icpVersionId",
  "contactReadiness",
  "enrollment",
  "intelligenceStatus",
  "factToken",
]) {
  assert.match(chips, new RegExp(`${key}:`), `active chips must include ${key}`);
}

const query = read("lib/v2/crm/queryLeadWorkspace.ts");
assert.match(query, /factFacets: groupFactFacets/, "read-model must return grouped fact facets");
assert.match(query, /industry\./, "fact facets must group industry tokens");
assert.match(query, /offering\./, "fact facets must group offering tokens");
assert.match(query, /size\./, "fact facets must group size tokens");
assert.match(query, /revenue\./, "fact facets must group revenue tokens");

const table = read("components/v2/leads/LeadWorkspaceTable.tsx");
assert.match(table, /One-off|Email/, "table must expose one-off email action");
assert.match(table, /EnrollSequenceDialog/, "table must expose sequence enrollment");
assert.match(table, /Detail/, "table must expose open detail action");

const drawer = read("components/v2/leads/LeadDrawer.tsx");
for (const title of [
  "Company Brief",
  "Reason Breakdown",
  "Key Info",
  "Signals",
  "Score Components",
  "Next Best Action",
]) {
  assert.match(drawer, new RegExp(title), `drawer must include ${title}`);
}
assert.match(drawer, /ContactProfilePanel/, "drawer must include contact-profile panel");
assert.match(drawer, /value="outreach"/, "drawer must include outreach tab");

const route = read("app/v2/leads/rescore-view/route.ts");
assert.match(route, /requirePermission\("workflow\.update"\)/, "view scoring route must be permission gated");
assert.match(route, /project\."organizationId" = \$2/, "view scoring route must be tenant-scoped");
assert.match(route, /counts/, "view scoring route must return scoring counts");

console.log("PASS v2 leads prospect OS smoke");
