import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sideNav = read("components/shared/SideNav.tsx");
const friendlyError = read("components/shared/FriendlyErrorState.tsx");
const leadsError = read("app/v2/leads/error.tsx");

for (const group of ["Targeting", "Pipeline", "Operations", "Outreach", "Settings"]) {
  assert.match(sideNav, new RegExp(`label: "${group}"`), `side nav includes ${group} flow group`);
}

for (const label of [
  "Research",
  "Leads command center",
  "Companies",
  "Contacts",
  "Uploads & ingestion",
  "Campaigns",
]) {
  assert.match(sideNav, new RegExp(label.replaceAll("&", "&")), `side nav keeps ${label}`);
}

assert.doesNotMatch(sideNav, /label: "Operate"|label: "Plan"/, "side nav no longer uses old broad groups");
assert.match(sideNav, /aria-label="V2 workflow navigation"/, "side nav names the workflow navigation landmark");

for (const reason of [
  "missing_provider_key",
  "no_worker_online",
  "rate_limited",
  "no_website",
  "waf_blocked",
  "no_people_found",
  "email_verification_unavailable",
  "permission_denied",
  "tenant_mismatch",
]) {
  assert.match(friendlyError, new RegExp(reason), `friendly error supports ${reason}`);
}

for (const copy of [
  "Provider key is missing",
  "No worker is online",
  "Provider rate limit reached",
  "No website found",
  "Website blocked automated research",
  "No people found yet",
  "Email verification is unavailable",
  "Permission needed",
  "Workspace mismatch",
]) {
  assert.match(friendlyError, new RegExp(copy), `friendly error has copy: ${copy}`);
}

assert.match(leadsError, /FriendlyErrorState/, "leads command center error boundary uses friendly error component");
assert.match(leadsError, /Unable to load the leads command center/, "leads error boundary has contextual copy");

for (const source of [sideNav, friendlyError, leadsError]) {
  assert.doesNotMatch(source, /Outreach[A-Z]/, "flow nav and errors must stay neutral");
  assert.doesNotMatch(source, /V1|from "@\/lib\/(?!utils)/, "flow nav and errors must not import V1 business logic");
}

console.log("PASS V2 flow nav and friendly error guards");

function read(path) {
  return readFileSync(path, "utf8");
}