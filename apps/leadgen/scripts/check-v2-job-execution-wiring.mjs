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

const types = read("lib/v2/jobs/types.ts");
const claim = read("lib/v2/jobs/claimNextJob.ts");
const scoreRoute = read("app/v2/workspace/leads/score-icp/route.ts");
const companyRunProcess = read("app/v2/crm/companies/runs/[runId]/process/route.ts");
const jobOps = read("lib/v2/jobs/ops/jobOps.ts");
const jobActions = read("app/v2/ingestion/jobs/actions.ts");
const companiesPage = read("app/v2/crm/companies/page.tsx");
const companyReadModel = read("lib/v2/company-intelligence/readModel.ts");
const diagnostic = read("scripts/diagnose-v2-job-runtime.mjs");

assert(types.includes("jobId?: string"), "ClaimNextJobOptions supports exact jobId claims");
assert(claim.includes("options.jobId") && claim.includes('AND "id" = ${options.jobId}'), "claimNextV2Job can claim an exact queued job");
assert(scoreRoute.includes("processNextV2Job") && scoreRoute.includes("jobId: result.jobId") && scoreRoute.includes("immediateDrainResult"), "score ICP route immediately drains the exact DB fallback job");
assert(scoreRoute.includes('withSpan("score-icp.submit"'), "score ICP submit path is traced");
assert(companyRunProcess.includes("'SUCCEEDED','FAILED','CANCELLED'") && companyRunProcess.includes("THEN 'CANCELLED'") && companyRunProcess.includes("c.fail + c.cancelled"), "company enrichment run reconciliation treats CANCELLED as terminal attention");
assert(jobOps.includes('job.status === "CANCELLED"'), "cancelled jobs can be intentionally retried");
assert(jobActions.includes("'FAILED','RETRY_SCHEDULED','CANCELLED'"), "retry action SQL allows cancelled jobs");
assert(companiesPage.includes('export const dynamic = "force-dynamic"') && companiesPage.includes('withSpan("companies.page"'), "companies page is dynamic and traced");
assert(companyReadModel.includes('withSpan("companies.drawer.detail"') && companyReadModel.includes('traceQuery("companies.drawer.detail.all"'), "company drawer detail query group is traced");
assert(diagnostic.includes("diagnose-v2-job-runtime") && diagnostic.includes("workerHints") && diagnostic.includes("idempotencyKey"), "runtime diagnostic script reports job/run wiring hints");

if (!process.exitCode) {
  console.log("PASS: V2 job execution wiring smoke");
}