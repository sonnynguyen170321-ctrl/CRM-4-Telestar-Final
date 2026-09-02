import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/202607041230_v2_research_prospect_engine/migration.sql");
const planner = read("lib/v2/research/buildDiscoveryQueries.ts");
const runner = read("lib/v2/research/runResearchDiscovery.ts");
const runtimeBridge = read("lib/v2/research/researchRuntimeBridge.ts");
const progress = read("lib/v2/research/progress.ts");
const claim = read("lib/v2/jobs/claimNextJob.ts");
const types = read("lib/v2/jobs/types.ts");
const processRoute = read("app/v2/research/[runId]/process/route.ts");
const progressRoute = read("app/v2/research/[runId]/progress/route.ts");
const drawerRoute = read("app/v2/research/candidates/[candidateId]/drawer/route.ts");
const actions = read("app/v2/research/actions.ts");
const query = read("lib/v2/research/queryResearch.ts");
const promote = read("lib/v2/research/promoteCandidates.ts");
const enrichmentHandler = read("lib/v2/company-intelligence/companyEnrichmentHandler.ts");

assert.match(schema, /paramsJson\s+Json\?/, "V2ResearchRun stores normalized builder params");
assert.match(schema, /queryCursor\s+Int\s+@default\(0\)/, "V2ResearchRun has resumable query cursor");
assert.match(schema, /@@unique\(\[organizationId, runId, dedupeFingerprint\]\)/, "candidate dedupe is run-local");
assert.match(schema, /@@index\(\[organizationId, dedupeFingerprint\]\)/, "cross-run seen-before lookup remains indexed");
assert.match(migration, /DROP INDEX IF EXISTS "V2ResearchCandidate_organizationId_dedupeFingerprint_key"/, "migration removes org-global candidate uniqueness");

assert.match(planner, /DISCOVERY_QUERY_LIMIT_OPTIONS = \[50, 100, 200, 1000\]/, "query planner exposes flexible run caps");
assert.match(planner, /MAX_DISCOVERY_QUERIES = 1000/, "query planner allows up to 1000 queries");
assert.match(planner, /normalizeResearchQueryLimit/, "query planner validates query cap inputs");
assert.match(runner, /DEFAULT_RESEARCH_QUERY_BATCH_SIZE = 3/, "research batches default to 3 queries (auto-drive throughput)");
assert.match(runner, /queryLimit/, "research run stores selected query cap");
assert.match(runner, /research:\$\{input\.runId\}:batch:\$\{input\.cursor\}/, "research jobs are idempotent per run cursor");
assert.match(runner, /"queryCursor" = \$\{cursor\}/, "runtime persists the cursor after batch insert");
assert.match(runner, /GROUP BY "status"/, "runtime recomputes candidate counts from DB");
assert.match(runner, /enqueueResearchBatchJob/, "runtime enqueues the next batch");
assert.match(runner, /planResearchRuntime/, "research run creation plans the V2Runtime bridge");
assert.match(runner, /markResearchDiscoveryChunk[\s\S]*RUNNING/, "discovery marks the runtime chunk running");
assert.match(runner, /markResearchDiscoveryChunk[\s\S]*SUCCEEDED/, "discovery marks the runtime chunk succeeded");
assert.match(runner, /markResearchDiscoveryChunk[\s\S]*FAILED/, "discovery marks the runtime chunk failed on terminal errors");
assert.doesNotMatch(runner, /@\/(lib|app)\/v1|from "\.\.\/\.\.\/v1/, "research runtime must not import V1");

assert.match(types, /sourceType\?: V2JobSourceType/, "job claim options support generic sourceType");
assert.match(types, /sourceId\?: string \| null/, "job claim options support generic sourceId");
assert.match(claim, /options\.sourceType && options\.sourceId && options\.jobType/, "claimNext can scope by source + job type");
assert.match(processRoute, /sourceType: "MANUAL"/, "process route claims only manual research jobs");
assert.match(processRoute, /sourceId: runId/, "process route is scoped to the selected run");
assert.match(processRoute, /PROCESS_BUDGET_MS = 8000/, "process route has an 8s budget");
assert.match(progressRoute, /getResearchRunProgress/, "progress route returns the shared read model");
assert.match(progress, /queryResearchRuntimeBridge/, "progress read model reads the V2Runtime bridge");
assert.match(progress, /source: "hybrid"/, "progress labels bridge-backed runs as hybrid");
assert.match(runtimeBridge, /RESEARCH_RUNTIME_STAGES[\s\S]*research\.discovery[\s\S]*research\.company_enrich[\s\S]*research\.people_discover[\s\S]*research\.contact_enrich[\s\S]*research\.review_ready[\s\S]*research\.promote/, "runtime bridge defines the research stage plan");
assert.match(runtimeBridge, /createRuntimeRun/, "runtime bridge creates a V2RuntimeRun");
assert.match(runtimeBridge, /createRuntimeStage/, "runtime bridge creates V2RuntimeStage rows");
assert.match(runtimeBridge, /createRuntimeChunks/, "runtime bridge creates idempotent V2RuntimeChunk rows");
assert.match(runtimeBridge, /research-runtime:\$\{input\.researchRunId\}:discovery:\$\{cursor\}/, "runtime chunks are idempotent per run cursor");
assert.match(runtimeBridge, /"configJson"->>'researchRunId'/, "runtime bridge links to research run via configJson");

assert.match(drawerRoute, /queryResearchCandidateDrawer/, "drawer API uses the shared drawer read model");
assert.match(drawerRoute, /requirePermission\("ingestion\.apply"\)/, "drawer API is permission gated");
assert.match(drawerRoute, /ctx\.organizationId/, "drawer API reads only tenant scoped data");
assert.match(query, /latestResearchStatus|latestProfileStatus|leadAssignmentId|recommendedAction/, "candidate read model includes review-first fields");
assert.match(query, /v2CompanyResearchSnapshot/, "drawer/read model checks real research snapshots");
assert.match(query, /v2CompanyIntelligenceProfile/, "drawer/read model checks real intelligence profiles");
assert.match(query, /v2LeadAssignment/, "drawer/read model checks real lead assignments");

assert.match(actions, /researchSelectedCandidatesAction/, "research review can queue selected company enrichment");
assert.match(actions, /enqueueCompanyEnrichmentJob/, "research selected queues company enrichment");
assert.match(actions, /source: \{ sourceType: "MANUAL", sourceId: candidate\.run\.id \}/, "research selected is run scoped");
assert.match(actions, /queryLimit: field\(formData, "queryLimit"\)/, "launch action accepts selected query cap");
assert.doesNotMatch(actions, /V2IngestionJob|V2IngestionRow|CSV/, "research promotion does not fake upload jobs or rows");

assert.match(promote, /v2ContactEmployment/, "CONTACT promotion creates/reuses current employment");
assert.match(promote, /enqueueCompanyEnrichmentJob/, "promotion queues company enrichment");
assert.match(promote, /leadUrl: `\/v2\/leads\?leadAssignmentId=\$\{leadAssignmentId\}`/, "promotion returns direct lead links");
assert.match(promote, /scoringQueued: false/, "promotion response explicitly says scoring is not queued");
assert.match(promote, /ctx\.actorRole === "SDR"[\s\S]*return ctx\.actorUserId/, "SDR actor owns promoted lead assignments");
assert.match(promote, /selectedOwnerUserId[\s\S]*v2OrganizationMembership/, "manager selected owner is tenant-validated");
assert.match(promote, /ownerUserId: promotionOwnerUserId/, "promotion writes owner only on explicit promotion");
assert.doesNotMatch(promote, /enqueueIcpScoreJob|lead_assignment_ids/, "research promotion does not queue scoring");
assert.match(enrichmentHandler, /shouldAutoScoreAfterEnrichment/, "enrichment handler can skip auto-score fanout");
assert.match(enrichmentHandler, /sourceType === "INGESTION_JOB" \|\| sourceType === "LEAD_ASSIGNMENT"/, "manual research/company enrichment skips auto scoring by allowlist");

console.log("PASS V2 research runtime prospect engine guards");

function read(path) {
  return readFileSync(path, "utf8");
}
