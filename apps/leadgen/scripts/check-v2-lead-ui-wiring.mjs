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

const tabs = read("components/shared/Tabs.tsx");
const dataTable = read("components/shared/DataTable.tsx");
const bulkShell = read("components/v2/shared/BulkActionBarShell.tsx");
const filter = read("components/v2/leads/LeadFilterSidebar.tsx");
const parser = read("lib/v2/crm/leadWorkspaceFilters.ts");
const query = read("lib/v2/crm/queryContactLeads.ts");
const drawer = read("components/v2/leads/UnifiedLeadDrawer.tsx");
const actions = read("components/v2/leads/LeadDrawerActions.tsx");
const leadTable = read("components/v2/leads/LeadWorkspaceTable.tsx");
const contactLeadsTable = read("components/v2/leads/ContactLeadsTable.tsx");
const contactWorkspaceTable = read("components/v2/contacts/ContactWorkspaceTable.tsx");
const contactDrawer = read("components/v2/contacts/ContactDrawer.tsx");
const filterAccordion = read("components/v2/premium-filters/FilterAccordion.tsx");
const filterCombobox = read("components/v2/premium-filters/FilterCombobox.tsx");
const bulkBar = read("components/v2/leads/LeadBulkActionBar.tsx");
const contactBulkActionBar = read("components/v2/contacts/ContactBulkActionBar.tsx");
const companyBulkBar = read("components/v2/companies/CompanyBulkBar.tsx");
const accountWorkspace = read("components/v2/accounts/AccountWorkspaceClient.tsx");
const uploadWorkspace = read("components/v2/uploads/UploadWorkspace.tsx");
const addToCampaign = read("components/v2/leads/AddToCampaignDialog.tsx");
const assignContacts = read("components/v2/contacts/AssignContactsToIcpDialog.tsx");
const enrollSequence = read("components/v2/leads/EnrollSequenceDialog.tsx");
const leadsPage = read("app/v2/workspace/leads/page.tsx");
const scoreJobs = read("lib/v2/scoring/runtime/enqueueScoringJobs.ts");
const scoreExecution = read("lib/v2/scoring/runtime/enqueueScoringExecution.ts");
const scoreDialog = read("components/v2/leads/ScoreAgainstIcpDialog.tsx");
const scoreRoute = read("app/v2/workspace/leads/score-icp/route.ts");
const companiesPage = read("app/v2/crm/companies/page.tsx");
const companyReadModel = read("lib/v2/company-intelligence/readModel.ts");
const taskTransition = read("components/v2/shared/taskTransition.tsx");
const runtimeHeaderBadge = read("components/v2/runtime/RuntimeHeaderBadge.tsx");
const runtimeStatusBadge = read("components/v2/runtime/RuntimeStatusBadge.tsx");
const researchRunPanel = read("components/v2/research/RunProgressPanel.tsx");
const ingestionProgressPanel = read("components/v2/ingestion/ProgressPanel.tsx");
const ingestionStepper = read("components/v2/ingestion/PipelineStepper.tsx");
const ingestionJobPage = read("app/v2/ingestion/[jobId]/page.tsx");

assert(tabs.includes("data-tab-value") && tabs.includes("ArrowRight") && tabs.includes("Home") && tabs.includes("End"), "shared Tabs support arrow/Home/End keyboard navigation");
assert(tabs.includes("border-primary text-foreground") && !tabs.includes("border-[#") && !tabs.includes("text-[#"), "shared Tabs active state uses V2 tokens");
assert(tabs.includes("focus-visible:ring"), "shared Tabs expose visible keyboard focus");
assert(dataTable.includes("Page {page} of {totalPages} - {label}") && !dataTable.includes("Â") && !dataTable.includes("â"), "DataTable pagination has clean visible copy");
assert(dataTable.includes("focus-visible:ring"), "DataTable pagination links expose visible keyboard focus");
assert(bulkShell.includes("BulkActionBarShell") && bulkShell.includes("bg-surface") && bulkShell.includes("border-hairline"), "bulk bars share the restrained V2 shell");
assert(bulkBar.includes("BulkActionBarShell") && contactBulkActionBar.includes("BulkActionBarShell") && companyBulkBar.includes("BulkActionBarShell"), "lead/contact/company bulk bars use the shared shell");
for (const [name, source] of [["AddToCampaignDialog", addToCampaign], ["AssignContactsToIcpDialog", assignContacts], ["EnrollSequenceDialog", enrollSequence], ["LeadBulkActionBar", bulkBar], ["ContactBulkActionBar", contactBulkActionBar], ["CompanyBulkBar", companyBulkBar]]) {
  assert(!source.includes("Â") && !source.includes("â"), `${name} has no visible mojibake`);
}
assert(!enrollSequence.includes("Add to sequence") && !enrollSequence.includes("Enroll in sequence"), "legacy enrollment dialog no longer exposes direct sequence CTA copy");
assert(!assignContacts.includes("LeadAssignment is created"), "contact assignment dialog uses business-facing ICP assignment copy");
assert(accountWorkspace.includes("DataTable") && !accountWorkspace.includes("shadow-premium") && !accountWorkspace.includes("bg-white"), "accounts workspace uses shared table/surface polish vocabulary");
assert(contactDrawer.includes("TabsTrigger") && !contactDrawer.includes("function TabButton") && !contactDrawer.includes("shadow-premium") && !contactDrawer.includes("backdrop-blur"), "contact drawer uses shared tabs and restrained drawer styling");
assert(uploadWorkspace.includes("DataTable") && uploadWorkspace.includes("UploadJobStatusBadge") && !uploadWorkspace.includes("<table") && !uploadWorkspace.includes("Â") && !uploadWorkspace.includes("â"), "uploads workspace uses shared DataTable and clean visible copy");

for (const key of ["clientAccountId", "projectId", "icpVersionId", "qualification", "workflowStatus", "contactReadiness", "search"]) {
  assert(filter.includes(key), `LeadFilterSidebar renders or writes ${key}`);
  assert(parser.includes(`"${key}"`), `parseLeadWorkspaceFilters parses ${key}`);
}

assert(query.includes("f.contactReadiness"), "queryContactLeads applies contactReadiness");
assert(!filter.includes("linkedinAccess"), "LeadFilterSidebar does not render dead linkedinAccess param");
assert(!filter.includes("SmartViewButton"), "LeadFilterSidebar no longer renders legacy smart-view filter block");
assert(drawer.includes('defaultValue="outreach"'), "lead drawer opens on Outreach tab");
assert(drawer.includes("deriveContactability"), "lead drawer derives contactability from contact identifiers");
assert(drawer.includes("outreachReady={outreachReady}"), "lead drawer passes outreach readiness to actions");
assert(actions.includes("AddToCampaignDialog"), "lead drawer uses Add to campaign action");
assert(actions.includes("outreachReady ? [leadAssignmentId] : []"), "campaign action is disabled unless outreach-ready");
assert(actions.includes("Email blocked"), "one-off email action shows disabled reason when not ready");
assert(!bulkBar.includes("EnrollSequenceDialog"), "bulk selection bar does not expose direct sequence enrollment");
assert(bulkBar.includes("AddToCampaignDialog"), "bulk selection bar keeps Add to campaign as the campaign-scoped flow");
for (const [name, source] of [["lead table", leadTable], ["contact leads table", contactLeadsTable], ["contacts table", contactWorkspaceTable], ["lead drawer actions", actions]]) {
  assert(!source.includes("EnrollSequenceDialog"), `${name} does not expose direct sequence enrollment`);
  assert(!source.includes('triggerLabel="Sequence"') && !source.includes("Add to sequence") && !source.includes("Sequence blocked"), `${name} has no visible Sequence CTA`);
  assert(source.includes("AddToCampaignDialog"), `${name} routes visible outreach batch action through Add to campaign`);
}
assert(filterAccordion.includes("aria-expanded") && filterAccordion.includes("aria-controls") && filterAccordion.includes('type="button"'), "filter accordion headers are real accessible buttons");
assert(filterCombobox.includes("aria-pressed") && filterCombobox.includes("allowExclude") && filterCombobox.includes("aria-label={`Include"), "filter combobox rows are keyboard/touch-safe controls");
assert(!contactDrawer.includes("Company ID (UUID)") && !contactDrawer.includes("Search coming soon") && !contactDrawer.includes("EmploymentForm"), "contact drawer does not expose raw schema employment form");
assert(!leadsPage.includes("linkedinAccess"), "leads page no longer parses the dead linkedinAccess filter param");
assert(scoreJobs.includes("buildRuntimeIcpScoreJobIdempotencyKey"), "runtime scoring jobs use run-scoped idempotency");
assert(scoreJobs.includes("input.runtimeRunId") && scoreJobs.includes("runtime-run"), "runtimeRunId creates a fresh executable ICP_SCORE job per UI run");
assert(scoreExecution.includes("bull_worker_unhealthy") && scoreExecution.includes("enqueueDbFallback"), "Bull scoring without a healthy worker falls back to DB ICP_SCORE");
assert(scoreExecution.includes("bull_enqueue_failed") && scoreExecution.includes("queryScoringWorkerHealthy"), "Bull enqueue failure is observable and falls back");
assert(scoreRoute.includes("executionReason") && scoreRoute.includes("drainMode") && scoreRoute.includes('result.mode === "db"'), "score route returns execution metadata and only drains DB fallback");
assert(scoreRoute.includes("processNextV2Job") && scoreRoute.includes("immediateDrainResult") && scoreRoute.includes("jobId: result.jobId"), "score route immediately claims the exact DB fallback scoring job");
assert(companiesPage.includes('export const dynamic = "force-dynamic"') && companiesPage.includes('withSpan("companies.page"'), "companies page is dynamic and traced");
assert(companyReadModel.includes('withSpan("companies.drawer.detail"') && companyReadModel.includes('traceQuery("companies.drawer.detail.all"'), "company drawer detail hydration is traced");
assert(!scoreDialog.includes("router.refresh();\n        onDone?.();"), "score dialog does not clear selection immediately after enqueue");
assert(scoreDialog.includes("void poll();") && scoreDialog.includes("Still waiting at 0/"), "score dialog polls immediately and exposes stuck runs");
assert(taskTransition.includes("TaskTransitionView") && taskTransition.includes("Partially completed") && taskTransition.includes("humanizeTaskToken"), "shared task transition presenter defines canonical lifecycle language");
for (const [name, source] of [["RuntimeHeaderBadge", runtimeHeaderBadge], ["RuntimeStatusBadge", runtimeStatusBadge], ["ScoreAgainstIcpDialog", scoreDialog], ["CompanyBulkBar", companyBulkBar], ["ResearchRunPanel", researchRunPanel], ["IngestionProgressPanel", ingestionProgressPanel], ["IngestionStepper", ingestionStepper], ["IngestionJobPage", ingestionJobPage]]) {
  assert(source.includes("taskTransition") || source.includes("TaskProgressBar") || source.includes("TaskStatusPill"), `${name} uses shared transition presentation`);
  assert(!source.includes("transition-all"), `${name} avoids transition-all on progress/state bars`);
  assert(!source.includes("Â") && !source.includes("â"), `${name} has no visible mojibake`);
}
assert(ingestionProgressPanel.includes("Advanced runtime controls") && !ingestionProgressPanel.includes("Copy Debug JSON") && !ingestionProgressPanel.includes("Process Next") && !ingestionProgressPanel.includes("Run Until Idle"), "ingestion debug controls are behind business-readable advanced controls");
assert(ingestionJobPage.includes("Open progress panel") && !ingestionJobPage.includes("Open live controls") && !ingestionJobPage.includes("Run Until Idle"), "ingestion next action uses business-readable progress copy");
assert(ingestionJobPage.includes("Create ICP assignments") && ingestionJobPage.includes("Score against ICP"), "ingestion stages use business-facing stage labels");

if (!process.exitCode) {
  console.log("PASS: V2 lead UI wiring is coherent");
}
