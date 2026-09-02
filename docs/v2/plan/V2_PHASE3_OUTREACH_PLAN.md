# V2 — Phase 3: Full Outreach + Activity Spine (Plan)

> Builds AFTER Phase 1 (scoring) and Phase 2 (CRM) ship. Still phase-gated, SEE-IT paired,
> Ship-Definition / Parking-Lot disciplined. Planning map — NOT a Codex prompt.
> Aligns with the V0.8 "12-layer" outreach architecture, reframed into your progression:
> semi-auto email → auto email → call/API → LinkedIn activity.

---

## 0. The native data model (why off-the-shelf CRM format does NOT fit)

Off-the-shelf CRMs (Salesforce/HubSpot/Pipedrive) are built on **Account → Contact → Deal → Activity**,
where a company is ONE record with ONE owner and ONE status. That model **cannot represent your core logic**:
the same company is scored *differently per ICP per client project*. Acme can be QUALIFIED for
Project A / ICP v1 and UNQUALIFIED for Project B / ICP v2 at the same time. A standard CRM forces Acme into
one record and loses this. You are also a **BPO/agency**: you run lead-gen *for many clients at once*, so the
tenancy is `Organization (TeleStar) → ClientAccount → Project → ICPVersion`, not "your single pipeline."

**Recommendation — keep the record = `LeadAssignment`, never the Company.**
Everything outreach/activity hangs off `LeadAssignment` (= Company × Project × ICPVersion), which is already
your center. The "CRM" is a **per-(Project, ICP) lens** over LeadAssignments, not a global company list.
Client-facing output is a **project-scoped deliverable**, never a global company/account export.

Native outreach objects (all `leadAssignmentId`-scoped, all `organizationId`-scoped):

| Object | Anchored to | Purpose |
|--------|-------------|---------|
| `V2MessageTemplate` | org (+ optional project) | reusable template, **versioned** (OCC) |
| `V2SenderAccount` | org (+ user/team) | the "save to account" — provider creds, limits, warmup |
| `V2OutreachTask` | **leadAssignmentId** | the semi-auto queue: one human-approved action |
| `V2EmailSend` | **leadAssignmentId** + contactId | final rendered snapshot of what was sent |
| `V2EmailEvent` | emailSend (`providerEventId` UNIQUE) | webhooks: delivered/open/bounce/reply |
| `V2SuppressionEntry` | org/project/domain/identifier | compliance gate (schema already exists) |
| `V2Sequence*` | leadAssignmentId enrollment | auto multi-step |
| `V2ActivityRecord` | **leadAssignmentId** | unified event spine: email, call, LinkedIn, note |

> This is the format that is "unique to your tool": **LeadAssignment-centric, project-scoped, ICP-versioned,
> with every touchpoint as a child event of the LeadAssignment.** Don't copy contact/deal-centric CRM schemas.

---

## 1. The Activity Spine (moved here from Phase 2)

`V2ActivityRecord` is built HERE, not as a Phase-2 duplicate of V1's standalone daily recap.
Its real job is to be the **single event log** that all outreach + LinkedIn + calls land into, tied to
`LeadAssignment`. V1's `app/activity-recaps/*` keeps running for legacy daily recap until V2 supersedes it.

Guardrail (from the action map): the **identity resolver is reusable** for company upload, activity recap,
AND LinkedIn import. Do NOT build a second resolver. Do NOT break `V2.A0`/`V2.A1` contracts.

---

## 2. Build order (each session SEE-IT paired)

### P3.A — Activity spine + outreach foundation (schema)
- **P3.A0** (plan): confirm `V2ActivityRecord`, `V2MessageTemplate`, `V2SenderAccount`, `V2OutreachTask`,
  `V2EmailSend`, `V2EmailEvent` field shapes against V0.8 layers; decide what is CORE-schema vs deferred.
- **P3.A1** (schema): add the models above, all `leadAssignmentId` + `organizationId` scoped, soft-delete,
  versioned where config; `V2EmailEvent.providerEventId` UNIQUE. **No runtime.**
- **P3.A2** (SEE-IT): read-only "Lead activity timeline" in the lead drawer (empty for now) + read-only
  Templates/Senders list pages. Proves the schema surfaces.

### P3.B — Semi-auto email (human approves every send) = your first target
Maps to V0.8 TASK0 + OUTREACH-INFRA0 + SEND1.
- **P3.B1** Template authoring UI + API: create/edit/version `V2MessageTemplate`, scope to org/project.
  → SEE-IT: template list + editor.
- **P3.B2** Sender account: "save to account" flow — connect Gmail/Workspace via OAuth (preferred) or SMTP;
  store encrypted creds, daily/hourly limits. → SEE-IT: senders page with status.
- **P3.B3** Render + dry-run: render template with lead/company/ICP/contact variables; **suppression check**;
  preview exactly what will send. NO send yet. → SEE-IT: "Preview email" in lead drawer.
- **P3.B4** Outreach task queue: from the **project/ICP-filtered** lead workspace, select qualified leads →
  create `V2OutreachTask` (channel=email). → SEE-IT: `/v2/outreach` task queue.
- **P3.B5** SEND1 (semi-auto): SDR opens a task → reviews rendered draft → **synchronous suppression gate
  immediately before provider call** → send ONE email → write `V2EmailSend` snapshot + `V2ActivityRecord` +
  suggest workflowStatus `contacted`. → SEE-IT: send a real email, see it logged on the timeline.
- **P3.B6** Inbound events: provider webhook → `V2EmailEvent` (idempotent by `providerEventId`):
  delivered/open/bounce/reply → bounce creates suppression, reply suggests `responded` + stop. → SEE-IT:
  events appear on the timeline; bounced address gets suppressed.

> "Semi-auto" = system drafts/renders/queues; **a human approves each send.** This is the safe first slice
> and the correct enterprise default before any automation.

### P3.C — Auto email (sequences)
Maps to SEQ0 + SEQ1.
- **P3.C1** (schema/logic): `V2Sequence`, `V2SequenceVersion`, `V2SequenceStep`, `V2SequenceEnrollment`,
  `V2SequenceStopCondition`. One active enrollment per LeadAssignment per Sequence.
- **P3.C2** Enrollment UI: enroll project/ICP-filtered qualified leads into a sequence. → SEE-IT: enrollments list.
- **P3.C3** (runtime): worker executes steps via JOB0 (`SEQUENCE_STEP_EXECUTE`), **suppression still the final
  gate**, stop conditions (reply/bounce/meeting/manual/disqualified). → SEE-IT: live sequence progress + auto-stop.

### P3.D — Call / API integration
- **P3.D1** Provider abstraction: a thin interface so email providers (Gmail/SMTP) and a future
  call/dialer API share one "channel provider" contract. → SEE-IT: provider settings page.
- **P3.D2** Call logging: SDR logs a call (manual or via dialer API webhook) → `V2ActivityRecord`
  (channel=call) on the LeadAssignment + outcome → workflow suggestion. → SEE-IT: call events on timeline.
- **P3.D3** (optional) Outbound dialer/click-to-call API if a provider is chosen. → SEE-IT: click-to-call button.

### P3.E — LinkedIn activity ingestion (the extension idea)
> The extension is just **another ingestion source** feeding the activity spine — NOT a separate system.
> Flow: extension pulls conversation log → normalize to `CanonicalActivityRow` → **reuse identity resolver** →
> match to LeadAssignment → `V2ActivityRecord` (channel=linkedin). Same pipeline as CSV recap.

- **P3.E1** Ingestion endpoint: accept a LinkedIn activity export (JSON/CSV) the SDR submits
  (daily/weekly/monthly/yearly batch) → ingestion job → resolver → activity records / review items for ambiguous.
  → SEE-IT: upload a LinkedIn export, see messages land on lead timelines.
- **P3.E2** Browser extension (separate codebase): collects the SDR's own LinkedIn conversation log and POSTs
  to the P3.E1 endpoint with auth. → SEE-IT: extension button → data appears in CRM.

> ⚠️ Compliance flag (design around this, don't skip it): LinkedIn's User Agreement restricts automated
> collection/scraping; an extension that pulls chat logs can risk account action and may implicate data-protection
> law (Vietnam PDPD/Decree 13, and GDPR if any EU data). Safer design: the extension exports **the SDR's own
> conversations** with consent, batch + manual-trigger (not silent continuous scraping), and you store only what's
> needed. Get this reviewed before building P3.E2. P3.E1 (accept a manual export) carries far less risk than P3.E2.

---

## 3. Ship checkpoints for Phase 3
- **Ship 3.1** = semi-auto email works end-to-end (P3.B). This alone is a usable outreach product.
- **Ship 3.2** = sequences (P3.C).
- **Ship 3.3** = call/API + LinkedIn (P3.D, P3.E).

Each is independently shippable; do not blur them into one mega-phase.

---

## 4. Parking Lot (explicitly NOT Phase 3)
Open/click tracking pixels, A/B testing, deliverability analytics, multi-mailbox rotation at scale,
public SaaS billing, advanced sequence branching. Park until 3.1–3.3 ship.

---

## 5. One-line summary
Keep the record = `LeadAssignment` (project + ICP scoped); hang every outreach + activity object off it;
build the activity spine first, then semi-auto email, then sequences, then call/API, then LinkedIn —
each SEE-IT paired and independently shippable. The LinkedIn extension is just another feeder into the
same activity spine, but its scraping/compliance risk needs review before you build the auto-collection part.
