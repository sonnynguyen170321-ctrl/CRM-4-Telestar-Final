import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const page = read("app/v2/ingestion/[jobId]/page.tsx");
const progress = read("components/v2/ingestion/ProgressPanel.tsx");
const stepper = read("components/v2/ingestion/PipelineStepper.tsx");
const drawer = read("components/v2/ingestion/IngestionRowDrawer.tsx");
const copyButton = read("components/v2/ingestion/CopyJobIdButton.tsx");

assert.ok(existsSync(resolve(root, "app/v2/ingestion/[jobId]/page.tsx")), "ingestion detail route exists");
assert.match(page, /CommandHeader/, "page must render the premium command header");
assert.match(page, /Smart next action/, "page must expose derived next action guidance");
assert.match(page, /HealthStrip/, "page must render the smart pipeline health strip");
assert.match(page, /PipelineCockpit/, "page must render the pipeline cockpit");
assert.match(page, /QualityDashboard/, "page must render quality dashboard metrics");
assert.match(page, /UploadedRowsWorkbench/, "page must render the uploaded rows workbench");
assert.match(page, /rowStatusFilter/, "page must support rowStatus URL filtering");
assert.match(page, /matchFilter/, "page must support match URL filtering");
assert.match(page, /searchQuery/, "page must support q URL search");
assert.match(page, /pageSize = 25/, "page must paginate the row workbench");
assert.match(page, /CopyJobIdButton/, "command header must expose copy job id control");
assert.doesNotMatch(page, /Outreach[A-Z]/, "ingestion UI must not import domain-named outreach primitives");

assert.match(page, /Each middle step maps to a real V2Job row; no fabricated runtime state/, "pipeline copy must stay truthful");
assert.match(page, /FROM "V2IngestionJob"[\s\S]*WHERE "organizationId" = \$\{organizationId\}/, "ingestion job query must be tenant-scoped");
assert.match(page, /FROM "V2IngestionRow" r[\s\S]*WHERE r\."organizationId" = \$\{organizationId\}[\s\S]*AND r\."jobId" = \$\{jobId\}/, "ingestion row query must be tenant-scoped and job-scoped");
assert.match(page, /FROM "V2Job"[\s\S]*WHERE "organizationId" = \$\{organizationId\}[\s\S]*AND "sourceType" = 'INGESTION_JOB'[\s\S]*AND "sourceId" = \$\{ingestionJobId\}/, "V2Job query must stay tenant-scoped and ingestion-sourced");

assert.match(progress, /Live progress controls/, "progress panel must be presented as live controls");
assert.match(progress, /run-until-idle/, "progress panel must keep run-until-idle control");
assert.match(progress, /process-next/, "progress panel must keep process-next control");
assert.match(progress, /Polling/, "progress panel must keep polling visibility");
assert.match(stepper, /rounded-md border border-slate-200 bg-slate-50 p-3/, "stepper must render as a contained cockpit stepper");
assert.match(drawer, /max-w-2xl/, "row drawer must be roomy enough for premium inspection");
assert.match(copyButton, /navigator\.clipboard\.writeText/, "copy button must copy the real job id");

console.log("PASS V2 ingestion SEE-IT wiring guard");
