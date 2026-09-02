import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const bulkBar = read("components/v2/companies/CompanyBulkBar.tsx");
assert.ok(bulkBar.includes("Add to Leads"), "Bulk bar must expose explicit Add to Leads CTA");
assert.ok(bulkBar.includes("No scoring is queued"), "Add to Leads UI must not imply scoring");
assert.ok(!bulkBar.includes("Score against ICP"), "Bulk bar must not show Score against ICP CTA");
assert.ok(!bulkBar.includes("scoreCompaniesAgainstIcpsAction"), "Bulk bar must not wire company scoring action");

const drawer = read("components/v2/companies/CompanyDrawer.tsx");
assert.ok(drawer.includes("explicit Add to Leads only"), "Drawer LeadAssignments copy must explain explicit pipeline boundary");
assert.ok(!drawer.includes("Score against all ICPs"), "Drawer must not show Score against all ICPs CTA");
assert.ok(!drawer.includes("scoreCompanyAllIcpsAction"), "Drawer must not wire score-all action");
assert.ok(drawer.includes("LazyCompanyContacts"), "Drawer contacts tab must lazy load");
assert.ok(drawer.includes("LazyCompanyActivity"), "Drawer activity tab must lazy load");
assert.ok(drawer.includes("LazyCompanyResearchHistory"), "Drawer history tab must lazy load");

const lazyTabs = read("components/v2/companies/CompanyDrawerLazyTabs.tsx");
assert.ok(lazyTabs.includes('/v2/companies/${companyId}/drawer-tabs?tab=${tab}'), "Lazy drawer tabs must fetch the tenant-scoped drawer API");

const page = read("app/v2/companies/page.tsx");
assert.ok(!page.includes("queryCompanyContacts"), "Page first paint must not eagerly load drawer contacts");
assert.ok(!page.includes("queryCompanyActivity"), "Page first paint must not eagerly load drawer activity");
assert.ok(!page.includes("queryCompanyResearchHistory"), "Page first paint must not eagerly load drawer research history");
assert.ok(page.includes("Drawer Contacts/Activity/History fetch lazily"), "Page should document lazy drawer tab boundary");

console.log("PASS v2 companies see-it guard");
