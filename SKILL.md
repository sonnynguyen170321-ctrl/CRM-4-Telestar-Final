---
name: telestar-sdr-crm
description: >
  Build and iterate on the Telestar SDR CRM — an enterprise Next.js fullstack
  platform with PostgreSQL (Cloud SQL / Docker) and BullMQ background workers
  for BPO SDR teams. Covers multi-tenant lead pipeline management, Account & Contact
  graphs, multi-channel sequence engine (Email, Phone, LinkedIn, WhatsApp), delayed
  task execution, Meeting Booking waterfall engine, Titan IMAP/SMTP & OAuth email sync,
  daily task management, per-lead notes and reminders, opportunity lifecycle, and
  multi-role dashboards (Director, Floor Manager, Team Lead, SDR, Leadgen Manager).
  Trigger on: CRM, lead tracker, pipeline view, sequence builder, task dashboard,
  SDR workspace, template editor, lead stages, outreach sequence, contact management,
  kanban board, daily tasks, overdue tasks, team dashboard, SDR platform, meeting booking,
  opportunity handoff, email worker, BullMQ, import worker, or any request to build,
  modify, or extend the Telestar CRM application — even if the user just says "update the CRM"
  or "add a feature to the platform." Also trigger when the user asks to build any SDR tooling,
  sales development workspace, or BPO lead management interface for Telestar.
---

# Telestar SDR CRM — Platform Skill

Build, extend, and maintain the production-grade SDR workspace for **Telestar**, a BPO company
running SDR-as-a-Service. This is the team's daily operating system — every pixel, background job,
and database query matters because SDRs and managers live in this tool 8 hours a day.

**Production URL:** `https://crm.telestar.cloud`  
**Tech Stack:** Next.js 16 (App Router + Fullstack API routes) · PostgreSQL 16 (Cloud SQL / Postgres Container) · Prisma ORM · BullMQ + Redis 7 · Node.js runtime · React 19 · Vanilla CSS & TailwindCSS · Caddy TLS reverse proxy.

---

## 1. Product Context & Organization

### Who Uses It
A BPO SDR organization at Telestar structured as a multi-tier hierarchy:

```
Director (1)
 └── Floor Managers (2)
      └── Team Leads (7)
           ├── SDRs (12)
           └── Leadgen Managers / Operators
```

Plus 1 BD Manager (Son) who operates at the Director level, leading client relationships, coaching reps, managing campaigns, and reporting on commercial outcomes.

### 5 RBAC Roles & Permissions Matrix

| Capability | Director | Floor Manager | Team Lead | SDR | Leadgen |
|---|---|---|---|---|---|
| **View Own Leads / Tasks** | ✅ All | ✅ Floor | ✅ Pod | ✅ Own | ✅ Own |
| **View Team Leads / Tasks** | ✅ All | ✅ Floor | ✅ Pod | ❌ | ❌ |
| **Create / Edit Leads** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Reassign Leads Between SDRs** | ✅ | ✅ Floor | ✅ Pod | ❌ | ❌ |
| **Create / Edit Sequences** | ✅ | ✅ | ✅ | ✅ (Own) | ❌ |
| **Manage Message Templates** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Execute Daily Tasks (Calls/Emails/Social)** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Lead Pool / Ingestion / Ingestion Batches** | ✅ | ✅ | ✅ | ❌ | ✅ |
| **Meeting Booking & Outcome Logging** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Opportunity Handoff & Pipeline** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Team View & Executive Leaderboards** | ✅ Full Org | ✅ Floor Pods | ✅ Assigned Pod | ❌ Personal Stats Only | ❌ Pool Stats Only |
| **Client / Campaign Management** | ✅ | ✅ Floor | 👁 View Only | ❌ | ❌ |
| **User & Access Management** | ✅ All | ✅ Floor Staff | ❌ | ❌ | ❌ |
| **Client Report Generation & Export** | ✅ | ✅ | ✅ Pod | ❌ | ❌ |
| **Global Settings & System Maintenance** | ✅ | ⚠️ Scoped | ❌ | ❌ | ❌ |

---

## 2. Multi-Tenant Architecture & Data Isolation

Every business entity in the database belongs to a `Tenant`. Multi-tenancy is enforced at the database and application runtime layers:

1. **Schema Layer:** All models carry a required `tenantId` foreign key referencing `Tenant(id)`.
2. **Runtime Context:** `AsyncLocalStorage` (`tenantStorage` in `lib/tenant-inject.ts`) holds the active `tenantId` per request or worker execution.
3. **Middleware Injection:** The Prisma client extension in `lib/tenant-inject.ts` automatically injects `tenantId` into every `create`, `createMany`, `update`, `upsert`, and `find` query.
4. **Worker Context:** Worker jobs wrap execution inside `tenantStorage.run(job.data.tenantId, ...)` ensuring background processors execute with strict tenant isolation.
5. **Session Invalidation:** User model contains `authVersion`. Any administrative change, password reset, or tenant transfer increments `authVersion`, instantly invalidating existing stateless JWTs.

---

## 3. Data Model: Accounts, Contacts, Leads & Deals

The system cleanly separates companies (`Account`), individual humans (`Contact`), active outreach pipelines (`Lead`), and commercial pipeline (`Opportunity`).

```
┌─────────────────────────────────────────────────────────────┐
│                           Tenant                            │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
        ┌──────▼──────┐                ┌──────▼──────┐
        │   Client    │                │    User     │
        └──────┬──────┘                └──────┬──────┘
               │                              │
        ┌──────▼──────┐                       │
        │  Campaign   │                       │
        └──────┬──────┘                       │
               │                              │
┌──────────────▼──────────────────────────────▼───────────────┐
│                           Account                           │
│ (name, domain, industry, size, website, linkedIn, tier)     │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                           Contact                           │
│ (firstName, lastName, normalizedEmail, phone, title, etc.)   │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                            Lead                             │
│ (stage, crmPriorityScore, engagementScore, assignedTo,      │
│  sequenceId, sequenceStep, lastContactedAt, nextTaskDue)    │
└──────────────────────────────┬──────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               │                               │
        ┌──────▼──────┐                 ┌──────▼──────┐
        │   Meeting   │                 │ Opportunity │
        │  (Booking)  │                 │  (Pipeline) │
        └─────────────┘                 └─────────────┘
```

### Lead Pipeline Stages

```
New → Sequence Active → Replied → Meeting Booked → Won / Lost
```

1. **`new`** — Ingested prospect awaiting initial sequence enrollment or manual outreach.
2. **`sequence_active`** — Actively enrolled in an automated or multi-channel sequence.
3. **`replied`** — Prospect responded to outreach. Sequences are automatically paused; a review task is created for the SDR.
4. **`meeting_booked`** — Prospect scheduled a meeting via booking link or direct SDR scheduling.
5. **`won`** — Commercial opportunity successfully qualified, handed off to client, and closed won.
6. **`lost`** — Disqualified, uninterested, invalid contact info, or timing mismatch.

### Deduplication Indexes
- **Contact Deduplication:** `@@unique([tenantId, normalizedEmail])`
- **Lead Deduplication:** Partial index on `(tenantId, campaignId, normalizedEmail)` where `normalizedEmail IS NOT NULL`.
- **Suppression Uniqueness:** Partial unique indexes on `(tenantId, email, COALESCE("campaignId", ''))`.

---

## 4. Asynchronous Queue & Background Worker Architecture

All long-running tasks, automated outbound emails, inbox synchronizations, batch imports, and maintenance jobs run on **BullMQ + Redis 7** (`workers/index.ts`).

```
                            ┌────────────────┐
                            │  Next.js API   │
                            └───────┬────────┘
                                    │ Enqueue Job
                                    ▼
                          ┌────────────────────┐
                          │   Redis 7 Queue    │
                          └─────────┬──────────┘
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    │                               │                               │
    ▼                               ▼                               ▼
┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
│    Sequence Worker     │  │      Email Worker      │  │      Sync Worker       │
│  - sequence.enroll     │  │  - email.send          │  │  - email.sync (IMAP)   │
│  - sequence.advance    │  │  - atomic daily quota  │  │  - email.apply-reply   │
│  - sequence.execute    │  │  - suppression check   │  │  - email.apply-bounce  │
│  - sequence.pause      │  │  - token decryption    │  │  - reply sentiment    │
│  - sequence.unenroll   │  │  - OutboundMessage FSM │  │  - suppression write   │
└────────────────────────┘  └────────────────────────┘  └────────────────────────┘
    │                               │                               │
    ▼                               ▼                               ▼
┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
│     Import Worker      │  │  Notification Worker   │  │   Maintenance Worker   │
│  - import.parse        │  │  - reminder.due        │  │  - orphan-tasks        │
│  - import.chunk        │  │  - digest.daily        │  │  - stale-sending       │
│  - import.commit       │  │  - manager alerts      │  │  - stuck-running       │
│  - normalization       │  │                        │  │  - missing-delayed     │
│  - 2-phase 202 async   │  │                        │  │  - reassignment-drift  │
└────────────────────────┘  └────────────────────────┘  └────────────────────────┘
```

### Worker Registry (`workers/index.ts`)
- **`sequenceWorker`** (`SEQUENCE` queue): Handles multi-channel cadences and delayed BullMQ execution (`sequence.execute-task`).
- **`emailWorker`** (`EMAIL` queue): Governs outbound email delivery, quota consumption, suppression enforcement, and provider dispatch.
- **`syncWorker`** (`SYNC` queue): Periodically connects to Titan/Gmail/Outlook mailboxes, polls recent emails, classifies replies, and detects bounces.
- **`importWorker`** (`IMPORT` queue): Two-phase CSV/XLSX parsing, field mapping, entity creation, and batch deduplication.
- **`notificationWorker`** (`NOTIFICATION` queue): Evaluates due reminders, overdue task alerts, and daily SDR/Manager summaries.
- **`maintenanceWorker`** (`MAINTENANCE` queue): 5 automated self-healing repair routines to reconcile state drift.
- **`healthcheck`**: Periodically pings Redis and computes queue depths and latency metrics.

---

## 5. Sequence Engine & Multi-Channel Workflows

Sequences automate touchpoints across Email, Phone, LinkedIn, and WhatsApp.

### Step Delay & Execution Model
1. **Enrollment (`workers/sequence.ts:handleEnroll`):**
   - Creates `SequenceEnrollment` with `status: 'active'`.
   - Moves Lead stage to `sequence_active`.
   - Calculates Step 1 `dueDate` (`now() + step.delayDays + step.delayHours`).
   - Creates pending `Task` for Step 1.
   - If Step 1 is automated Email, schedules a delayed BullMQ job (`JobType.SEQUENCE_EXECUTE_TASK`) with `delay = dueDate - now()`.

2. **Delayed Task Execution (`handleExecuteTask`):**
   - Triggered when delay expires.
   - If channel is `email` with `autoComplete: true`, dispatches email via `emailWorker` and advances sequence automatically.
   - If channel is manual (`phone`, `linkedin`, `whatsapp`), leaves task in `pending` state for SDR to complete.

3. **Step Advancement (`handleAdvance`):**
   - Marks current task `completed`.
   - Checks if further steps exist:
     - If yes: computes next `dueDate`, creates next `Task`, and schedules next delayed job.
     - If no: marks enrollment `completed`, creates activity record, and notifies SDR.

4. **Instant Fast-Forward ("Run Now" Workflow):**
   - API: `POST /api/tasks/[id]/run-now`
   - Immediately sets task `dueDate` to `new Date()` and dispatches `JobType.SEQUENCE_EXECUTE_TASK` with `delay: 0`.
   - Idempotent and cancels prior delayed jobs, allowing SDRs and managers to accelerate sequences instantly.

5. **Auto-Pause & Unenroll Triggers:**
   - **Inbound Reply:** Automatically pauses active sequence, sets lead stage to `replied`, and creates high-priority "Handle Reply" task.
   - **Hard Bounce:** Unenrolls sequence, records bounce activity, marks email invalid, and adds lead email to `SuppressionEntry`.
   - **Meeting Booked:** Auto-pauses outreach sequence.
   - **Stage → Won/Lost:** Auto-completes/archives sequence.

---

## 6. Email Integration, Security & Outbound Safeguards

### Supported Mail Adapters
- **Titan Mail (Hostinger):** Native IMAP (`imap.titan.email:993`, SSL) / SMTP (`smtp.titan.email:465`, SSL).
- **Google Workspace / Gmail:** OAuth 2.0 with offline access, automatic refresh token exchange, and Gmail API message tracking.
- **Microsoft 365 / Outlook:** Microsoft Graph API via OAuth 2.0.

### Token Encryption at Rest (`lib/crypto.ts`)
- OAuth access tokens and refresh tokens are encrypted using **AES-256-GCM** before writing to `EmailAccount.encAccessToken` and `EmailAccount.encRefreshToken`.
- Secrets are decrypted on-the-fly inside `EmailService.fromAccount()`. Plaintext tokens are never logged.

### Outbound Lifecycle State Machine
```
[Client / API] ──► Create OutboundMessage (status: 'pending')
                         │
                         ▼ Enqueue Job (email.send)
                  [Suppression Check] ──► (Suppressed? ──► Mark 'failed', abort)
                         │
                         ▼ (Pass)
                  [Atomic Quota Check] ──► (Quota Exceeded? ──► Reschedule next day)
                         │
                         ▼ (Pass)
                  Update Status → 'sending'
                         │
                         ▼
                  [Provider Dispatch (Titan/Gmail/Outlook)]
                         │
        ┌────────────────┴────────────────┐
        ▼ (Success)                       ▼ (Error)
Update Status → 'sent'           Update Status → 'failed'
Log Activity ('email_sent')      Log Error & Retry if transient
Advance Sequence (if applicable)
```

---

## 7. Meeting Booking & Waterfall Link Resolver

Native scheduling subsystem integrated with calendar providers.

### Workflow & Data Flow
1. **`BookingLink` Configuration:**
   - SDRs and Managers configure personal booking URLs (Cal.com, Calendly, Google Calendar, HubSpot, etc.).
   - Default campaign booking links can be set at the Campaign level.
2. **Waterfall Link Resolver (`lib/meetings/resolver.ts`):**
   - Priority 1: Assigned SDR's active `BookingLink`.
   - Priority 2: Team Lead's active `BookingLink`.
   - Priority 3: Campaign fallback `BookingLink`.
3. **Meeting Lifecycle Engine (`Meeting` Model):**
   - Statuses: `link_sent` → `scheduled` → `completed` | `no_show` | `cancelled` | `rescheduled`.
   - Outcomes (`MeetingOutcome`): `qualified_opportunity`, `completed_not_qualified`, `no_show`, `cancelled`, `rescheduled`, `no_decision`.
4. **Automated Conversion:**
   - Logging `qualified_opportunity` prompts the SDR to convert the Lead to an `Opportunity` and sets lead stage to `won`.

---

## 8. Opportunity Lifecycle & Commercial Handoff

Designed for Telestar's BPO business model where qualified leads are handed off to client sales teams.

### Opportunity Stages
```
pending_client_review → accepted_by_client → discovery → proposal → negotiation → won / lost / nurture
```

- **Handoff Submission:** SDR logs qualifying meeting details, budget, authority, need, and timeline (BANT).
- **Client Feedback Loop:** Client accepts or rejects opportunity. If rejected, a `LostReason` is logged (e.g., `wrong_icp`, `no_budget`, `competitor`).
- **Revenue Tracking:** Tracks deal value, currency, estimated close date, and commissioning credit for SDR / Team Lead.

---

## 9. SDR Daily Heartbeat & Task Management

Tasks represent the SDR's operational queue.

### Three Primary Task Views
1. **Today:** Tasks due today, sorted by priority (`crmPriorityScore` = hot → warm → cold) and scheduled time.
2. **Yesterday:** Tasks due yesterday, separating completed actions from missed touchpoints.
3. **Overdue:** Incomplete tasks with `dueDate < today`, ordered oldest first.

### Atomic Compare-and-Swap (CAS) Completion
Task updates use CAS operations in SQL (`WHERE id = :id AND status = 'pending'`) to prevent duplicate executions and race conditions when multiple tabs or automated workers touch the same task.

---

## 10. Multi-Channel Activity Logging

Every touchpoint is permanently recorded in the `Activity` log.

### Call Logging Modal (Phone Tasks)
Phone tasks require explicit outcome selection before completing:

| Outcome Value | Display Label | Behavior |
|---|---|---|
| `connected_interested` | Connected — Interested | Updates `lastContactedAt`, prompts stage update |
| `connected_meeting_booked` | Connected — Meeting Booked | Advances lead stage to `meeting_booked` |
| `connected_not_interested` | Connected — Not Interested | Logs notes, marks lead cold |
| `callback_requested` | Call Back Requested | Auto-creates follow-up task for next business day |
| `voicemail_left` | Voicemail Left | Logs touchpoint, advances sequence step |
| `voicemail_not_left` | Voicemail — No Message | Logs touchpoint, advances sequence step |
| `no_answer` | No Answer | Logs touchpoint, advances sequence step |
| `wrong_number` | Wrong Number | Flags phone number as invalid |
| `do_not_call` | Do Not Call (DNC) | Suppresses contact from future voice outreach |

### Social Logging Modals (LinkedIn & WhatsApp)
- **LinkedIn Modal:** Captures action type (`Connection Request Sent`, `InMail Sent`, `Follow-up Message Sent`, `Profile Engaged`) and prospect response status.
- **WhatsApp Modal:** Captures action type (`First Message Sent`, `Follow-up Message Sent`, `Voice Note Sent`) and prospect reply.

---

## 11. Two-Phase Asynchronous Lead Ingestion

Large file uploads (CSV / XLSX) are processed asynchronously via `workers/import.ts`.

```
[User Uploads CSV] ──► POST /api/leads/import
                             │
                             ▼
                   Create ImportBatch (status: 'processing')
                   Return HTTP 202 Accepted { batchId }
                             │
                             ▼ Enqueue import.parse Job
                   [importWorker: handleImportParse]
                   - Validate headers & column mapping
                   - Normalize emails, phones, LinkedIn URLs
                   - Deduplicate against Contact/Lead tables
                   - Chunk valid rows (100 rows / chunk)
                             │
                             ▼ Enqueue import.chunk Jobs
                   [importWorker: handleImportChunk]
                   - Create / Find Accounts
                   - Create / Find Contacts
                   - Insert Leads with crmPriorityScore
                   - Optional: Enroll in default Sequence
                             │
                             ▼ Enqueue import.commit Job
                   [importWorker: handleImportCommit]
                   - Aggregate created/updated/skipped/error counts
                   - Mark ImportBatch status: 'completed'
                   - Notify user in UI
```

---

## 12. Self-Healing Maintenance Engine

The `maintenanceWorker` (`workers/maintenance.ts`) runs periodic audits:
1. **`orphan-tasks`:** Reassigns or cleans tasks referencing deleted or archived leads/users.
2. **`stale-sending`:** Reclaims OutboundMessages stuck in `sending` status (> 15 minutes) and resets them for redelivery.
3. **`stuck-running`:** Re-enqueues sequence steps interrupted by server or worker restarts.
4. **`missing-delayed`:** Scans active sequence enrollments to verify that corresponding delayed BullMQ jobs exist in Redis.
5. **`reassignment-drift`:** Ensures pending tasks and sequence ownership transfer immediately when a lead is reassigned to a new SDR.

---

## 13. UI Architecture & Navigation Structure

### Layout & Theme
- **Theme:** Industrial Utilitarian Dark Mode (`#0A0A0A` background, `#1A1A1A` cards, `#262626` borders).
- **Brand Accents:** Telestar Fire Red (`#D42B1E`), Flame Orange (`#E8611A`), Amber (`#F5A623`).
- **Information Density:** Compact padding (8-16px), 36px table row height, system monospace fonts for identifiers and metrics.

### Primary Views & Routes
- `/dashboard` — Task management hub, daily stats, overdue alerts, and quick actions.
- `/leads` — Dual-mode pipeline: Kanban board (drag-and-drop stages) + sortable data table.
- `/sequences` — Visual multi-channel sequence builder, step reordering, and cadence metrics.
- `/meetings` — Scheduled meetings dashboard, outcome logging, and calendar integration.
- `/opportunities` — Commercial pipeline, handoff tracker, and BPO deal metrics.
- `/templates` — Message template library with merge field insertion (`{{firstName}}`, `{{company}}`, etc.).
- `/team` — Director / Manager command center: SDR activity leaderboards, pipeline funnel, and pod filtering.
- `/reports` — Client report builder and PDF/CSV export engine.
- `/settings` — Personal profile, mailboxes (Titan/Gmail/Outlook), VoIP integrations, and Admin staff management.

### Slide-Over Lead Detail Panel
Clicking any lead in any view opens a persistent right-side slide-over panel containing:
1. Header: Name, Title, Company, Stage badge, Priority score, Engagement score.
2. Contact details: Click-to-email, Click-to-call, LinkedIn link, WhatsApp launcher.
3. Active sequence progress bar with "RUN NOW" manual override button.
4. Tabbed view: Activity Timeline, Tasks (Completed & Pending), Notes Feed, Reminders, Opportunity Info.

---

## 14. Key API Endpoints Reference

### Leads & Pipeline
- `GET /api/leads` — List leads with filtering, sorting, pagination, and pod scoping.
- `POST /api/leads` — Create a new lead (creates/links Account & Contact).
- `GET /api/leads/[id]` — Retrieve full lead profile with relations.
- `PATCH /api/leads/[id]` — Update lead attributes, stage, or priority.
- `POST /api/leads/import` — Upload CSV/XLSX for async 2-phase ingestion (returns `202 Accepted`).

### Tasks & Actions
- `GET /api/tasks` — List tasks scoped by date range (`today`, `yesterday`, `overdue`) and assignee.
- `PATCH /api/tasks/[id]` — Update task status (CAS completion).
- `POST /api/tasks/[id]/run-now` — Fast-forward delayed sequence step immediately.

### Sequences
- `GET /api/sequences` — List all defined sequences and enrollment statistics.
- `POST /api/sequences` — Create new multi-channel sequence.
- `POST /api/sequences/[id]/enroll` — Enroll lead(s) into sequence.
- `POST /api/sequences/[id]/pause` — Pause active sequence for a lead.

### Email & Sync
- `POST /api/email/send` — Enqueue outbound email via `emailWorker`.
- `POST /api/email/accounts` — Connect mailbox (Titan IMAP/SMTP or OAuth).
- `POST /api/email/accounts/[id]/test` — Test mailbox connection credentials.
- `POST /api/cron/inbox-sync` — Trigger mailbox sync job.

### Meetings & Opportunities
- `GET /api/meetings` — List scheduled meetings and outcomes.
- `POST /api/meetings` — Schedule meeting or generate booking link.
- `POST /api/meetings/[id]/outcome` — Log meeting outcome and trigger pipeline updates.
- `GET /api/opportunities` — List commercial opportunities.
- `POST /api/opportunities` — Create/handoff new opportunity.

---

## 15. Mandatory Verification & Quality Gates

Escalate up the ladder in `.agent/registry/tests.yaml`; do not run the release rung after a
one-line edit. These are the release-rung gates:

1. **TypeScript:** `node node_modules/typescript/bin/tsc --noEmit`, **0 errors**. Needs
   `NODE_OPTIONS=--max-old-space-size=8192`, and cannot be run through `npx` on a checkout
   whose path contains `&`. `npm run agent -- doctor` explains why.
2. **Lint:** `node node_modules/eslint/bin/eslint.js .`, **0 errors**.
3. **Unit and integration:** `node node_modules/vitest/vitest.mjs run`. Suites needing Redis or
   live AI providers are BLOCKED_EXTERNAL without them — a skip there is never a pass.
4. **Production build:** `node scripts/build.cjs`.
5. **E2E:** `node node_modules/@playwright/test/cli.js test`, from `e2e/`, across all **six**
   roles — `director`, `floor_manager`, `team_lead`, `sdr`, `leadgen_manager`, `leadgen`.
   The role list is generated into `.agent/generated/role-map.json`; any list naming four or
   five roles is stale.
6. **Static gates:** test discipline, migration order, stale models, production compose,
   relational integrity, RLS. Commands in `.agent/registry/tests.yaml`.
