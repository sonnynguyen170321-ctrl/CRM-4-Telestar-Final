# V2 Final Polish + AWS Migration Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Finish, upgrade, wire, and polish the V2 product so uploads → company/contact enrichment → ICP scoring → review → outreach → reporting run correctly, faster, and are ready for AWS migration.

**Architecture:** Keep Next.js as the app surface, Prisma/Postgres as durable state, and make BullMQ + Redis the canonical enterprise runtime for all async import/export/enrichment/scoring/outreach work. Add richer company intelligence and ICP schema, then expose the same intelligence through a modern V2 design system across every page.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma 7/Postgres, BullMQ 5, ioredis, Tailwind/shadcn-style UI, Vitest, ESLint, AWS target services: ECS/Fargate or App Runner, RDS Postgres, ElastiCache Redis, S3, SQS/EventBridge optional, CloudWatch.

---

## Current context from repo inspection

- Existing V2 pages include: `home`, `uploads`, `leads`, `companies`, `contacts`, `icp-library`, `outreach`, `reviews`, `ai`, `settings`, `admin`, `jobs`, `reports`, accounts/projects/offers, and nested outreach/campaign pages.
- Existing async pieces already present: `bullmq`, `ioredis`, `lib/v2/bullmq/*`, `scripts/v2-runtime-worker.mjs`, `lib/v2/ingestion/bullIngestionBridge.ts`, `lib/v2/ingestion/handlers.ts`, V2 jobs and runtime health.
- Existing intelligence/scoring pieces already present: `lib/v2/company-intelligence/*`, `lib/v2/scoring/*`, `lib/v2/icp/*`, and Prisma V2 models for companies, contacts, leads, ICP, ingestion, review, jobs, AI, and outreach.
- Existing UI is functional but mixed: some pages use `PageHeader`, `PanelCard`, `WorkspaceFrame`; others still use plain slate cards and one-off layouts.

## Implementation principles

1. **No silent pipeline skips:** every runtime stage must have durable V2Job status, BullMQ pointer job, retry policy, progress, and terminal state.
2. **Faster but correct:** parallelize only between independent jobs; preserve ordered stage barriers inside a single upload.
3. **Evidence-first scoring:** company/contact/LinkedIn filters must store evidence, confidence, and reason codes before affecting score.
4. **Modern but consistent UI:** upgrade shared primitives first, then page surfaces. Avoid one-off redesigns.
5. **AWS-ready from day one:** env-driven config, containerized worker/web separation, Redis/Postgres/S3 health checks, no local-only assumptions.

---

## Phase 0 — Baseline, safety, and acceptance gates

**Objective:** Establish the current product baseline before changing behavior.

**Files likely touched:**
- Create: `.hermes/plans/*` only in this planning step.
- Later create: `docs/v2-final-acceptance.md`, `docs/aws-migration-runbook.md`.

**Steps:**
1. Run baseline checks: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
2. Record current failures separately from new failures in `docs/v2-final-acceptance.md`.
3. Add a checklist of required user flows:
   - upload company CSV/XLSX
   - upload contact CSV/XLSX
   - map columns
   - process ingestion to completion
   - enrich company
   - filter bad/private/404 LinkedIn contacts
   - score against ICP
   - send uncertain items to review
   - approve/reject reviews
   - enroll qualified leads into outreach
   - export/import jobs through BullMQ runtime
4. Do not redesign individual pages until shared UI primitives are upgraded.

**Validation:** baseline commands complete or known failures are documented.

---

## Phase 1 — Enterprise runtime architecture: BullMQ + Redis everywhere

**Objective:** Make BullMQ/Redis the canonical production runtime for import, export, enrichment, scoring, AI, and outreach jobs.

**Files likely changed:**
- `scripts/v2-runtime-worker.mjs`
- `lib/v2/bullmq/queueNames.ts`
- `lib/v2/bullmq/events.ts`
- `lib/v2/bullmq/queues.ts`
- `lib/v2/bullmq/jobOptions.ts`
- `lib/v2/jobs/enqueueJob.ts`
- `lib/v2/jobs/processJob.ts`
- `lib/v2/runtime/queryRuntimeStatus.ts`
- `lib/v2/jobs/queryWorkerHealth.ts`
- `app/v2/runtime/health/route.ts`
- `app/v2/jobs/page.tsx`
- `docker-compose.prod.example.yml`
- Add/update tests under `lib/v2/bullmq/__tests__/` and `lib/v2/jobs/__tests__/`.

**Tasks:**
1. Define all production queue names: ingest parse/normalize/identity/lead-upsert/activity/enrich/score, company research discover/fetch/extract, scoring plan/chunk/reduce, export prepare/write/finalize, outreach send/inbound, AI enrichment/reasoning.
2. Add a single `enqueueRuntimeStage()` helper that creates the durable `V2Job` row and BullMQ pointer atomically/idempotently.
3. Ensure Redis payloads contain IDs only; store large CSV/export blobs in DB/S3-compatible durable storage, not Redis.
4. Add per-queue concurrency env vars with safe defaults and AWS documentation.
5. Add worker heartbeat per queue, not only generic scoring heartbeat.
6. Add BullMQ failed-hook logic that marks the matching V2Job failed after retries are exhausted.
7. Keep local DB-drain backend only as dev fallback; production docs should use BullMQ.

**Validation:**
- `npm run test -- lib/v2/bullmq lib/v2/jobs`
- Start worker with `V2_BULL_ENABLED=true REDIS_URL=... npm run v2:worker -- --backend=bull`.
- Enqueue a noop/import/scoring/export job and verify `/v2/jobs` + `/v2/runtime/health` show queue health and terminal status.

---

## Phase 2 — Uploads + ingestion workflow: step-by-step, faster, correctly wired

**Objective:** Make `/v2/uploads` the guided control center for all imports and ensure runtime stage ordering is explicit.

**Files likely changed:**
- `app/v2/uploads/page.tsx`
- `components/v2/uploads/UploadWorkspace.tsx`
- `components/v2/uploads/FileDropzone.tsx`
- `components/v2/uploads/MappingTable.tsx`
- `app/v2/ingestion/route.ts`
- `app/v2/ingestion/[jobId]/mapping/route.ts`
- `app/v2/ingestion/[jobId]/progress/route.ts`
- `app/v2/ingestion/[jobId]/status/route.ts`
- `app/v2/ingestion/[jobId]/run-until-idle/route.ts`
- `lib/v2/ingestion/createIngestionJob.ts`
- `lib/v2/ingestion/handlers.ts`
- `lib/v2/ingestion/enqueueIngestionJobs.ts`
- `lib/v2/ingestion/queryUploadsDashboard.ts`
- `lib/v2/ingestion/validateIngestionRow.ts`
- `lib/v2/ingestion/upsertLeadAssignments.ts`

**Tasks:**
1. Replace plain upload UI with a guided stepper: Upload → Preview → Map → Validate → Identity match → Enrich → Score → Review → Export/Outreach.
2. Add live stage timeline using `/v2/ingestion/[jobId]/progress` and BullMQ/V2Job status.
3. Add preflight warnings before submit: missing account/project/ICP, duplicate rows, missing company domain, missing email/linkedin, unsupported file type, high invalid-row percentage.
4. Preserve stage barriers:
   - parse must finish before normalize
   - normalize must finish before identity
   - identity must finish before lead upsert
   - company enrichment can fan out after matched companies exist
   - scoring can fan out only after required enrichment or explicit skip policy
5. Speed improvements:
   - batch DB writes
   - process distinct upload jobs concurrently per stage
   - fan out company research/scoring chunks after validation
   - cache duplicate company/contact resolution within a job
6. Add resumability controls: retry failed stage, cancel queued job, continue from last terminal successful stage.
7. Add export from completed job with rejected/private/404/contact-quality columns included.

**Validation:**
- Upload sample company and contact files.
- Verify every stage creates/updates V2Job rows in order.
- Kill/restart worker during a job and confirm resume does not duplicate applied rows.

---

## Phase 3 — LinkedIn/contact access + ICP fit filters for scoring/upload/leads

**Objective:** Filter contacts that cannot be used for outreach or scoring due to inaccessible LinkedIn, private profiles, 404s, generic contacts, missing persona, or ICP mismatch.

**Files likely changed:**
- `prisma/schema.prisma`
- New migration under `prisma/migrations/*`
- `lib/v2/crm/contactEnrichment.ts`
- `lib/v2/identity/resolveIdentity.ts`
- `lib/v2/ingestion/validateIngestionRow.ts`
- `lib/v2/scoring/runtime/buildScoringInput.ts`
- `lib/v2/scoring/runtime/scoreLeadAssignments.ts`
- `lib/v2/scoring/runtime/scoreLeadsAgainstIcp.ts`
- `lib/v2/crm/leadWorkspaceFilters.ts`
- `lib/v2/crm/queryContactLeads.ts`
- `components/v2/leads/LeadFilterSidebar.tsx`
- `components/v2/leads/LeadPriorityQueue.tsx`
- `components/v2/leads/ContactLeadDrawer.tsx`
- `components/v2/uploads/UploadWorkspace.tsx`

**Data model additions:**
- Contact/profile access status: `LINKEDIN_OK`, `LINKEDIN_404`, `LINKEDIN_PRIVATE`, `LINKEDIN_RATE_LIMITED`, `LINKEDIN_UNKNOWN`, `NO_LINKEDIN`.
- Contact quality reason codes: generic email, role email, missing title, title mismatch, seniority mismatch, department mismatch, bounced/suppressed, private/404 LinkedIn.
- ICP contact fit fields: persona tier, matched title tokens, denied title tokens, confidence, evidence.

**Tasks:**
1. Add contact-quality assessment utility with deterministic rules first.
2. Add optional LinkedIn URL accessibility probe interface with provider adapter boundary; do not hard-code scraping into scoring.
3. During upload validation, annotate each contact row with access and quality warnings.
4. During lead scoring, prevent final qualification when contact evidence is blocked and ICP requires persona evidence.
5. Add lead filters: LinkedIn accessible, LinkedIn private/404, persona match, ICP match, missing evidence, outreach eligible.
6. Show reason chips in uploads, leads queue, lead drawer, review queue, and exports.

**Validation:**
- Tests for 404/private/no-linkedin/generic-email/title-mismatch cases.
- Manual upload sample with mixed contacts and confirm filters/export match expected buckets.

---

## Phase 4 — Rich company extraction + deeper ICP library

**Objective:** Extract a richer company profile and use it to score ICP fit with more precision than current SaaS/ecommerce-style categories.

**Files likely changed:**
- `lib/v2/company-intelligence/extractFacts.ts`
- `lib/v2/company-intelligence/reasoning/taxonomy.ts`
- `lib/v2/company-intelligence/reasoning/contract.ts`
- `lib/v2/company-intelligence/reasoning/llmPrompt.ts`
- `lib/v2/company-intelligence/mapIntelligenceProfileToScoring.ts`
- `lib/v2/company-intelligence/presentIntelligence.ts`
- `lib/v2/company-intelligence/companyTabs.ts`
- `lib/v2/company-intelligence/runCompanyResearch.ts`
- `lib/v2/icp/types.ts`
- `lib/v2/icp/authoring.ts`
- `lib/v2/icp/summarizeIcpRules.ts`
- `lib/v2/scoring/rules/schema-v2.ts`
- `lib/v2/scoring/rules/emptyIcpRulesV2.ts`
- `components/v2/icp-library/IcpRulesEditor.tsx`
- `app/v2/icp-library/page.tsx`
- `app/v2/companies/page.tsx`

**New extraction dimensions:**
- Business model: B2B, B2C, marketplace, PLG, sales-led, usage-based, subscription, services, hybrid.
- Offering category: horizontal SaaS, vertical SaaS, ecommerce enablement, fintech/payments, martech/sales-tech, HR/recruiting, cybersecurity, data/analytics, AI automation, devtools/API, logistics, manufacturing/industrial, healthcare, education, real estate, legaltech, agency/consulting/MSP, marketplace, hardware/IoT.
- Buyer/user personas: sales, marketing, RevOps, ecommerce, finance, HR, engineering, security, operations, founders/owners.
- Target customer segment: SMB, mid-market, enterprise, local business, ecommerce brands, regulated industries.
- Maturity/growth: funding, hiring intent, customer logos, case studies, pricing page, integrations, partner ecosystem, multi-location, enterprise/security pages.
- Geography: HQ, office markets, served markets, excluded/unknown policy.
- Risks: offline/parked website, thin website, ambiguous services-vs-product, competitor, irrelevant marketplace, missing evidence.

**ICP library upgrades:**
1. Add ICP sections for target segment, buyer persona, business-model allow/deny, offering category allow/deny, maturity thresholds, growth/proof signals, exclusions, missing-evidence policy, and scoring weights.
2. Add reusable ICP templates: B2B SaaS, ecommerce SaaS, fintech, cybersecurity, logistics, agency/MSP, healthcare, manufacturing, AI automation, devtools.
3. Add rule preview against sample companies before publish.
4. Version every ICP edit and show diff from previous published version.

**Validation:**
- Expand `extractFacts` and taxonomy tests with representative companies.
- Run scoring consistency tests after schema/rule changes.

---

## Phase 5 — Scoring V2 runtime and leads intelligence

**Objective:** Make scoring explainable, faster, and better connected to upload/contact/company evidence.

**Files likely changed:**
- `lib/v2/scoring/runtime/createScoringRun.ts`
- `lib/v2/scoring/runtime/enqueueScoringExecution.ts`
- `lib/v2/scoring/runtime/enqueueScoringJobs.ts`
- `lib/v2/scoring/runtime/fanOutPlanning.ts`
- `lib/v2/scoring/runtime/scoreScoringChunk.ts`
- `lib/v2/scoring/runtime/mapIcpAssessmentToPersistence.ts`
- `lib/v2/scoring/runtime/persistHardRuleAssessment.ts`
- `components/v2/leads/LeadMetricStrip.tsx`
- `components/v2/leads/LeadPriorityQueue.tsx`
- `components/v2/leads/ContactLeadDrawer.tsx`
- `app/v2/leads/score-run/page.tsx`
- `app/v2/leads/rescore-view/page.tsx`

**Tasks:**
1. Rebuild scoring input to include rich company profile + contact quality + LinkedIn access + ICP rules.
2. Add score explanation object: hard gates, positive signals, negative signals, missing evidence, confidence, final reason.
3. Add chunking by company/lead volume, with reduce stage writing run summary.
4. Add lead page smart filters: qualified, needs review, unqualified, missing persona, LinkedIn blocked, company-only evidence, high intent, outreach eligible.
5. Add scoring runtime badges on uploads/leads/companies/reviews.
6. Ensure every score write is idempotent per `scoringRunId + leadAssignmentId + icpVersionId`.

**Validation:**
- `npm run check:scoring-consistency`
- Unit tests for qualification outcomes and missing-evidence policies.
- Manual rescore on a filtered lead view.

---

## Phase 6 — Modern intelligent UI/UX across all V2 pages

**Objective:** Make all pages feel modern, smarter, and consistent without losing current usability.

**Files likely changed:**
- `components/shared/PageHeader.tsx`
- `components/shared/WorkspaceFrame.tsx`
- `components/shared/PanelCard.tsx`
- `components/shared/MetricCard.tsx`
- `components/shared/SideNav.tsx`
- Add shared components: `components/shared/CommandHero.tsx`, `SmartEmptyState.tsx`, `StatusTimeline.tsx`, `InsightCard.tsx`, `ReasonChips.tsx`, `RuntimeStatusPill.tsx`, `PageActionRail.tsx`.
- All V2 page files under `app/v2/**/page.tsx` as needed.

**Tasks:**
1. Introduce design tokens: subtle gradients, glass/card depth, tighter typography, modern status chips, better spacing, responsive command areas.
2. Upgrade shell: nav labels, active route intelligence, global runtime status, quick actions, AI advisory state.
3. Standardize page header pattern: page purpose, primary action, runtime/health badges, contextual next best action.
4. Standardize dashboards: metric cards + insight panels + recent activity + blockers/next steps.
5. Upgrade empty/loading/error states so unfinished pages still guide the user.
6. Add page-level intelligence:
   - uploads: next step and blocker detection
   - leads: best filters and queue insights
   - companies: extraction depth and evidence quality
   - ICP library: scoring readiness
   - outreach: deliverability and campaign readiness
   - AI: budget/provider health
   - settings/admin: migration and account readiness

**Validation:**
- Browser check at all major V2 routes.
- Mobile/tablet/desktop responsive smoke pass.
- No horizontal overflow in primary workspaces.

---

## Phase 7 — Outreach upgrade inspired by Apollo/Instantly/Lemlist patterns

**Objective:** Make `/v2/outreach` workable and intelligent for real campaign operations, while keeping strict safety gates.

**Files likely changed:**
- `app/v2/outreach/page.tsx`
- `app/v2/outreach/campaigns/**`
- `app/v2/outreach/compose/page.tsx`
- `app/v2/outreach/templates/page.tsx`
- `app/v2/outreach/senders/page.tsx`
- `app/v2/outreach/inbox/page.tsx`
- `app/v2/outreach/performance/page.tsx`
- `components/v2/outreach/**`
- `lib/v2/outreach/campaigns/**`
- `lib/v2/outreach/send/**`
- `lib/v2/outreach/reporting/**`
- `lib/v2/outreach/inbox/**`
- `lib/v2/outreach/suppression/**`

**Tasks:**
1. Research Apollo, Instantly, and Lemlist UX patterns during implementation, then translate only into product-owned features.
2. Add campaign readiness score: sender health, domain/credential readiness, suppression risk, lead quality, sequence completeness, daily caps.
3. Add sequence builder improvements: step timeline, conditions, wait days, reply/bounce/unsubscribe stop rules.
4. Add AI-assisted personalization with evidence citations from company/contact intelligence.
5. Add deliverability controls: warmup/status, per-sender caps, bounce/reply thresholds, kill switch, throttling.
6. Add inbox intelligence: reply classification, meeting intent, unsubscribe, bounce, not interested, needs human review.
7. Add campaign analytics: sent/delivered/open/click/reply/bounce/meeting/suppression by campaign, sender, ICP, segment.
8. Ensure AWS migration readiness: all sends run through worker queue; web request should not perform long-running campaign sends.

**Validation:**
- Dry-run campaign preview.
- Live-send remains blocked unless all gates pass.
- Suppression gate is checked synchronously immediately before provider call.

---

## Phase 8 — AI engine completion

**Objective:** Finish `/v2/ai` as a real admin console for advisory enrichment/reasoning.

**Files likely changed:**
- `app/v2/ai/page.tsx`
- `components/v2/ai/AiConsole.tsx`
- `lib/v2/ai/queryAiConsole.ts`
- `lib/v2/ai/runAiCompletion.ts`
- `lib/v2/ai/settings.ts`
- `lib/v2/ai/aiGate.ts`
- `lib/v2/ai/rateLimiter.ts`
- `lib/v2/ai/usage.ts`
- `lib/v2/company-intelligence/reasoning/hybridEngine.ts`
- `lib/v2/company-intelligence/reasoning/llmEngine.ts`
- `lib/v2/company-intelligence/reasoning/llmPrompt.ts`

**Tasks:**
1. Add provider/model health, daily budget, per-provider limits, and last error visibility.
2. Add prompt/run logs with redacted inputs and evidence citations.
3. Add AI test action for configured provider without exposing keys.
4. Add AI queue integration so company extraction/scoring/outreach personalization can request advisory AI asynchronously.
5. Add kill switch and budget exhaustion behavior.

**Validation:**
- AI disabled: all deterministic workflows still run.
- AI enabled: one test completion logs usage and respects budget.

---

## Phase 9 — Settings, admin, accounts, reviews completion

**Objective:** Finish shallow pages and add account/user management needed before AWS migration.

**Files likely changed:**
- `app/v2/settings/page.tsx`
- `app/v2/admin/page.tsx`
- `app/v2/reviews/page.tsx`
- `components/v2/reviews/ReviewQueueWorkspace.tsx`
- `lib/v2/settings/queryProviderReadiness.ts`
- `lib/v2/auth/**`
- `lib/v2/tenant/**`
- `lib/v2/manager-review/**`
- New server actions/routes for safe user invite/create/update/disable.

**Settings tasks:**
1. Expand from read-only readiness into sections: Organization, Users, Roles, Providers, Runtime, AI, Outreach, Import/Export, AWS readiness.
2. Add create/invite user flow with role assignment.
3. Add disable/reactivate user and reset invite/password flows if existing auth supports it.
4. Keep secrets write path explicit and safe; show configured booleans only.

**Reviews tasks:**
1. Add review filters: reason code, priority, source, confidence, assignee, due/snoozed, ICP, upload job.
2. Add bulk actions: approve, dismiss, snooze, assign.
3. Add side-by-side evidence view: company profile, contact quality, LinkedIn access, score explanation, raw upload row.
4. Write review resolution back to lead/company/contact/scoring state with audit events.

**Validation:**
- Permission tests for role-gated admin/settings actions.
- Manual review resolution changes the underlying lead state and audit log.

---

## Phase 10 — AWS migration readiness

**Objective:** Make the product deployable as web + worker services with managed Postgres/Redis/object storage.

**Files likely changed:**
- `Dockerfile` if present or create one.
- `docker-compose.prod.example.yml`
- `.env.example` / production env docs if present.
- `next.config.ts`
- `prisma/schema.prisma`
- `docs/aws-migration-runbook.md`
- `scripts/v2-runtime-worker.mjs`
- `app/api/health/route.ts`
- `app/v2/runtime/health/route.ts`

**Tasks:**
1. Define services:
   - web: Next.js app
   - worker: `npm run v2:worker -- --backend=bull`
   - optional imap poller: `npm run v2:imap`
2. Map AWS services:
   - RDS Postgres for Prisma
   - ElastiCache Redis for BullMQ
   - S3 for import/export files and large artifacts
   - Secrets Manager/SSM for API keys and outreach credential key
   - CloudWatch logs/metrics/alarms
3. Add health checks for web, DB, Redis, worker heartbeat, queue lag.
4. Add migration commands: `npm run prisma:generate`, `npm run prisma:migrate:deploy`, `npm run build`, worker boot.
5. Add environment matrix and required secrets.
6. Add runbook for rollback and failed migration recovery.

**Validation:**
- Production build succeeds.
- Worker starts with BullMQ env.
- Health endpoints pass without local-only dependencies.

---

## Phase 11 — Wiring audit and final QA

**Objective:** Ensure every page/action/runtime path is connected and correct.

**Tasks:**
1. Route audit: every SideNav item resolves and uses tenant permissions.
2. API audit: every mutation has auth, tenant scope, validation, audit event when needed.
3. Runtime audit: every job has queue name, durable V2Job, retry policy, progress, terminal state, and UI visibility.
4. Data audit: upload → company/contact → intelligence → scoring → lead → review → outreach → report linkages exist.
5. Export/import audit: exports come from durable job output and include filtering reason columns.
6. Performance pass: avoid N+1 queries in lead/company/review workspaces; batch or precompute where needed.
7. Security pass: no secrets in UI/logs; server-only provider calls; tenant isolation in SQL.

**Final validation commands:**
```bash
npm run typecheck
npm run lint
npm run test
npm run check:scoring-consistency
npm run build
```

**Manual end-to-end validation:**
1. Create or select org/account/project/ICP.
2. Upload company + contact list.
3. Map columns and start BullMQ processing.
4. Watch `/v2/uploads`, `/v2/jobs`, and `/v2/runtime/health` update.
5. Confirm company profiles are rich and evidence-backed.
6. Confirm LinkedIn private/404/no-access contacts are filtered and reason-coded.
7. Run scoring and verify lead queue filters.
8. Resolve review items.
9. Create outreach campaign from qualified leads.
10. Dry-run campaign and confirm send gates.
11. Export results.
12. Run AWS readiness checklist.

---

## Suggested implementation order

1. Baseline tests and acceptance doc.
2. BullMQ/runtime architecture.
3. Upload workflow stepper + job visibility.
4. Contact/LinkedIn quality model.
5. Company intelligence + ICP schema depth.
6. Scoring runtime and lead filters.
7. Shared UI primitives and shell modernization.
8. Page-by-page polish: uploads, leads, companies, ICP, reviews, outreach, AI, settings/admin, reports/jobs.
9. Outreach intelligence/workability.
10. AWS migration runbook and deployment checks.
11. Full wiring audit and E2E QA.

## Open questions before implementation

1. Which LinkedIn access signal should be used in production: uploaded status, a third-party enrichment provider, manual review, or a controlled HTTP probe only for URLs that permit it?
2. Should AWS target be ECS/Fargate, App Runner, or another platform?
3. Should user creation in Settings be invite-only or direct password creation by admins?
4. Should AI be allowed to generate outreach copy automatically, or only suggest copy requiring human approval?
5. What file size/row count should be supported for production uploads before S3 multipart storage becomes mandatory?

## First implementation slice after approval

Start with **Phase 0 + Phase 1 + Phase 2**, because all later intelligence and UI features depend on reliable runtime wiring and upload visibility.

Expected first PR scope:
- Runtime queue map + enqueue helper.
- Worker health per queue.
- Upload stepper/timeline wired to V2Job/BullMQ progress.
- Tests for queue mapping and ingestion stage ordering.
- Baseline AWS runtime env docs.
