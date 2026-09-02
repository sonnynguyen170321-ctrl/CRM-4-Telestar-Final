import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const exists = (path) => existsSync(resolve(root, path));

for (const [path, target] of [
  ["app/v2/leads/page.tsx", "/v2/workspace/leads"],
  ["app/v2/companies/page.tsx", "/v2/crm/companies"],
  ["app/v2/contacts/page.tsx", "/v2/crm/contacts"],
  ["app/v2/uploads/page.tsx", "/v2/ingestion/uploads"],
  ["app/v2/jobs/page.tsx", "/v2/ingestion/jobs"],
  ["app/v2/accounts/page.tsx", "/v2/workspace/accounts"],
  ["app/v2/projects/page.tsx", "/v2/workspace/projects"],
]) {
  assert.ok(exists(path), `${path} alias must exist`);
  assert.ok(read(path).includes(`redirect("${target}")`), `${path} must redirect to ${target}`);
}

const appShell = read("components/shared/AppShell.tsx");
const v2Layout = read("app/v2/layout.tsx");
assert.equal((appShell.match(/<CommandPalette/g) ?? []).length, 0, "AppShell must not mount a second command palette");
assert.equal((v2Layout.match(/<CommandPalette/g) ?? []).length, 1, "V2 layout must mount the single command palette");

const watcher = read("components/v2/shell/GlobalJobWatcher.tsx");
assert.ok(!watcher.includes("router.refresh()"), "Global watcher must not refresh every mutation globally");
assert.ok(!watcher.includes('"system"') && !watcher.includes('"alert"'), "Watcher notification kinds must match V2 contract");
assert.ok(watcher.includes("notifyV2"), "Watcher should use the normalized notification client");

const pipeline = read("components/v2/shell/PipelineFlowWidget.tsx");
assert.ok(!pipeline.includes("setTimeout"), "Pipeline widget must not simulate backend work");
assert.ok(!pipeline.includes("120 pending") && !pipeline.includes("450 new leads"), "Pipeline widget must not show fake counts");
assert.ok(!pipeline.includes("toast.success"), "Pipeline widget must not show fake success toasts");

const emailActions = read("app/v2/outreach/campaigns/[campaignId]/emailActions.ts");
assert.ok(!emailActions.includes("outreach.operator"), "Campaign email actions must use valid permissions");
assert.ok(!emailActions.includes("Fake stub logic"), "Campaign email actions must not advertise fake server behavior");
assert.ok(!emailActions.includes('status: "QUEUED"'), "Campaign email stabilization must not fake-queue sends");

console.log("PASS Antigravity stabilization guard");
