import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const workspaceProjection = read("lib/v2/research/workspaceProjection.ts");
const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/202607051130_v2_research_evidence_foundation/migration.sql");
const evidenceStore = read("lib/v2/research/evidenceStore.ts");
const query = read("lib/v2/research/queryResearch.ts");
const actions = read("app/v2/research/actions.ts");
const promote = read("lib/v2/research/promoteCandidates.ts");
const runtime = read("lib/v2/research/runResearchDiscovery.ts");
const enrich = read("lib/v2/research/enrichCandidateHandler.ts");
const companyDepth = read("lib/v2/company-intelligence/companyDepthSignals.ts");
const companyResearch = read("lib/v2/company-intelligence/runCompanyResearch.ts");
const companyCrawler = read("lib/v2/company-intelligence/crawlCompanySite.ts");
const pageModel = read("lib/v2/company-intelligence/reasoning/pageModel.ts");
const peopleDiscovery = read("lib/v2/research/peopleDiscovery.ts");
const contactWaterfall = read("lib/v2/research/enrichContact.ts");
const seeIt = read("scripts/check-v2-research-see-it.mjs");

assert.match(workspaceProjection, /export type ResearchWorkspaceProjection/, "research workspace has a shared projection contract");
assert.match(workspaceProjection, /runtimeSource\?: ResearchRuntimeSource/, "projection can label legacy V2Job vs future V2Runtime state");
assert.match(workspaceProjection, /legacy_v2job|v2runtime|hybrid/, "projection supports migration bridge runtime labels");
assert.match(workspaceProjection, /deriveResearchWorkspaceProjection/, "projection exposes one derivation helper");
assert.match(workspaceProjection, /reviewable|enriched|withLeadAssignment/, "projection derives review/intelligence/pipeline metrics from real candidates");
assert.match(workspaceProjection, /ResearchProgressPayload/, "projection consumes the real progress read model");
assert.match(workspaceProjection, /ResearchCandidateRow/, "projection consumes the real candidate read model");
assert.match(schema, /model V2ResearchEvidence/, "schema has research evidence ledger");
assert.match(schema, /model V2ResearchFieldObservation/, "schema has extracted field observations");
assert.match(schema, /model V2ResearchProviderAttempt/, "schema has provider attempt ledger");
assert.match(schema, /model V2ResearchEmailPattern/, "schema has learned email pattern ledger");
assert.match(schema, /@@unique\(\[organizationId, idempotencyKey\]\)/, "evidence ledger has tenant-scoped idempotency");
assert.match(migration, /CREATE TABLE "V2ResearchEvidence"/, "migration creates evidence table");
assert.match(migration, /REFERENCES "V2Organization"\("id"\) ON DELETE RESTRICT/, "migration keeps tenant ownership restrictive");
assert.match(evidenceStore, /recordResearchEvidence/, "evidence store writes source evidence");
assert.match(evidenceStore, /recordResearchFieldObservation/, "evidence store writes field observations");
assert.match(evidenceStore, /recordResearchProviderAttempt/, "evidence store writes provider attempts");
assert.match(evidenceStore, /upsertResearchEmailPattern/, "evidence store can learn email patterns");
assert.match(evidenceStore, /"organizationId", "idempotencyKey"/, "evidence writes are tenant-idempotent");

assert.match(query, /v2CompanyResearchSnapshot/, "research read model reads real company research snapshots");
assert.match(query, /v2CompanyIntelligenceProfile/, "research read model reads real intelligence profiles");
assert.match(query, /v2LeadAssignment/, "research read model reads real LeadAssignments");
assert.match(query, /lookupProspects/, "research read model uses the durable prospect ledger");

assert.match(actions, /promoteCandidatesAction/, "research exposes explicit promotion action");
assert.match(actions, /researchSelectedCandidatesAction/, "research exposes explicit depth/enrichment action");
assert.doesNotMatch(actions, /V2IngestionJob|V2IngestionRow|CSV/, "research must not fake upload jobs or rows");

assert.match(promote, /enqueueCompanyEnrichmentJob/, "research promotion queues enrichment");
assert.doesNotMatch(promote, /enqueueIcpScoreJob|ICP_SCORE|scoreLeadAssignments|scoreCompaniesAgainstIcps/, "research promotion must not queue scoring");
assert.doesNotMatch(runtime, /from ["'][^"']*openleads|from ["'][^"']*holehe|from ["'][^"']*phoneinfoga/i, "research runtime must not import OSS packages directly");
assert.doesNotMatch(runtime, /@\/(lib|app)\/v1|from ["']\.\.\/\.\.\/v1/, "research runtime must not import V1 business logic");
assert.match(runtime, /recordDiscoveryCandidateEvidence/, "discovery writes candidate evidence after DB candidate upsert");
assert.match(runtime, /safeRecordProviderAttempt/, "discovery writes provider attempts without changing runtime semantics");
assert.match(enrich, /recordEnrichmentEvidence/, "research enrichment writes evidence observations");
assert.match(enrich, /research\.company_enrich/, "research enrichment writes company-enrich provider attempts");
assert.match(companyDepth, /CompanyDepthTerminalState[\s\S]*ENRICHED[\s\S]*PARTIAL[\s\S]*NO_DOMAIN[\s\S]*NO_WEBSITE[\s\S]*WAF_BLOCKED[\s\S]*PARKED[\s\S]*TIMEOUT[\s\S]*FAILED/, "company depth terminal states are explicit");
assert.match(companyDepth, /ROLE_LOCAL_PARTS/, "role emails are separated from personal emails");
assert.match(companyDepth, /learnEmailPatterns/, "company enrichment learns email patterns from personal emails");
assert.match(companyResearch, /depthTerminalState/, "company research persists depth terminal state in source coverage");
assert.match(companyResearch, /publicEmailCount|teamHintCount|learnedEmailPatterns/, "company research persists structured depth coverage");
assert.match(companyCrawler, /seedCompanyCrawlUrls[\s\S]*\/team[\s\S]*\/leadership[\s\S]*\/people[\s\S]*\/security\.txt[\s\S]*\.well-known\/security\.txt/, "company crawler seeds OpenLeads-grade depth paths");
assert.match(pageModel, /LEADERSHIP|TEAM|SECURITY/, "page model classifies team and security pages");
assert.match(enrich, /public_personal_email|role_email|team_hint|upsertResearchEmailPattern/, "research company enrichment records structured observations and learned patterns");
assert.match(peopleDiscovery, /discoverPeopleAtCompany/, "people discovery derives contacts from company evidence");
assert.match(peopleDiscovery, /extractLinkedInPeopleFromText/, "people discovery parses public LinkedIn snippets");
assert.match(peopleDiscovery, /REJECT_TITLE_RE/, "people discovery rejects assistant/context-only titles");
assert.match(enrich, /createLinkedContactCandidates/, "research enrichment creates linked contact candidates");
assert.match(enrich, /sourceKind: "company_people_discovery"/, "linked contact candidates keep source linkage to company evidence");
assert.match(enrich, /kind: "CONTACT"/, "people discovery creates CONTACT candidates only after company enrichment");
assert.match(contactWaterfall, /VERIFIED" \| "LIKELY" \| "GUESSED" \| "RISKY" \| "INVALID" \| "MISSING"/, "contact enrichment persists expanded email tiers");
assert.match(contactWaterfall, /public_exact_email[\s\S]*learned_pattern[\s\S]*common_pattern[\s\S]*mx[\s\S]*spf[\s\S]*dmarc[\s\S]*reacher[\s\S]*gravatar[\s\S]*smtp/, "contact enrichment runs a staged waterfall");
assert.match(contactWaterfall, /REACHER_URL[\s\S]*RESEARCH_GRAVATAR_SIGNAL[\s\S]*RESEARCH_SMTP_PROBE/, "network-heavy contact verification is feature gated");
assert.match(contactWaterfall, /listResearchEmailPatterns/, "contact enrichment consumes learned domain email patterns");
assert.match(contactWaterfall, /contact_email_waterfall[\s\S]*recordResearchProviderAttempt/, "contact waterfall writes evidence and provider attempts");
assert.doesNotMatch(contactWaterfall, /ICP_SCORE/, "contact enrichment does not queue scoring");

assert.match(seeIt, /fake|mock/i, "SEE-IT guard must keep fake display data out");

const forbiddenNames = ["openleads", "holehe", "phoneinfoga"];
for (const file of listFiles(["app/v2/research", "components/v2/research", "lib/v2/research"])) {
  const normalized = file.replaceAll("\\", "/").toLowerCase();
  for (const name of forbiddenNames) {
    assert.ok(!normalized.includes(`/${name}/`) && !normalized.includes(`${name}-`), `research core must not vendor ${name}: ${file}`);
  }
  const source = read(file);
  assert.doesNotMatch(source, /from ["'][^"']*(openleads|holehe|phoneinfoga)/i, `research core must not import restricted OSS: ${file}`);
}

console.log("PASS V2 research OpenLeads-grade remake contract guards");

function read(file) {
  return readFileSync(file, "utf8");
}

function listFiles(roots) {
  const out = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    walk(root, out);
  }
  return out.filter((file) => /\.(tsx?|mjs|cjs|jsx?)$/.test(file));
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
}
