import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  }
}

const identity = read("lib/v2/research/candidateIdentity.ts");
const harvester = read("lib/v2/research/parseDiscoveryResults.ts");
const query = read("lib/v2/research/queryResearch.ts");
const drawer = read("components/v2/research/ResearchCandidateDrawer.tsx");
const grid = read("components/v2/research/ProspectGrid.tsx");
const promote = read("lib/v2/research/promoteCandidates.ts");

assert(identity.includes("resolveResearchCompanyIdentity"), "canonical research company identity resolver exists");
assert(identity.includes('kind === "COMPANY"') && identity.includes("return null"), "contact identity never falls back to person name as company");
assert(identity.includes("scoped_run") && identity.includes("candidate_domain") && identity.includes("official_source_url") && identity.includes("existing_company"), "identity source precedence is represented");
assert(query.includes("company: ResearchCompanyIdentity") && query.includes("person: { name"), "research row exposes canonical company and person submodels");
assert(query.includes("readCompanyScope(r.run.paramsJson)") && query.includes("companyDomainFromUrl(source.url)"), "research query resolves scoped and source URL domains");
assert(drawer.includes("companyIdentity") && drawer.includes("Add company domain first"), "research drawer uses canonical identity and disables unresolved contact promotion");
// The excluded-domain blocklist now lives once in the harvester and is imported here, instead of
// being a second hand-maintained copy that could drift. Assert the wiring + the shared source.
assert(
  identity.includes("EXCLUDED_PROSPECT_DOMAINS") &&
    identity.includes('from "./parseDiscoveryResults"') &&
    harvester.includes("export const EXCLUDED_HOSTS") &&
    harvester.includes("linkedin.com") &&
    identity.includes("GENERIC_PLATFORM_COMPANY_LABELS"),
  "identity resolver excludes LinkedIn/social/aggregator domains and labels (shared blocklist)"
);
assert(query.includes("find_company_website") && drawer.includes("launchCompanyWebsiteRunAction") && grid.includes("find_company_website"), "unresolved contact candidates route to a website discovery action");
assert(grid.includes("c.company.displayName") && grid.includes("canPromoteCandidate"), "research table uses canonical company fields and excludes unresolved contact promotions");
assert(promote.includes("resolveResearchCompanyIdentity") && promote.includes("Company domain is unresolved"), "promotion uses the same resolver and refuses unresolved contact-company creation");
assert(!drawer.includes('value={company?.name ?? candidate.companyName ?? "No company match"}'), "drawer no longer renders raw No company match fallback");

if (!process.exitCode) {
  console.log("PASS: V2 research identity wiring is canonical");
}
