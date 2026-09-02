import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const actions = read("app/v2/companies/actions.ts");
assert.ok(actions.includes("addCompaniesToLeadsAction"), "Companies must expose explicit Add to Leads action");
assert.ok(actions.includes('INSERT INTO "V2LeadAssignment"'), "Add to Leads must create/reuse real LeadAssignments");
assert.ok(actions.includes('"contactId" IS NULL'), "Company Add to Leads must create company-level assignments only");
assert.ok(actions.includes('INNER JOIN "V2Offer" offer') && actions.includes('project."id" = offer."projectId"'), "Add to Leads must resolve ICP project through Offer");
assert.ok(!/fanOutCompanyScoring|scoreCompaniesAgainstIcps|FanOutScoringDb/.test(actions), "Companies actions must not import company scoring helpers");
assert.ok(!/jobType:\s*"ICP_SCORE"/.test(actions), "Companies actions must not drain/enqueue ICP_SCORE");
assert.ok(/jobType:\s*"COMPANY_ENRICHMENT"/.test(actions), "Companies enrichment may only drain COMPANY_ENRICHMENT");

const dbHandler = read("lib/v2/company-intelligence/companyEnrichmentHandler.ts");
assert.match(dbHandler, /sourceType === "INGESTION_JOB" \|\| sourceType === "LEAD_ASSIGNMENT"/, "DB enrichment auto-score must be allowlisted to ingestion/lead-scoped sources");
assert.ok(!/startsWith\("rr_"\)/.test(dbHandler), "Research-only skip must not be the whole auto-score policy");

const bullHandler = read("lib/v2/company-intelligence/runtime/enrichmentProcessors.ts");
assert.match(bullHandler, /shouldAutoScoreAfterEnrichment\(job\.sourceType \?\? "MANUAL"\)/, "Bull enrichment must treat missing source as MANUAL");
assert.match(bullHandler, /sourceType === "INGESTION_JOB" \|\| sourceType === "LEAD_ASSIGNMENT"/, "Bull enrichment auto-score must be allowlisted");

const enqueue = read("lib/v2/company-intelligence/runtime/enqueueEnrichment.ts");
assert.ok(enqueue.includes("source?: { sourceType: V2JobSourceType; sourceId: string | null }"), "Bull enrichment wrapper must carry source scope");
assert.ok(enqueue.includes('sourceType: input.source?.sourceType ?? "MANUAL"'), "Bull enrichment must default source to MANUAL");

const readModel = read("lib/v2/company-intelligence/readModel.ts");
assert.ok(readModel.includes("withFacetCache"), "Company filter facets must use facet cache");
assert.ok(readModel.includes("queryCompanyDirectoryFilterOptions(organizationId, activeDb)"), "Facet cache should avoid recursive cache wrapping by passing db");

assert.ok(existsSync(new URL("../app/v2/companies/[companyId]/drawer-tabs/route.ts", import.meta.url)), "Lazy drawer tab API must exist");

console.log("PASS v2 companies runtime policy guard");
