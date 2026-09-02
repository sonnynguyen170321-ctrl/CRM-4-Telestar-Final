# TeleStar SDR OS V2 — Master Implementation Plan (Workflow-First, Outcome-Driven)

Status: Draft for human review
Date: 2026-06-16
Change kind: docs and execution planning only
Runtime changed: no
Schema changed: no
V1 touched: no

## 0. The Outcome This Plan Must Produce

One connected operating system, not a set of pages:

```txt
LOAD DATA  ->  QUALIFY COMPANY  ->  FULL OUTREACH  ->  FULL TRACKING
```

Concretely, an operator can:

1. Load a company list (CSV) under a chosen Account / Project / ICP.
2. Watch it become identity-resolved leads, enriched, and **scored by that ICP**.
3. Work those leads in a CRM (review, correct, feed back, export).
4. Run **real outreach** (manual + automated sequences) safely through a suppression gate.
5. See **everything that happened** to a lead on one timeline, and report on it.

Every session in this plan must move the system measurably closer to that loop **and keep the
workflow stages logically linked** — each stage consumes the prior stage's real output and produces a
real object the next stage consumes. A session that cannot name its upstream object and its downstream
consumer is not ready to code.

## 1. Source Of Truth (and how this plan relates to existing docs)

Authority for **architecture and invariants** (unchanged, this plan never overrides them):

```txt
1. AGENTS.md V2 INVARIANTS (1-16)
2. docs/V2_FINAL_EXECUTION_PLAN_V8_ENTERPRISE.md  (architecture baseline)
3. docs/v2/plan/V2_WORKFLOW_LINKAGE_CONTRACTS.md  (per-stage linkage contract)
4. docs/v2/plan/V2_PRODUCTION_SESSION_CHECKLIST.md
5. docs/v2/plan/design/V2_UI_MOCKUP_AGENT_PACK.md + docs/v2/plan/design/mockups/**  (UI IMPLEMENTATION CONTRACT)
```

**UI implementation contract.** The design pack (#5) is the source of truth for every V2 UI surface.
The mockups are the **contract, not inspiration**: layout rhythm (left sidebar + topbar + dense cards +
compact tables + filter panels + right drawers), enterprise density, light mode, the canonical component
kit, and the per-page route/drawer structure are binding. A UI surface that drifts into a generic dashboard,
drops the operational tables/drawers, or invents new product states is **incomplete**. UI sessions follow
§4e (component-kit registry + UI↔workflow linkage) and §6b (UI session protocol). The pack's own rule holds:
**a UI session produces a plan only, then STOPS for approval before coding.**

Relationship to `docs/v2/plan/V2_SCORING_CRM_ACTION_MAP_V1_1_1.md`:

- That action map planned **Phase 1 (scoring) + Phase 2 (CRM)**. Those phases are now **largely built**
  in the repo (verified in §2). Its session list is therefore mostly completed history.
- This plan does **not** supersede the invariants or contracts. It is the **executable sequencing layer**
  that continues from *current verified repo reality* toward the full OS outcome.
- **Conflict rule:** where any doc (including the action map or this plan's own snapshot) disagrees with
  the actual repo about what is already built, **the repo wins**. Every session re-verifies before coding.

Interpretation rules carried forward unchanged:

- V1 is frozen; it must never become a V2 runtime/business/table dependency.
- The canonical unit is `V2LeadAssignment` (Company × Project × ICPVersion), never a global company.
- Qualification (immutable, on `V2HardRuleAssessment`) and `workflowStatus` (mutable, on `V2LeadAssignment`) are separate.
- `V2HardRuleAssessment` is insert-only; `NOT_SCORED` is derived from `latestHardRuleAssessmentId IS NULL`.
- `UNCERTAIN` is deprecated; never written or surfaced as canonical V2 qualification (render `NEEDS_REVIEW`).
- No send leaves the system without a synchronous suppression check immediately before the provider call.
- Every backend stage proves tenant isolation and idempotency; every backend milestone is paired to a SEE-IT surface.

## 2. Grounded Repo Reality (verified against files — this REPLACES guesswork)

Per-stage truth, with evidence. `✅` = exists and wired, `⚠️` = partial / not surfaced, `❌` = missing.

| Stage | Model | Runtime | Route | UI | Evidence |
|---|---|---|---|---|---|
| Product tree + ICP | ✅ | ✅ read | — | ✅ | `lib/v2/product-tree/*`, `lib/v2/icp/*`; ICP **authoring/publish** ❌ |
| Upload intake | ✅ | ✅ | ✅ | ✅ | `app/v2/ingestion/route.ts` — tenant-scoped (`ingestion.apply`), **idempotent** by `clientRequestId`+`fileHash` |
| Parse / Normalize / Identity / Upsert / Enrich / Score | ✅ | ✅ **all real** | ✅ | ⚠️ | `lib/v2/jobs/handlers.ts:50-55` — 6/6 handlers real (no stub) |
| Scoring persistence + rescore | ✅ | ✅ | — | — | `lib/v2/scoring/runtime/{persistHardRuleAssessment,enqueueScoringJobs,scoreLeadAssignments}.ts`; immutable + fingerprint reuse; 4th state + `accountPreRank` already shipped (migration `20260614034215_v2_p1s0b_qualification_first_class`) |
| CRM lead workspace | ✅ | ✅ read | — | ✅ | `lib/v2/crm/queryLeadWorkspace.ts`, `app/v2/leads/page.tsx`; `NOT_SCORED` derived |
| Manager review | ✅ | ✅ producer **+ resolution** | ❌ | ❌ | `lib/v2/manager-review/{createReviewItem,resolveReviewItem,...}.ts` exist; **not exposed via route/UI**; does **not** enqueue rescore |
| Feedback | ✅ model | ❌ | ❌ | ❌ | `V2FeedbackExample` schema only; no `lib/v2/feedback/` |
| Activity / tracking | ❌ **no model** | ❌ apply stub | ❌ | ❌ | only `lib/v2/activity-recaps/{matchResolver,normalizeActivityRow}.ts`; **no `V2ActivityRecord`**; `ACTIVITY_APPLY` = stub |
| Outreach | ❌ (only `V2SuppressionEntry`) | ❌ | ❌ | ❌ | no sender/sequence/step/message/outreachActivity/providerEvent; `EMAIL_SEND`/`SEQUENCE_STEP_EXECUTE` = stub |
| Suppression gate | ✅ model | ❌ | — | — | `V2SuppressionEntry` exists; **no `assertNotSuppressed` runtime** |
| Export | — | ❌ stub | ❌ | — | `EXPORT_GENERATE` = stub |
| Job execution | ✅ | ✅ claim/process | ✅ route-driven | — | `lib/v2/jobs/{claimNextJob,processJob,enqueueJob}.ts`; drained by `process-next`/`run-until-idle` routes; **no daemon/cron** |

**Conclusion that drives this plan:**

- **Load + Qualify ≈ 90% built and already linked at runtime.** The old plan's scoring/CRM re-build track is
  mostly redundant; only ICP authoring UI and (optional) rules-v2/fact-token quality remain.
- **Tracking ≈ 10%** (helpers exist, no durable model, no apply, no timeline).
- **Outreach ≈ 0%** (only the suppression *table* exists).

So the real critical path to the outcome is: **prove the existing spine → build Tracking → close CRM loops →
build Outreach → Reporting/hardening.** That is the order in §5.

## 3. The Real Linkage Spine (every arrow is code, marked by status)

```txt
[Context: Account->Project->Offer->ICPProfile->ICPVersion(PUBLISHED, rulesJson)]
  ✅ models+runtime   ·   authoring/publish UI ❌
        | projectId + icpVersionId (ICP must be PUBLISHED + have rulesJson)
        v
POST /v2/ingestion  --✅ idempotent-->  V2IngestionJob
        | enqueue INGESTION_PARSE
        v
PARSE ✅ -> NORMALIZE ✅ -> IDENTITY_MATCH ✅ (resolveIdentity, shared, VN-normalize)
        |  exact -> row MATCHED        candidate/conflict -> createReviewItem ✅ (read-only)
        v
LEAD_ASSIGNMENT_UPSERT ✅ (Company×Project×ICPVersion, idempotent)
        | enqueue COMPANY_ENRICHMENT
        v
COMPANY_ENRICHMENT ✅ (neutral facts + evidence + freshness)
        | enqueue ICP_SCORE
        v
ICP_SCORE ✅ -> V2HardRuleAssessment (immutable, latest pointer, 4 states, accountPreRank)
        v
/v2/leads ✅ read   --why-drawer ⚠️--   lead timeline ❌
        |-> Manager Review : producer ✅ · resolve runtime ✅ · ROUTE+UI ❌ · ->rescore ❌
        |-> Feedback       : model ✅ · capture ❌ · /v2/feedback ❌ · ->ICP tuning ❌
        |-> Export         : stub ❌  (must reuse queryLeadWorkspace filter)
        |-> Activity       : model ❌ · apply ❌ · /v2/activity-recaps ❌  => lead timeline ❌
        |-> Outreach       : models ❌ · gate ❌ · SMTP ❌ · send ❌ · sequence ❌ · IMAP inbound ❌
                 |  send -> OutreachActivity -> [LEAD TIMELINE, shared] -> IMAP reply/bounce -> Suppression + workflow + halt
                 v
        Reporting : /v2/home ❌ · /v2/reports ❌ · /v2/jobs ❌  (must reuse the same scoped queries)
```

The `upload -> score` segment is already one connected spine. The work is the downstream branches —
and four cross-cutting **linkage contracts** keep them one OS instead of isolated pages.

## 4. Cross-Cutting Linkage Contracts (the connective tissue — decisions locked)

### Link A — One unified Lead Timeline  *(LOCKED: unified)*

The lead drawer shows a **single chronological stream** merging all four event sources:

```txt
queryLeadTimeline(leadAssignmentId) = UNION, ordered by occurredAt of:
  - workflowStatus changes        (V2AuditEvent)
  - manager review resolutions    (V2ManagerReviewItem / V2AuditEvent)
  - human activities              (V2ActivityRecord    — calls/meetings/recaps)
  - outreach events               (V2OutreachActivity  — send/open/reply/bounce)
```

Hard requirements that bind two future schema sessions together:

- `V2ActivityRecord.leadAssignmentId` (FK) **and** `V2OutreachActivity.leadAssignmentId` (FK) are mandatory.
- Both carry `occurredAt` and an `eventKind`/`channel` so the union renders one stream.
- **T1 (activity schema plan) and O1 (outreach schema) MUST agree on this timeline contract before either migration.**
  Neither table may ship a shape the other cannot union into. This is what prevents "isolated pages."

### Link B — Suppression is the single send chokepoint  *(LOCKED: gate before any send)*

```txt
every send path (manual O4, sequence step O5)
   -> assertNotSuppressed(organizationId, {email, domain}) SYNCHRONOUSLY, immediately before provider call
   -> SuppressedError blocks; redacted audit event written
hard bounce (SMTP 5xx at send time, or async DSN parsed via IMAP - O7) -> writes V2SuppressionEntry -> feeds the SAME gate -> loop closed
```

- There is exactly **one** gate function. No flag, fast path, or sequence shortcut may bypass it.
- **O2 (gate) must exist and be tested before any send code (O4) is merged.** A test must assert that a
  send handler wired without the gate fails.

### Link C — The learning / freshness loop  *(uses code that already exists)*

```txt
Manager review resolve (resolveReviewItem ✅)
   -> if corrected data changes scoring input: enqueueScoringJobs(ICP_SCORE) ✅, idempotent   [M2]
Feedback (V2FeedbackExample)
   -> NEVER mutates assessment or rulesJson
   -> surfaces as aggregate signal in ICP authoring (R5)
   -> closes only when a NEW ICPVersion is published -> new fingerprint -> bulk rescore (enqueueScoringJobs by context)
```

Assessments stay immutable; rules change only by publishing a new version; rescore is always idempotent.

### Link D — The execution driver  *(LOCKED: add scheduler)*

```txt
Today: jobs drain via HTTP routes (process-next / run-until-idle) — fine while a user is present (upload).
Automated sequences fire steps hours/days later with NO user present.
=> O5s adds a background scheduler/worker that (a) drains due jobs (incl. SEQUENCE_STEP_EXECUTE with run-at)
   so automated outreach advances, and (b) runs the IMAP inbound poller for replies/bounces.
   Without it, both "enqueue step -> execute later" and "read replies/bounces" links are broken.
```

### Capacity target: 100,000+ emails / month  *(LOCKED)*

The SMTP+IMAP path must sustain **100k+ sends/month (~3.3k/day, with bursts)** without degrading deliverability
or the suppression gate. This is a first-class design constraint, not a later optimization:

- **Two sender kinds in ONE pool** (`V2SenderAccount.kind`):
  - `RELAY` — a high-throughput SMTP relay (e.g. SES-SMTP / Postmark-SMTP) on **your** domain; carries bulk volume;
    SPF/DKIM/DMARC under your control. One relay can cover ~3.3k/day easily.
  - `MAILBOX` — an individual **Gmail (~500/day)** or **Google Workspace (~2000/day)** account, each with its own
    SMTP + IMAP; low cap, needs warmup; used for high-touch/personalized sending and to spread reputation.
  The pool selector **routes by campaign type + per-sender remaining cap + health**, mixing relay (volume) and
  warmed mailboxes (personal). 100k/mo ≈ 3.3k/day → e.g. 1 relay, or ~2-3 Workspace + several Gmail mailboxes
  (post-warmup), or a blend. Sizing is a function of how many healthy senders × their warmed daily caps.
- **Warmup is a first-class function** (you will run many low-cap mailboxes):
  - Each `MAILBOX` ramps `currentDailyCap` from a low seed (e.g. 20-40/day) toward `targetDailyCap` over weeks.
  - The scheduler (O5s) advances the ramp **daily**, and **pauses or rolls it back when health degrades**
    (bounce rate, spam-complaint signals, auth failures) — protecting deliverability for the whole pool.
  - A mailbox only counts toward steady-state volume once it passes a minimum warmup stage (O9).
  - Warmup state lives on `V2SenderAccount`; relays may also warm a new domain/IP.
- **Queue throughput.** Sends are job-backed (`EMAIL_SEND`/`SEQUENCE_STEP_EXECUTE`); the worker (O5s) drains at the
  required rate with bounded concurrency, retry/backoff, and SMTP connection pooling/reuse per sender.
- **Suppression at scale.** `assertNotSuppressed` must be an **indexed lookup** (org + normalized email + domain);
  the suppression table grows with bounces and must stay O(1)-ish on the hot path before every send.
- **Deliverability per kind.** RELAY: SPF/DKIM/DMARC on your domain. MAILBOX: Workspace (custom-domain DKIM) is
  fine; **plain @gmail.com has tight limits + weak cold-outreach deliverability — flag it, prefer it for warm/reply
  traffic.** Throttling + warmup required for 100k/mo to land in inboxes (tracked in O9 + H2).
- **IMAP at scale.** The poller tracks per-mailbox UID high-water marks (no reprocessing), batches fetches, polls
  **every mailbox + each relay return-path**, and indexes outbound `Message-ID` for fast reply/bounce correlation.

### Outreach transport: SMTP (send) + IMAP (inbound)  *(LOCKED)*

- **Outbound = SMTP.** The provider layer (O3) ships a `ProviderInterface`, a **sandbox provider**, **and a
  real SMTP adapter** (host/port/user/pass over TLS, nodemailer-style) with an **encrypted credential loader**.
  We do **not** cap the architecture at sandbox. Live sending stays disabled by default behind an org/config
  flag; cutover is **O9** (verified sender domain, rate/daily caps, kill switch).
- **Inbound = IMAP, NOT provider webhooks.** SMTP/IMAP has no signed webhook. Replies and bounces are read by
  an **IMAP poller/IDLE worker** (O7) and correlated to the outbound message we actually sent:
  - **Reply** = inbound message whose `In-Reply-To`/`References` matches a stored outbound `Message-ID`.
  - **Bounce** = (a) synchronous SMTP `5xx` at send time, and (b) async **DSN** (`multipart/report;
    report-type=delivery-status`) parsed from the mailbox, mapped back to the original recipient.
  - **Open/click are NOT available natively** over SMTP/IMAP — they require a tracking pixel / link rewrite.
    Treat open-rate widgets in the mock as **deferred** until a tracking mechanism is added (see Mock coverage §4b).
- **Trust model (Invariant 9 intent preserved):** there is no HMAC signature, so inbound trust comes from
  (1) an authenticated TLS IMAP connection to our own mailbox, and (2) **correlation** — never act on a
  reply/bounce that cannot be matched to a real outbound `Message-ID` we sent. Un-correlatable inbound is ignored,
  the same way an unsigned webhook would be rejected.
- Threading requirement: O4 must persist each outbound `Message-ID` and set proper headers so replies thread,
  otherwise O7 cannot correlate inbound mail.

## 4b. Mock UI Coverage — "will this produce the mock?"

Verdict: **structurally yes** — every surface in `lib/v2/UI mock/V2_full_mock.png` has an owning session — with
three honest caveats below. The plan is **truth-first**: where the mock shows something that violates an invariant
(global company score, `Uncertain` status, fabricated counts), the page renders the correct version instead.

| Mock surface | Route | Owning session(s) | Note |
|---|---|---|---|
| Home / Executive | `/v2/home` | U0 + R1 | counts real + context-scoped |
| Accounts portfolio | `/v2/accounts` | exists + U0 + R8 hubs | rollups via R8 |
| Projects workspace | `/v2/projects` | exists + U0 + R8 hubs | rollups via R8 |
| ICP Builder | `/v2/icp-library` | exists (read) + R5 authoring | publish/OCC in R5 |
| Leads workspace | `/v2/leads` | exists + U0 + Z2 | LeadAssignment rows, 4 states |
| Lead Brief / drawer | drawer | Z2 + T4/T5 timeline + R-brief | one unified timeline (Link A) |
| Companies (Multi-ICP) | `/v2/companies` | exists + U0 | cross-ICP, no global score |
| Contacts | `/v2/contacts` | R4 | linked to LeadAssignment |
| Manager Reviews | `/v2/reviews` | exists + M1 | interactive resolution |
| Feedback | `/v2/feedback` | M3 | immutable examples |
| Uploads / Ingestion | `/v2/uploads`, `/v2/ingestion` | exists + U0 + Z2 | real pipeline |
| Activity Recaps | `/v2/activity-recaps` | T5 | real activity records |
| Outreach workspace | `/v2/outreach` | O4-O8 | SMTP send + IMAP inbound |
| Reports / analytics | `/v2/reports` | R2 + O8 | reuse scoped queries |
| Jobs ops | `/v2/jobs` | R3 | retry/cancel/inspect |
| AI insight panels | drawer/home | **ADD: R-AI** | see caveat 1 |
| Settings / AI readiness | `/v2/settings/ai` | **ADD: R7** | see caveat 2 |

**Three caveats (be explicit, do not pretend):**

1. **AI insight panels.** The mock shows AI narrative/insight cards. `V2AiInsight` exists but `AI_INSIGHT_GENERATE`
   is a stub, and per AGENTS.md AI output is **advisory, not production truth**. Parity options: (a) render advisory
   panels fed by imported/human-filled data, or (b) add a session **R-AI** that builds an AI insight runtime as
   clearly-labelled advisory. Until then these cards stay empty/disabled, not faked.
2. **Settings / AI readiness page** (`/v2/settings/ai`) — add **R7**: read-only provider/SMTP/IMAP readiness
   (enabled/disabled, sender-pool health, missing-key warnings) **without printing secrets**.
3. **Open/click metrics** in the outreach mock — **not available under SMTP/IMAP** natively. Hidden or deferred to a
   tracking-pixel session; never shown as fake numbers (see O8 / §4 transport).

So: running the plan produces the mock's screens and structure; the three items above are the only places where you
get "real but different from the mock illusion" or "needs one extra session." (R7/R8/R-AI are added to §6 R-phase.)

## 4c. Multi-ICP Scoring Engine — Schema, Logic, Metrics & Coding

This **supersedes the thin "R6 rules-v2 + fact-token lock"** item. Scoring correctness is the product's core
value: a company is only worth anything once it is correctly qualified **for a specific ICP**. The v1
`lib/v2/scoring/icpRulesSchema.ts` + Codex's `TELESTAR_SAAS_OUTBOUND_ICP_RULES` cover ~one ICP partially. The
**18 real client ICPs** (Stormwall, 1CloudHub, Saigon Technology, Dpoint, STS, TeleStar, TeleStar-Design,
Cyberstash, Alison, Cloudian, FlexEnergy, CoreAI, Chainwire, 1C, Cosmose, BiziTrip, Antsomi, Camelo) — captured in
`docs/v2/plan/V2_ICP_CORPUS.md` — are the **requirement corpus and golden test suite** for the multi-ICP engine. Everything below is fact-driven and
deterministic (Invariant 7; benchmark scripts never call live AI). The legacy V1 scoring logic is a **reference for
dimension semantics only** (esp. generic-email + persona) — it must be **re-implemented natively in V2, enhanced
not copied** (Invariant 1; V1 is frozen).

### 4c.1 Dimension coverage matrix (what the 18 ICPs actually demand)

| Dimension | Variety seen across the 18 ICPs | Example ICPs | v1 support |
|---|---|---|---|
| **Geography** | target lists · exclusions · **regions** (APAC/SEA/ANZ/EU/North America/South America/MENA/North-Central Africa/Nordics) · **office/factory location ≠ HQ** ("has offices in", "have nhà máy in Vietnam") · **priority tiers** ("ưu tiên nước giàu trước") · **sub-national** ("German-speaking part") | Stormwall, STS, TeleStar, Chainwire, FlexEnergy, Alison(exclude India) | ⚠ list+exclude only |
| **Industry / Vertical** | `ALL` · allowlist · **denylist** · keyword · **product-vs-service** · **sub-industry** (manuf: Craft/Plastics/Metals…) · facility-type lists | TeleStar(ALL+exclude services), Chainwire(exclude list), STS(sub-industries), Cyberstash(facility types) | ⚠ keyword signals only |
| **Persona / Title** | allowlist · **denylist** ("no manager", "no engineer", no sales/growth/designer) · **tiers** (tier1/tier2) · **seniority floor + exclusions** · **department-based** · keyword · **language variants** (German titles) · **company denylist** (Google/Meta/TikTok, Vinamilk) · **per-product persona sets** | Alison, 1CloudHub, Chainwire, Cosmose, FlexEnergy, 1C | ❌ only `personaTitle: boolean` |
| **Company Size** | numeric min/max · **qualitative bands** (SME / Mid / "Medium-rare→Medium" / Enterprise / multi-location) · **revenue** (>$1M) · "exclude too small" | Saigon, STS, Antsomi, Camelo, Cloudian | ⚠ numeric only |
| **Disqualifiers** | **generic/Gmail email** · one-person · website-offline · services/consulting **with market-conditional exception** ("except Vietnam") · **competitor denylist** · **project-based** flag | TeleStar, Alison, Dpoint, CoreAI | ⚠ partial, no email/competitor/conditional |
| **Conditional overrides** | market/segment-specific rule exceptions | TeleStar (services OK only in VN) | ❌ |
| **Account-supplied lists** | pre-approved companies; skip/auto-qualify | FlexEnergy ("supported from account") | ❌ |
| **Sub-ICPs** | multiple persona/industry/size sets under one client/product | Chainwire (crypto + cyber), 1C (3 products) | ❌ |

### 4c.2 Rule schema vNext — `IcpVersionRules` `schemaVersion: "v2"`

Additive over v1; keep v1 readable via `upgradeV1toV2`. Never mutate published versions (Invariant 4); a v2 publish is a new version. Sketch (pseudo-TS):

```txt
geography: {
  targetCountries[]; excludedCountries[];
  targetRegions[];                      // dictionary-expanded (APAC -> [..])
  locationScope: "hq" | "any_office" | "delivery";   // "has office/factory in X"
  officeLocationCountries[];            // required/excluded office geos (Stormwall/STS/TeleStar)
  priorityTiers: [{ tier; countries[]; weightBonus }];   // "rich countries first"
  subNationalRegions[];                 // "German-speaking Switzerland"
  unknownCountryPolicy;
}
industry: { mode: "all"|"allowlist"|"denylist"; targetIndustries[]; excludedIndustries[];
            industryKeywords[]; subIndustries[]; }
companyType: { allow: CompanyType[]; deny: CompanyType[];
               servicesConsultingPolicy: { disqualify: bool; exceptMarkets: string[] }; }  // VN exception
persona: {
  titleAllowlist[]; titleDenylist[];
  titleTiers: [{ tier; titles[]; keywords[]; weight }];
  seniorityFloor: SeniorityTier; seniorityExclusions: SeniorityTier[];  // "no manager"/"no engineer"
  departmentAllowlist[]; departmentSeniorityOverrides;                  // HR/Admin: IC ok
  titleKeywords[]; languageVariants: { locale: titles[] };             // German titles
  requirePersonaForFinalQualification: bool;
}
size: { minEmployees?; maxEmployees?; sizeBands: SizeBand[];   // qualitative -> range
        minRevenueUsd?; multiLocationOk?; excludeTooSmall?; }
disqualifiers: { genericEmailContact: terminal; onePersonCompany: terminal; websiteOffline: terminal;
                 servicesConsulting: uses companyType policy; competitorDenylist: string[];   // names/domains
                 projectBasedFlag; }
accountSupplied: { mode: "score" | "preapproved_skip" | "preapproved_autoqualify" }
subIcps?: IcpSubProfile[]   // each overrides persona/industry/size; lead scored vs best-matching sub
requiredEvidenceForFinalQualification: { explicitGeo; employeeSize; personaTitle; websiteReachable }
scoringWeights{geo,industry,companyType,size,persona,signals} (sum 100); scorePolicy; confidencePolicy
```

### 4c.3 Scoring pipeline (deterministic order)

```txt
0. NORMALIZE evidence (NFC + diacritics; raw country -> canonical + region; raw title -> {seniorityTier,
   department, keywords, locale}; raw size/revenue -> band; detect generic-email; detect website status).
1. ACCOUNT-SUPPLIED gate: preapproved_skip -> short-circuit (NOT_SCORED/marked); preapproved_autoqualify -> QUALIFIED.
2. TERMINAL HARD GATES (any hit -> UNQUALIFIED, stop, record reasonCodes):
   excluded country/office-location · one-person · website-offline · services/consulting (unless exceptMarkets) ·
   generic-email contact · competitor denylist · project-based.
3. PER-DIMENSION SUB-SCORES (0-100 each; each emits hits[] + missingEvidence[]):
   geoScore · industryScore · companyTypeScore · sizeScore · personaScore(contact-level) · signalScore.
4. accountPreRank from COMPANY-level dims (geo+industry+companyType+size+company signals)
   -> STRONG_ACCOUNT_FIT | POSSIBLE_ACCOUNT_FIT | WEAK_FIT | CLEAR_MISMATCH.
5. fitScore = weighted sum (per-ICP weights, + priority-tier bonus).
6. confidence = evidence completeness x source quality.
7. QUALIFICATION (4 canonical states ONLY):
   - terminal gate            -> UNQUALIFIED
   - company dims mismatch    -> UNQUALIFIED
   - company fits, persona missing/insufficient AND requirePersona  -> COMPANY_QUALIFIED_NEEDS_CONTACT
   - company fits + persona in allowlist (not denylist, seniority ok, dept ok) + required evidence -> QUALIFIED
   - borderline / low-confidence / persona-denylist-but-company-fits / conflicting -> NEEDS_REVIEW
   - NEVER canonical UNCERTAIN (Invariant 7); legacy lowercase `uncertain` helper output MUST map to NEEDS_REVIEW.
8. PERSIST immutable assessment + input/rules snapshots + fingerprint (rules version + dictionary versions).
```

### 4c.4 Scoring metrics (persist on `V2HardRuleAssessment`, surface in why-drawer + reports)

```txt
per-assessment:
  fitScore(0-100) · confidenceScore(0-100) · confidenceBand · qualification(4-state) · accountPreRank(4-state)
  subScores{ geoScore, industryScore, companyTypeScore, sizeScore, personaScore, signalScore }
  personaMatch{ tier, matchedTitle, seniorityTier, department } · hardDisqualifiersHit[]
  positiveSignalsHit[] · negativeSignalsHit[] · reasonCodes[] · reviewFlags[]
  missingEvidence[] (target_persona_missing_required, geo_unknown, size_unknown, website_unreachable, generic_email)
  evidenceSnapshotJson · rulesSnapshotJson · inputFingerprint
aggregate (CRM / reports, per ICP version):
  qualification distribution (QUALIFIED / COMPANY_QUALIFIED_NEEDS_CONTACT / NEEDS_REVIEW / UNQUALIFIED / NOT_SCORED)
  accountPreRank distribution · scoring coverage % · persona-readiness rate · top disqualifier reasons
  cross-ICP: same company scored differently across ICPs (Companies workspace, no global company score)
```

### 4c.5 Reference dictionaries (versioned data; a change = new fingerprint)

```txt
regionToCountries   : APAC, SEA, ANZ, EU, North/South America, MENA, North/Central Africa, Nordics, German-speaking -> country lists
genericEmailDomains : gmail / yahoo / hotmail / outlook / icloud / proton ...   (the Gmail disqualifier)
seniorityTaxonomy   : title -> { seniorityTier C_LEVEL|VP|DIRECTOR|HEAD|MANAGER|IC, department }; multilingual (EN + German: Direktor/Leiter/Geschaftsleitung)
industryTaxonomy    : raw industry -> canonical + parents (allow/deny/sub-industry)
sizeBandMap         : "SME" / "Mid-market" / "Enterprise" / "Large" / "multi-location" -> employee ranges + revenue
```

### 4c.6 Module / code structure

```txt
lib/v2/scoring/rules/        schema-v2.ts (zod) · upgradeV1toV2.ts · dictionaries/{regions,genericEmail,seniority,industry,sizeBands}.ts
lib/v2/scoring/normalize/    normalizeCountry/title/size/email/website.ts  (pure)
lib/v2/scoring/gates/        terminalGates.ts  (each disqualifier = pure predicate -> hit | null)
lib/v2/scoring/dimensions/   geoScore · industryScore · companyTypeScore · sizeScore · personaScore · signalScore
                             (pure: (evidence, rules) -> { score, hits[], missingEvidence[] })
lib/v2/scoring/deriveQualification.ts   4-state derivation (map any legacy lowercase uncertain -> NEEDS_REVIEW on output)
lib/v2/scoring/runtime/      buildScoringInput · scoreLeadAssignments · persistHardRuleAssessment · enqueueScoringJobs  (existing)
lib/v2/scoring/__fixtures__/icpCorpus/  the 18 ICPs as IcpVersionRules v2 + golden companies + expected outcomes
```

Coding rules: pure deterministic functions; **every dimension returns hits + missingEvidence** so the why-drawer and
reasonCodes are fully explainable; no live AI/provider in scoring or benchmarks (AGENTS.md); assessments immutable;
fingerprint includes rules version + dictionary versions so a dictionary bump triggers a clean rescore.

### 4c.7 Test & eval — the 18-ICP corpus is the golden suite

```txt
Per ICP: >=1 QUALIFIED, >=1 COMPANY_QUALIFIED_NEEDS_CONTACT, >=1 NEEDS_REVIEW, >=1 UNQUALIFIED golden company
         with expected reasonCodes + subScores.
Cross-ICP determinism (same company, different ICP -> different correct outcome), e.g.:
  - VN services company: UNQUALIFIED for TeleStar global, but QUALIFIED under the Vietnam-services exception.
  - Singapore IT Director: QUALIFIED for 1CloudHub, UNQUALIFIED (geo) for Alison.
Hard-case fixtures pulled from the corpus: gmail-contact disqualify · one-person · office-in-India exclude ·
  German title seniority (FlexEnergy) · "no manager"/"no engineer" denylist · competitor denylist (Google/Meta/
  TikTok, Vinamilk) · region expansion (APAC -> countries) · qualitative size band · services-except-VN conditional ·
  account-supplied skip · sub-ICP routing (Chainwire crypto vs cyber).
Benchmarks never call live providers (AGENTS.md). check-v2-icp-scoring / score-runtime stay green.
```

### 4c.8 Sequencing — promote scoring to a dedicated SC-phase

Scoring correctness gates the entire product (the multi-ICP logic has been reworked repeatedly), so it must NOT sit
at the tail R-phase. Insert an **SC-phase right after Z, before/parallel to Tracking**:

```txt
SC1  schema-v2 + dictionaries (pure, no DB)                         [pure-runtime]
SC2  dimension scorers + terminal gates (pure, 18-ICP fixtures)     [pure-runtime]
SC3  deriveQualification 4-state + metrics/subScores                [pure-runtime]
SC4  persistence + bulk rescore-by-ICP wiring (uses existing runtime)[runtime]
SC5  ICP authoring UI for v2 (replaces R5; create/clone/edit/diff/publish, OCC)  [UI]
SC6  why-drawer shows per-dimension subScores + personaMatch + missingEvidence   [UI]
```

This replaces the old thin `R6 rules-v2` (now SC1-SC4) and folds `R5 authoring` into `SC5`. The 2 gaps found in
Codex's current TeleStar rules (Gmail/generic-email disqualifier; persona title allowlist/denylist/tiers) are
**resolved by SC1-SC3** — they are schema/scorer capabilities, not data tweaks.

## 4d. Runtime Job-Chaining & Claim-Scope Contract (every enqueue names its drainer)

READ THIS BEFORE WIRING ANY RUNTIME STAGE (ingestion, scoring, CRM rescore, activity, outreach). A real,
hard-to-debug leak shipped because this was implicit: the multi-ICP engine (SC1-SC6) was correct and tested,
yet **every uploaded lead stayed unscored** — not because scoring was wrong, but because the `COMPANY_ENRICHMENT`
and `ICP_SCORE` jobs were enqueued with a **source the run control could not claim**, so they sat `QUEUED`
forever and the pipeline silently stalled at enrichment. No error, no failed job — just a dead chain. Symptoms
("scoring stuck", "UI shows nothing") pointed at the UI; the cause was a one-line source-binding mismatch deep in
the job layer. The same class of bug will hide in CRM and outreach unless this contract is enforced.

### The model

The V2 pipeline is **a chain of async jobs**, not a function call. There is **no background worker/daemon yet**
(that is `O5s` / Link D). Jobs only run when a **run control drains them**, and a run control claims jobs by
**source scope**, not by job type alone. `claimNextJob` (`lib/v2/jobs/claimNextJob.ts`) claims by, in order of
specificity: `{org, ingestionJobId, jobType}` and `{org, ingestionJobId}` (both require
`sourceType='INGESTION_JOB' AND sourceId=ingestionJobId`), `{org, jobType}`, `{org}`, `{jobType}`.

The ingestion run control (`/v2/ingestion/[jobId]/run-until-idle`) historically claimed **only**
`{org, ingestionJobId}` — i.e. only `sourceType='INGESTION_JOB'` jobs. The pipeline chain is:

```txt
INGESTION_PARSE → INGESTION_NORMALIZE → IDENTITY_MATCH → LEAD_ASSIGNMENT_UPSERT
   → (per company) COMPANY_ENRICHMENT → (per company's lead assignments) ICP_SCORE
```

The first four stages were enqueued `INGESTION_JOB`-scoped (claimable). But `COMPANY_ENRICHMENT` was enqueued
`sourceType='MANUAL', sourceId=companyId` and `ICP_SCORE` `sourceType='MANUAL', sourceId=null` — **neither
claimable by the run control.** Result: enrichment+scoring were unreachable from the only thing that runs jobs.

### The contract (non-negotiable for every runtime stage)

1. **Every enqueue names its drainer.** When you `enqueue*Job`, you must be able to answer: *what run control or
   worker will claim this, and in what scope?* If the answer is "nothing", the stage is dead on arrival.
2. **Pipeline jobs bind to their pipeline.** A job enqueued as part of the ingestion pipeline is enqueued with
   `sourceType='INGESTION_JOB', sourceId=ingestionJobId` (the enqueue helpers take an optional `source`; the
   ingestion callers pass it, and a handler that enqueues a downstream job **forwards its own source binding**).
   This keeps the whole chain drainable from the one per-batch run control.
3. **The run control drains the whole chain.** `run-until-idle` drains, in scopes that together cover every
   stage: `{ingestionJobId}` (parse→…→upsert + bound enrichment/scoring), then the `COMPANY_ENRICHMENT` and
   `ICP_SCORE` tail by `{org, jobType}` (which also drains legacy `MANUAL`-scoped jobs). Adding a new pipeline
   stage means adding its drain scope here (or shipping the worker).
4. **A stalled chain must be observable.** A job that cannot be claimed is a silent failure. Prefer binding +
   draining; if a job is intentionally deferred (awaiting a worker), it must be surfaced as such, not left to
   look "queued forever".
5. **The proper fix is a worker** (`O5s` background scheduler / Link D) that drains **all** queued jobs for an
   org regardless of source, on an interval. Until it lands, binding + run-control draining is the contract.
   When the worker lands, this whole section collapses to "the worker drains everything" — but the binding still
   documents intent and keeps per-batch runs fast.

### Enforcement

`scripts/check-v2-pipeline-linkage.mjs` is the guard: it proves (behaviorally) that the score-job enqueue honours
its source binding, and (by contract) that enrichment binds to the ingestion job, the handler forwards the binding
onto scoring, and the run control drains the enrichment+scoring tail. **Any new runtime pipeline (CRM
review→rescore, activity apply, outreach send/sequence) adds its chain to this guard.** This is the automated
backstop for Invariant 14 (SEE-IT pairing) at the job layer.

### Company-intelligence depth (search provider env contract)

Enrichment ("rich insight") fetches the company website deterministically (`fetchCompanyPages` + `extractNeutralFacts`
→ geo/size/revenue/office-country/industry/funding tokens; no AI, per AGENTS.md) and feeds SC6 rules-v2 evidence.
Third-party web search is **env-gated** and off by default: `getSearchProvider()` returns the no-op
`StubSearchProvider` unless `V2_SEARCH_PROVIDER` (`brave|serpapi|bing`) + `V2_SEARCH_API_KEY` are set (optional
`V2_SEARCH_ENDPOINT`, `V2_SEARCH_MAX_RESULTS`, `V2_SEARCH_TIMEOUT_MS`). Keys come from env only, are never logged,
and the live provider degrades to `[]` on any error so enrichment never throws. Smoke/benchmark scripts must keep
running on the stub (no live calls without human-supplied credentials).

## 4e. UI Component-Kit Registry + UI↔Workflow Linkage Contract

READ THIS BEFORE ANY UI SESSION. The same leak that hid the scoring engine (built but unreachable) and stalled
the pipeline (enqueued but undrained) appears in UI as **pages that look right but render mock data, or duplicate
shells/tables/badges, or claim a workflow the backend cannot perform.** UI is part of the OS only when every
surface is wired to a real read-model and a real action — "workflow + UI logically linked", not isolated pages.

### Canonical component kit (reuse — do not re-invent)

Every UI surface composes from the shared kit in `components/shared/*` (and registered `components/v2/*`). The
design pack's primitive names map to existing files; a UI session **must reuse these, not fork new ones**:

```txt
Pack primitive        -> repo (reuse)                                  status
AppShell              -> components/shared/AppShell.tsx                 ✅
Sidebar               -> components/shared/SideNav.tsx                  ✅
Topbar                -> components/shared/TopBar.tsx                   ✅
ContextBar            -> components/v2/shell/* (context bar)            ✅ (verify)
PageHeader            -> components/shared/PageHeader.tsx               ✅
StatCard / StatStrip  -> components/shared/{StatCard,MetricCard,WorkspaceMetricGrid}.tsx  ✅
FilterPanel           -> components/shared/{FilterBar,FilterChipBar}.tsx ✅
DataTable             -> components/shared/DataTableShell.tsx           ✅
StatusBadge / Qualification / Workflow -> components/shared/statusBadges.tsx  ✅ (canonical tokens only; no UNCERTAIN)
DetailDrawer          -> components/shared/{DrawerSection,PanelCard}.tsx + components/v2/leads/LeadDrawer.tsx  ✅
Tabs                  -> components/shared/Tabs.tsx (U0; lightweight, accessible, no dep)  ✅
StickyActionBar       -> components/shared/StickyActionBar.tsx          ✅
EmptyState/Loading/Error -> components/shared/{EmptyState,LoadingSkeleton,ErrorState,ErrorBanner}.tsx  ✅
ScoreRing             -> components/shared/ScoreRing.tsx (U0; SVG, tier colors)  ✅
EvidenceCard          -> components/shared/EvidenceCard.tsx (U0; why-drawer/data-log)  ✅
Stepper               -> MISSING (add with the upload flow surface)     ❌
Timeline              -> components/v2/leads timeline (T5) -> promote to shared primitive  ⚠️
UploadDropzone        -> components/v2/uploads/* -> promote if reused    ⚠️
AuditSnapshotCard     -> MISSING (add with the data-log/audit surface)  ❌
SequenceCanvasNode / SuppressionGateCard / SenderHealthCard -> MISSING — OUTREACH, gated behind O1-O9  ❌
v2 palette tokens     -> app/globals.css `.v2-theme` (scoped to app/v2/layout.tsx; pack §2; no V1 impact)  ✅
```

U0 establishes the V2 palette (`.v2-theme` on the V2 shell only — primary #0F5BF4, bg #F8FAFC, etc.) and the
broadly-used primitives (Tabs, ScoreRing, EvidenceCard). Remaining primitives are added with the first surface
that needs them (Stepper/UploadDropzone with upload, AuditSnapshotCard with audit, the 3 outreach ones with U3).
```

Rule: a UI session that needs a primitive not in this registry **adds it to `components/shared` (registered
here)**, it does not inline a one-off. No new app shell, table, drawer, or badge component outside the registry.

### UI↔workflow linkage contract (every surface names its data + its action)

A UI session is not ready to code until it can fill this, exactly like the workflow linkage block (Invariant 12):

```txt
SURFACE: <route or drawer>            MOCKUP: <slice file in design/mockups/**>
UPSTREAM (read):   the REAL tenant-scoped read-model it renders (e.g. queryLeadWorkspace, queryLeadTimeline,
                   queryIcpLibrary, queryFeedbackLog) — NOT mock rows. Mock data is allowed only as a clearly
                   labelled visual placeholder for an unbuilt backend, never shipped as truth (Invariant 7).
DOWNSTREAM (act):  the REAL action/route it triggers (workflow update, resolve review, enqueue rescore,
                   publish ICP, export) — or "read-only" if none. No button that does nothing.
PRODUCT STATES:    LeadAssignment is the unit (never company-level scoring); qualification ≠ workflowStatus;
                   NOT_SCORED is derived; canonical badges only (no UNCERTAIN); suppression-gate-before-send;
                   AI advisory-only.
BACKED-BY:         ✅ read-model+action exist | ⚠️ partial | ❌ backend missing -> surface is BLOCKED until it lands.
```

A surface whose UPSTREAM/DOWNSTREAM is `❌` is **not buildable as truth yet** — it waits for its backend phase
(e.g. Outreach pages wait for O1-O9; the suppression gate must exist before any "send" UI). This is what keeps
workflow and UI linked: the plan never ships a page that pretends to do work the system cannot do.

## 5. Outcome-First Execution Order

```txt
Z  Prove + trust the existing spine
   Z1  Repair smoke gates                              [scripts]                  ✅ DONE (751882b)
   U0  V2 product shell + design system (mock parity foundation)                [UI components]   ⬜ not started (full-lane)
   Z2  Lead workspace truth + timeline shell + prove upload->score in browser   [UI · SEE-IT]     ✅ DONE code (498c693); browser SEE-IT pending

SC Multi-ICP scoring engine (see §4c — scoring correctness gates the whole product; 18-ICP corpus)  ✅ PHASE COMPLETE
   SC1 schema-v2 + dictionaries (regions, genericEmail, seniority, industry, sizeBands)  [pure-runtime]  ✅ DONE (a9fc4d1)
   SC2 dimension scorers + terminal gates (18-ICP fixtures)                              [pure-runtime]  ✅ DONE (9a84a68)
   SC3 deriveQualification 4-state + metrics/subScores                                   [pure-runtime]  ✅ DONE (cd12138)
   SC4 persistence + rules-v2 SCORE-HV0 runtime wiring (immutable, fingerprinted)        [runtime]       ✅ DONE (cd12138)
   SC5 ICP authoring UI v2 (clone/edit/calibrate/publish, OCC) — replaces R5             [UI]            ✅ DONE (f658529); browser SEE-IT pending
   SC6 why-drawer: per-dimension subScores + personaMatch + missingEvidence + evidence enrich [UI · SEE-IT]  ✅ DONE in working tree (uncommitted); browser SEE-IT pending

T  Tracking pillar  (first: cheap, and DEFINES the timeline contract O reuses — Link A)
   T1  Activity schema plan + unified timeline contract                          [docs]   ✅ DONE (docs/v2/plan/V2_ACTIVITY_AND_TIMELINE_CONTRACT.md); O1 bound to its §3
   T2  V2ActivityRecord migration                                                [schema]  <- NEXT (needs migration approval)
   T3  ACTIVITY_APPLY runtime                                                    [runtime]
   T4  queryLeadTimeline read model                                             [read-model]
   T5  /v2/activity-recaps UI + lead-drawer timeline                            [UI · SEE-IT]

M  Close the CRM loops  (runtime mostly exists; expose + bridge)
   M1  /v2/reviews resolution route + UI                                        [route+UI · SEE-IT]
   M2  Review -> rescore bridge (Link C)                                        [runtime]
   M3  Feedback capture + /v2/feedback (Link C)                                 [runtime+UI]
   M4  EXPORT_GENERATE reusing queryLeadWorkspace filter                        [runtime+route]

O  Outreach pillar  (SMTP send + IMAP inbound, live-capable, safety-gated, 100k/mo)   ✅ O0-O9 LOGIC DONE
   O1  Outreach schema: sender pool + sequences + messages + activity (Link A)  [schema]    ✅ (dfa26d9)
   O2  Suppression gate assertNotSuppressed, indexed (Link B)  <- before any send [runtime] ✅ (079a398)
   O3  SMTP provider + sender pool (RELAY+MAILBOX) + warmup policy + creds       [runtime]   ✅ (0cea9af) adapter INERT
   O4  Manual send (EMAIL_SEND -> gate -> SMTP -> OutreachActivity -> timeline) [runtime+UI · SEE-IT]  ✅ runtime (e16fd93); UI deferred
   O5  Sequences (per-step gate, stop-on-reply/bounce/meeting)                  [runtime+UI] ✅ runtime (1090d6d); UI deferred
   O5s Scheduler/worker: drain due sends + IMAP inbound poller (Link D)         [infra]      ✅ drain route+script (3e97da2); IMAP client not wired
   O6  Call / LinkedIn activities -> same timeline                             [runtime/UI] ✅ (408f028)
   O7  IMAP inbound: reply/bounce(DSN) correlation -> suppression+workflow+halt [runtime+security] ✅ (62eb211)
   O8  Outreach reporting (open/click deferred under SMTP/IMAP — see §4b)       [read-model+UI] ✅ read-model (d186dd4); UI deferred
   O9  Live cutover: per-kind auth + warmup-gated pool + caps + kill switch     [runtime+ops · gated] ✅ guards (93885c3); transport NOT wired

   ⚠️ O-LIVE (PENDING, gated, before flipping liveSendEnabled): wire a real SMTP transport behind the O3
      SmtpAdapter (`transportFactory`) + a real IMAP client behind the O5s poller, load per-sender creds via the
      B1 encrypted loader, and verify per-org domains (SPF/DKIM/DMARC for RELAY; custom-domain DKIM for Workspace).
      Until this lands, O3's adapter is inert and O9 ships only the guards — no live mail leaves the system.
      Add a seeded-DB integration smoke for the EMAIL_SEND/SEQUENCE_STEP_EXECUTE raw-SQL handlers at the same time.

R  Reporting + operations + hardening (close the OS)
   R1  /v2/home command center           R2  /v2/reports
   R3  /v2/jobs operations               R4  /v2/contacts
   R5  -> moved to SC5 (ICP authoring v2)
   R6  -> replaced by SC1-SC4 (multi-ICP scoring engine, see §4c)
   R7  /v2/settings + AI/provider readiness     R8  Account/Project/Offer hubs
   R-AI AI insight runtime (advisory, optional — for the mock's AI panels)
   H1  Permission matrix   H2  Scale tests   H3  Security pass   H4  Data retention
```

Safe fast lane to a usable OS (load -> qualify -> track -> first safe send):

```txt
Z1 -> Z2 -> SC1 -> SC2 -> SC3 -> SC4 -> SC6 -> T1 -> T2 -> T3 -> T4 -> T5 -> M1 -> O1 -> O2 -> O3 -> O4
 ✅    ✅     ✅     ✅     ✅     ✅     ✅     ✅   <-NEXT (migration approval)
```

Progress: the entire **Z + SC** lane is done and SC6 is committed; the **qualify** half of the OS —
load -> identity -> enrich -> **multi-ICP score (18-ICP corpus, 4-state, explainable why-drawer)** — is
functionally complete, reachable from the ICP authoring UI (Upgrade-to-rules-v2), runnable end-to-end from
the ingestion run control (auto-drain), and guarded against runtime-linkage leaks (§4d, smoke S1c). **T1 is
done** (`V2_ACTIVITY_AND_TIMELINE_CONTRACT.md`): the durable activity schema + the unified-timeline union
contract that the Outreach pillar (O1) must comply with (Link A). Next is **T2** (the `V2ActivityRecord`
migration — needs migration approval per AGENTS).

No provider send code is written before O2 exists and is tested. No live email leaves the system before O9.

### U-phase — UI surfaces mapped to the design pack (each page named with its backing read-model + gate)

The design pack defines 17 pages + drawers. Each is a UI session governed by §4e + §6b. The map below ties every
pack page to its route and the **real read-model/runtime that backs it** — so UI is wired to workflow, never mock.
`✅` backend exists (buildable now) · `⚠️` partial · `❌` backend missing (UI BLOCKED until its phase lands).

```txt
Pack page                         Route                         Backed by (upstream read / downstream action)        Build
LeadAssignment Workspace          /v2/leads                     queryLeadWorkspace / workflow update + rescore        ✅ (exists; align to mockup 06)
LeadAssignment Detail Drawer      /v2/leads (drawer)            latest assessment + queryLeadTimeline + buildScoreExplanation  ✅ (exists; mockup 08)
Lead Upload + Multi-ICP Scoring   /v2/uploads, /v2/ingestion    ingestion route + run-control (auto-drain) + ICP select  ✅ (exists; mockup 07; Stepper ❌)
Ingestion Job / Row Inspector     /v2/ingestion/[jobId]         progress route + per-row pipeline state                ✅ (exists; mockup 09; deepen inspector)
Companies Review Workspace        /v2/companies                 company read-model (company intelligence, cross-ICP)   ⚠️ (company drawer must not imply company-level scoring)
Contacts Workspace                /v2/contacts                  contact read-model                                     ❌ route missing
Manager Review Queue              /v2/reviews                   queryManagerReview + resolveReviewItem (M1)            ✅ (exists; mockup 16)
Feedback / Learning Loop          /v2/feedback                  queryFeedbackLog + createFeedbackExample (M3)         ✅ (exists; mockup 17)
ICP Library / Version Builder     /v2/icp-library               queryIcpLibrary + authoring (clone/upgrade/publish)   ✅ (exists; mockup 04)
Accounts / Projects               /v2/accounts, /v2/projects    product-tree read-models                               ✅/⚠️ (exist; align to mockups 02/03)
Home / Executive Workspace        /v2/home                      aggregate read-models (funnel, next actions)           ❌ route missing (aggregations partly exist)
Activity Recaps                   /v2/activity-recaps           ACTIVITY_APPLY + queryActivityRecapStats (T5)         ✅ (exists)
Outreach Hub / Sequences / Suppression / Senders  /v2/outreach* sender pool + suppression gate + SMTP + sequences     ❌ GATED behind O1-O9 (no send UI before O2 suppression gate)
AI Settings / Usage Health        /v2/settings/ai               AI advisory runtime (R-AI, optional)                   ❌ optional
Audit Trail / Data Log            /v2/audit                     V2AuditEvent read-model                                ⚠️ (audit exists; surface missing)
```

Sequencing: align the **existing** workspaces to the mockups first (leads cockpit, drawer, ingestion inspector,
reviews, feedback, icp-library) — backend `✅`, so they link cleanly. Build `❌`-route pages (home, contacts,
audit) only when their read-model is ready. **Outreach UI is hard-gated behind O1-O9** (Invariant 10).

**UI build progress + the detailed per-session plan live in `docs/v2/plan/V2_UI_IMPLEMENTATION_PLAN.md`.** Done so
far: U0 design system (`.v2-theme` palette + Tabs/ScoreRing/EvidenceCard), five new R-pillar routes
(/v2/home, /v2/settings, /v2/jobs+retry/cancel, /v2/contacts, /v2/reports), a premium tabbed LeadDrawer with a
working Re-score button + Next Best Action, table ScoreRing, and a cleaned SideNav. Next: U4 export-from-leads
(one-click CSV), U5 companies cross-ICP scoring drawer, U6 contacts drawer, U7 polish remaining pages — so an SDR
walks the full workflow (load → score → LeadAssignment → export → outreach), each step a real action.

## 6. Session Specs

Each session is **one change-kind**. Each carries a WORKFLOW LINKAGE block (Invariant 12, linkage contract).
Verification uses commands that actually exist in this repo: smoke scripts run as `node scripts/check-v2-*.mjs`
(there are **no** `npm run check:v2:*` aliases); schema uses `npx prisma validate|generate|migrate`.

### 6b. UI Session Protocol (tighter — for every UI coding session)

A UI session is the easiest place to ship something that *looks* done but isn't linked. This protocol makes UI
sessions as disciplined as backend ones. It is mandatory for any session touching `app/v2/**`, `components/v2/**`,
or `components/shared/**`.

1. **Name the mockup.** State the exact slice in `docs/v2/plan/design/mockups/**` this surface implements. The
   mockup is the contract (§1): match layout rhythm, density, tables, drawers — not a generic dashboard.
2. **Plan-only first, then STOP for approval** (the pack's entry-prompt rule). Before editing, produce: (a)
   existing UI file inventory, (b) missing component inventory (vs the §4e registry), (c) route/drawer plan, (d)
   component-reuse plan (which §4e primitives), (e) exact files to edit, (f) visual risks where pixel-match may
   not be possible, (g) verification checklist. Do not code until approved.
3. **Fill the §4e UI↔workflow linkage block** — UPSTREAM read-model, DOWNSTREAM action, PRODUCT STATES, BACKED-BY.
   If BACKED-BY is `❌`, the surface is blocked; do not ship mock-as-truth (Invariant 7).
4. **Reuse the kit** (§4e). No new shell/table/drawer/badge outside the registry; a genuinely new primitive is
   added to `components/shared` and registered in §4e.
5. **Honor the product non-negotiables** (pack §1): LeadAssignment is the scoring unit (never company-level
   scoring on lead surfaces); qualification ≠ workflowStatus (render separately); NOT_SCORED is derived UI state
   only; **no `UNCERTAIN` anywhere**; outreach shows the suppression gate before any send; AI is advisory-only and
   never overwrites qualification.
6. **One route or one drawer per session.** Do not rebuild five pages at once; do not mix backend + UI.
7. **Verify:** `npm run lint && npm run typecheck && npm run build`; run the relevant `check-v2-*` smoke; walk the
   pack's Visual QA checklist (§10 of the pack) for the surface; add/extend the S-UI guard (§7) where it applies.

Exit: the implemented surface visually resembles its mockup (layout/density/drawers), renders real read-model
data (or a clearly-labelled placeholder for an unbuilt backend), every control triggers a real action, and no
forbidden state (`UNCERTAIN`, company-level scoring, send-without-gate) appears.

---

### Z1 — Repair V2 Smoke Gates

Change-kind: scripts/tests only · Workflow stage: build trust before feature work

WORKFLOW LINKAGE
- Upstream: existing V2 smoke scripts · Created/updated: trustworthy smoke scripts · Downstream: every later session's verification
- Idempotency: n/a · Tenant: assertions must keep tenant checks · Proof (visible): n/a (scripts) · Proof (auto): scripts pass on current truth · Rollback: revert scripts

Allowed files: `scripts/check-v2-crm-read-model.mjs`, `scripts/check-v2-ui-visibility-demo.mjs`, `docs/v2/codex/SESSION_LOG.md`

Logic:
1. Fix custom-loader / `import.meta` failures so the scripts run.
2. Update visibility smoke to current product truth (4 qualification states present, no `UNCERTAIN`).
3. Remove stale assumptions that block planned work; keep the real guards (no V1 business import, no canonical `UNCERTAIN`, tenant/context visible, no permanent demo rows as source of truth).

Must not change: runtime, schema, migrations, UI pages, package **dependencies** (adding a `scripts` entry is allowed and encouraged — wire `node scripts/check-v2-*.mjs` so future verify is one command).

Verification: `npm run build`; `node scripts/check-v2-crm-read-model.mjs`; `node scripts/check-v2-ui-visibility-demo.mjs`; `git diff --check`

Exit proof: both scripts pass for current repo truth; any remaining failure is a real product issue, not stale guard text.

---

### U0 — V2 Product Shell + Design System (mock parity foundation)

Change-kind: UI components only · Workflow stage: product shell foundation (makes every later page look like one product)

WORKFLOW LINKAGE
- Upstream: existing `AppShell`/`ContextBar`/`PageHeader`, `components/shared/*`, the UI mock (`lib/v2/UI mock/V2_full_mock.png`) · Created/updated: shared shell + layout primitives + canonical status rendering · Downstream: every UI session (Z2, T5, M1, M3, O4-O8, R1-R5) builds on these — this is what delivers **mock visual parity**
- Idempotency: n/a · Tenant: shell never fetches/owns data · Proof (visible): current V2 pages share one visual system matching the mock's shell · Proof (auto): lint/typecheck/build; a check confirms pages use the shared shell, not isolated wrappers

Allowed files: `components/shared/*`, `components/v2/*`, `app/v2/*` page scaffolds only if needed, `docs/v2/codex/SESSION_LOG.md`

Logic:
1. Derive the shell from the actual mock image: left nav + top search/actions + context area + page body; the body supports the four layouts the mock uses (full workspace, filter-rail + table, table + right detail drawer, command-center grid).
2. Provide reusable primitives: `V2PageShell`, `V2PageHeader`, `V2StatStrip`, `V2FilterRail`, `V2DataTableFrame`, `V2DetailDrawerFrame`, `V2StatusBadge` (canonical tokens only — no `UNCERTAIN`), `V2EmptyState`, `V2LoadingState`.
3. Do not fetch data in shell components; no mock rows; no server logic changes.

Must not change: scoring, ingestion, identity, manager-review behavior, schema, API contracts.

Verification: `npm run lint && npm run typecheck && npm run build`; check that V2 pages consume the shared shell.

Exit proof: V2 pages share one visual system aligned to the mock; badges accept only canonical statuses; no page claims data the backend does not provide.

---

### Z2 — Lead Workspace Truth + Timeline Shell + Prove the Spine

Change-kind: UI + read model only · Workflow stage: prove load->qualify closes in browser

WORKFLOW LINKAGE
- Upstream: `queryLeadWorkspace`, latest `V2HardRuleAssessment`, `scoreExplanationHelpers` · Created/updated: lead why-drawer, empty lead-timeline panel (shell only) · Downstream: T5/M1/O4 fill the timeline; export reuses the filter
- Idempotency: read-only · Tenant: read model already org-scoped — keep it · Proof (visible): real browser upload -> `/v2/ingestion/[jobId]` progress -> `/v2/leads` shows the scored company + why-drawer evidence · Proof (auto): filter count == query count; no `UNCERTAIN` rendered · Rollback: UI-only revert

Allowed files: `app/v2/leads/*`, `components/v2/leads/*`, `components/shared/*` (status/why drawer), `lib/v2/crm/scoreExplanationHelpers.ts` (read-only helpers if needed), `docs/v2/codex/SESSION_LOG.md`

Logic:
1. Rows are `V2LeadAssignment`; qualification from latest assessment; `workflowStatus` rendered separately; `NOT_SCORED` derived.
2. Why-drawer shows the evidence + fact-token hits used by the latest assessment (from the assessment snapshot, not re-scraped).
3. Add an empty **Lead Timeline** panel placeholder in the drawer (shell only; populated in T4/T5).
4. Do not fetch in shell components; no mock rows.

Must not change: scoring, ingestion, identity, schema, API contracts.

Verification: `npm run lint && npm run typecheck && npm run build`; manual browser upload->score; `node scripts/check-v2-crm-read-model.mjs`

Exit proof: a CSV uploaded in the browser becomes a scored lead with visible evidence; no `UNCERTAIN`; filter count equals query count.

---

### T1 — Activity Schema Plan + Unified Timeline Contract

Change-kind: docs only · Workflow stage: tracking architecture (governs T2 + O1)

WORKFLOW LINKAGE
- Upstream: `lib/v2/activity-recaps/*`, identity resolver, `V2LeadAssignment` · Created/updated: `docs/v2/plan/V2_ACTIVITY_AND_TIMELINE_CONTRACT.md` · Downstream: T2 migration, T3 runtime, O1 outreach schema (must comply), T4 read model
- Proof (auto): contract approved before any migration

Create: `docs/v2/plan/V2_ACTIVITY_AND_TIMELINE_CONTRACT.md`

Must include:
1. `V2ActivityRecord` fields: `organizationId`, `leadAssignmentId` (FK), `companyId`, `contactId?`, `actorUserId?`, `channel`, `outcome`, `occurredAt`, `eventKind`, `sourceActivityHash` (unique per org), `sourceUploadId?`/`sourceRowId?`, `metadataJson`.
2. Indexes + tenant isolation + idempotency key (`sourceActivityHash`).
3. **Unified timeline contract (Link A):** the exact common fields (`leadAssignmentId`, `occurredAt`, `eventKind`, `channel`) that BOTH `V2ActivityRecord` and the future `V2OutreachActivity` must expose so `queryLeadTimeline` can union them.
4. Timezone policy (tenant tz for `occurredAt` normalization).
5. Manager-review integration for fuzzy rows.

Exit proof: schema + timeline contract approved before T2 migration; O1 is bound to it.

---

### T2 — V2ActivityRecord Migration

Change-kind: approved Prisma migration · Workflow stage: durable activity storage

WORKFLOW LINKAGE
- Upstream: T1 contract · Created/updated: `V2ActivityRecord` table + indexes · Downstream: T3 writes it, T4 reads it
- Idempotency: `sourceActivityHash` unique(org) · Tenant: org-scoped indexes · Proof (auto): prisma validate/generate + FK/index smoke · Rollback: down migration documented

Logic:
1. Add `V2ActivityRecord` per T1 only after approval; `leadAssignmentId` FK; `sourceActivityHash` unique per org.
2. No cascade delete from core records; respect `deletedAt` if present.
3. Add a migration drift guard + a `scripts/check-v2-activity-record-fks.mjs` smoke for FKs/indexes.

Verification: `npx prisma validate`; `npx prisma generate`; `npx prisma migrate dev --name v2_activity_record`; `node scripts/check-v2-activity-record-fks.mjs`

Exit proof: validate/generate pass; migration replay documented; FK/index smoke passes.

---

### T3 — ACTIVITY_APPLY Runtime

Change-kind: runtime + tests · Workflow stage: activity ingestion

WORKFLOW LINKAGE
- Upstream: recap normalized rows (`normalizeActivityRow`), `resolveIdentity` (SHARED — no second resolver), `V2LeadAssignment`, review producer · Created/updated: `V2ActivityRecord` rows, review items for fuzzy rows · Downstream: T4 timeline, SDR metrics (R-phase)
- Idempotency: `sourceActivityHash` · Tenant: org from job context · Proof (auto): duplicate recap creates 0 dup activity; fuzzy -> review; tz tested · Rollback: handler is insert-only + idempotent

Allowed files: `lib/v2/activity-recaps/*`, `lib/v2/jobs/handlers.ts` (wire `ACTIVITY_APPLY`), `scripts/check-v2-activity-apply.mjs`, `docs/v2/codex/SESSION_LOG.md`

Logic:
1. Replace the `ACTIVITY_APPLY` stub with a real handler.
2. Normalize `occurredAt` using tenant timezone (Invariant 11/timezone).
3. Resolve company/contact/lead-assignment via the shared resolver: `exact` -> create activity; `candidate`/`conflict` -> `createReviewItem`.
4. `sourceActivityHash` prevents duplicate recap rows (Invariant 6).

Verification: `npm run typecheck && npm run build`; `node scripts/check-v2-activity-apply.mjs`; `npm run test`

Exit proof: duplicate recap safe; fuzzy row reviewed; `occurredAt` tz tested; activity attaches to a `V2LeadAssignment`.

---

### T4 — queryLeadTimeline Read Model

Change-kind: read model + tests · Workflow stage: timeline assembly (Link A)

WORKFLOW LINKAGE
- Upstream: `V2ActivityRecord`, `V2AuditEvent`, `V2ManagerReviewItem` · Created/updated: `lib/v2/crm/queryLeadTimeline.ts` · Downstream: lead drawer (Z2 shell), `/v2/activity-recaps`, later outreach events (O4+)
- Idempotency: read-only · Tenant: org-scoped, filters `deletedAt IS NULL` · Proof (auto): timeline rows == union of sources for a lead · Rollback: read-only

Allowed files: `lib/v2/crm/queryLeadTimeline.ts`, `lib/v2/crm/types.ts`, `lib/v2/crm/index.ts`, `scripts/check-v2-lead-timeline.mjs`

Logic:
1. Union activity + audit + review into one stream keyed by `leadAssignmentId`, ordered by `occurredAt`.
2. Shape so `V2OutreachActivity` (O1) slots in later without changing the read contract.
3. Tenant-scoped; respects soft-delete.

Verification: `npm run typecheck`; `node scripts/check-v2-lead-timeline.mjs`

Exit proof: a lead's timeline equals the union of its source records; outreach slot reserved.

---

### T5 — Activity Recaps UI + Lead-Drawer Timeline

Change-kind: UI (+ existing apply endpoint) · Workflow stage: SDR activity upload (SEE-IT)

WORKFLOW LINKAGE
- Upstream: `ACTIVITY_APPLY` (T3), `queryLeadTimeline` (T4), shared resolver · Created/updated: `/v2/activity-recaps` page, populated timeline panel in lead drawer · Downstream: SDR workspace/reports (R)
- Idempotency: apply is hash-idempotent · Tenant: page reads org context · Proof (visible): browser recap upload creates real activity that appears on the lead's timeline · Proof (auto): ambiguous rows appear in review queue

Allowed files: `app/v2/activity-recaps/*`, `components/v2/activity/*`, `components/v2/leads/*` (timeline panel), `app/v2/activity-recaps/apply/route.ts` (if a new route is needed), `docs/v2/codex/SESSION_LOG.md`

Logic:
1. Upload/paste -> map -> **preview normalized rows** -> apply via T3 runtime.
2. Apply creates `V2ActivityRecord`; no fake summary counts.
3. Ambiguous rows show review flags linking to `/v2/reviews`.
4. Lead drawer timeline panel now renders `queryLeadTimeline`.

Verification: `npm run lint && npm run typecheck && npm run build`; browser SEE-IT; `node scripts/check-v2-lead-timeline.mjs`

Exit proof: browser upload creates real activity records visible on the lead timeline; ambiguous rows are review-visible.

---

### M1 — Manager Review Resolution Route + UI

Change-kind: route + UI (runtime exists) · Workflow stage: human correction (SEE-IT)

WORKFLOW LINKAGE
- Upstream: `resolveReviewItem` + lifecycle helpers (✅), `createReviewItem` producers, `sourceFingerprint` · Created/updated: `/v2/reviews` resolution route + interactive UI, audit events · Downstream: corrected `V2LeadAssignment`/identity, M2 rescore, M3 feedback
- Idempotency: resolve by item id; duplicate resolve = no-op success · Tenant: `manager_review.decide` permission · Proof (visible): one active item -> resolve -> zero active items · Proof (auto): duplicate resolve does not duplicate updates; audit exists

Allowed files: `app/v2/reviews/*`, `app/v2/reviews/[reviewItemId]/resolve/route.ts`, `components/v2/reviews/*`, `lib/v2/manager-review/index.ts` (export only), `docs/v2/codex/SESSION_LOG.md`

Logic:
1. Expose existing resolution helpers via a tenant-scoped route (approve match / reject / link existing / create new / request info / convert-to-feedback).
2. Resolution updates only the linked object per resolution type; never mutates old assessments (Invariant 4).
3. Resolved item leaves the active queue; every resolution writes an audit event.

Verification: `npm run lint && npm run typecheck && npm run build`; `node scripts/check-v2-manager-review-runtime.mjs`; browser SEE-IT

Exit proof: active item resolves to zero; duplicate resolve safe; audit event exists; old assessment unchanged.

---

### M2 — Review -> Rescore Bridge (Link C)

Change-kind: runtime / job linkage · Workflow stage: correction -> score freshness

WORKFLOW LINKAGE
- Upstream: review resolution (M1), `V2LeadAssignment`, latest assessment, `enqueueScoringJobs` (✅) · Created/updated: optional `ICP_SCORE` job + rescore reason metadata · Downstream: new immutable assessment, lead workspace
- Idempotency: score job keyed by org+leadAssignment+icpVersion+input/rules fingerprint · Tenant: from resolution context · Proof (auto): identity correction enqueues rescore; non-scoring note does not; duplicate resolution does not double-enqueue

Allowed files: `lib/v2/manager-review/resolveReviewItem.ts` (add bridge), `lib/v2/scoring/runtime/enqueueScoringJobs.ts` (reuse), `scripts/check-v2-review-rescore-bridge.mjs`

Logic:
1. After resolution, detect whether the correction changes scoring input (identity/company/contact link).
2. If yes, enqueue an idempotent `ICP_SCORE`; if no, do nothing.
3. Old assessment remains immutable; rescore inserts a new one + moves the latest pointer transactionally.

Verification: `npm run typecheck`; `node scripts/check-v2-review-rescore-bridge.mjs`

Exit proof: identity correction enqueues exactly one rescore; note-only change enqueues none; reruns do not duplicate jobs.

---

### M3 — Feedback Capture + /v2/feedback (Link C)

Change-kind: runtime + UI · Workflow stage: human learning signal

WORKFLOW LINKAGE
- Upstream: `V2LeadAssignment`, latest `V2HardRuleAssessment`, optional review item · Created/updated: `V2FeedbackExample` rows, `/v2/feedback` log, feedback form in lead drawer · Downstream: R5 ICP authoring signal panel
- Idempotency: explicit policy (allow distinct author/time examples; block exact duplicate by fingerprint) · Tenant: `feedback.write` · Proof (auto): feedback insert succeeds; old assessment + rulesJson unchanged

Allowed files: `lib/v2/feedback/*` (new), `app/v2/feedback/*`, `app/v2/feedback/route.ts`, `components/v2/feedback/*`, `docs/v2/codex/SESSION_LOG.md`

Logic:
1. Feedback links to lead assignment + immutable assessment snapshot.
2. Feedback never mutates rules or assessment (Invariant 4).
3. `approvedForLearning` controls tuning eligibility; `datasetSplit` recorded.

Verification: `npm run lint && npm run typecheck && npm run build`; `node scripts/check-v2-feedback-capture.mjs`

Exit proof: feedback row created; old assessment unchanged; ICP rules unchanged.

---

### M4 — Export Source Of Truth

Change-kind: runtime + route · Workflow stage: CRM output

WORKFLOW LINKAGE
- Upstream: filtered `queryLeadWorkspace` query, latest assessment, feedback/review overlay, context filters · Created/updated: `EXPORT_GENERATE` job + download route + export audit metadata · Downstream: operator download, reports
- Idempotency: export job keyed by org+filter-hash+request id · Tenant: `reports.read`/export perm · Proof (auto): export row count == filtered CRM count; rerun-safe

Allowed files: `lib/v2/jobs/handlers.ts` (wire `EXPORT_GENERATE`), `lib/v2/crm/*` (reuse filter contract — no new query), `app/v2/exports/[exportId]/route.ts`, `scripts/check-v2-export-truth.mjs`

Logic:
1. Export query **reuses the CRM filter contract** (`queryLeadWorkspace`) — no parallel query.
2. Includes assessment snapshot identity; human override/feedback overlay explicit.
3. No global company export (Invariant 2).

Verification: `npm run typecheck && npm run build`; `node scripts/check-v2-export-truth.mjs`

Exit proof: export count equals lead workspace count for the same filters; rerun-safe.

---

### O1 — Outreach Schema (timeline-contract compliant — Link A)

Change-kind: approved Prisma migration · Workflow stage: outreach foundation (no send behavior)

WORKFLOW LINKAGE
- Upstream: `V2LeadAssignment`/contact, `V2SuppressionEntry`, T1 timeline contract · Created/updated: `V2SenderAccount` (pool), `V2Sequence`, `V2SequenceStep`, `V2OutreachMessage`, `V2OutreachActivity`, `V2InboundMailEvent` · Downstream: O2-O8 runtime
- Idempotency: enrollment + message + inbound-event unique keys · Tenant: org-scoped · Proof (auto): migration replay; no V1 refs; no send behavior added

Logic:
1. All outreach rows attach to `V2LeadAssignment`/`V2Contact`, never global company (Invariant 2).
2. **`V2SenderAccount` is a pool for scale, with two kinds:** `kind` (`RELAY`|`MAILBOX`); SMTP host/port + encrypted creds ref; IMAP host/port + encrypted creds ref (per mailbox; relay = return-path mailbox); per-sender rate caps (per-min/hour/day); **warmup fields** (`warmupStage`, `currentDailyCap`, `targetDailyCap`, `warmupStartedAt`); health/reputation (`bounceRate`, `complaintRate`, `status`); `lastSendAt`. Multiple senders per org.
3. **`V2OutreachMessage` stores the outbound `Message-ID`** (`providerMessageId`) + `inReplyToId` so O7 can correlate inbound mail; status (queued/sent/bounced/replied); `senderAccountId`.
4. `V2OutreachActivity` **exposes the Link A common fields** (`leadAssignmentId`, `occurredAt`, `eventKind`, `channel`) so `queryLeadTimeline` unions it.
5. **`V2InboundMailEvent`** (replaces the webhook-event idea): IMAP `mailboxUid` + `Message-ID` unique per sender (idempotency); `eventKind` (reply/bounce-DSN); `correlatedMessageId`.
6. Credentials are **encrypted references only** (Invariant 9); no plaintext keys; no provider call; no send handler.
7. `V2SequenceStep` carries a `runAt`/delay so the scheduler (O5s) fires it.
8. **Scale indexes:** suppression hot-path index (org+email, org+domain); `V2OutreachMessage(providerMessageId)`; `V2InboundMailEvent(senderAccountId, mailboxUid)`.

Verification: `npx prisma validate`; `npx prisma generate`; `npx prisma migrate dev --name v2_outreach_core`; `node scripts/check-v2-outreach-schema.mjs`

Exit proof: migration replay passes; no V1 refs; no send behavior; sender pool + Message-ID correlation + timeline union fields + hot-path indexes all present.

---

### O2 — Suppression Gate (Link B) — before any send

Change-kind: runtime + tests · Workflow stage: send safety

WORKFLOW LINKAGE
- Upstream: `V2SuppressionEntry`, normalized email/domain · Created/updated: `assertNotSuppressed`, `SuppressedError`, redacted block audit, gate-enforcement test helper · Downstream: O4 manual send, O5 sequence steps
- Idempotency: pure check · Tenant: org-scoped suppression · Proof (auto): suppressed identifier blocks; a send handler wired without the gate fails the test

Allowed files: `lib/v2/outreach/suppression/*` (new), `lib/v2/outreach/index.ts`, `scripts/check-v2-suppression-gate.mjs`

Logic:
1. Normalize email + domain (NFC/diacritics per Invariant 11 where relevant).
2. Check exact email, domain, and org-level suppression.
3. Throw **before** the provider call; log a redacted block event (Invariant 9/10).
4. Provide a test asserting any send path without the gate fails.

Verification: `npm run typecheck`; `node scripts/check-v2-suppression-gate.mjs`; `npm run test`

Exit proof: suppressed identifier blocks; provider abstraction cannot send without the gate.

---

### O3 — SMTP Provider Abstraction (interface + sandbox + SMTP adapter + creds + pool)

Change-kind: runtime only, no live send yet · Workflow stage: safe send boundary

WORKFLOW LINKAGE
- Upstream: `V2SenderAccount` pool, encrypted credentials, suppression gate (O2) · Created/updated: `ProviderInterface`, sandbox provider, **SMTP adapter** (live-capable, disabled by default), credential loader, sender-pool selector + rate limiter, redacted logging · Downstream: O4/O5 send
- Tenant: per-org sender accounts · Proof (auto): sandbox send works only after the gate; missing/disabled sender fails safely; rate cap blocks over-limit send; logs redacted

Allowed files: `lib/v2/outreach/providers/*` (new), `lib/v2/outreach/credentials/*`, `lib/v2/outreach/senderPool/*`, `lib/v2/outreach/warmup/*`, `scripts/check-v2-provider-abstraction.mjs`, `scripts/check-v2-warmup.mjs`

Logic:
1. `ProviderInterface` with a sandbox provider AND a real **SMTP adapter** (TLS, nodemailer-style, **connection pooling/reuse per sender** for throughput) — live disabled by default behind an org/config flag (cutover is O9).
2. **Sender-pool selector** handles **both `RELAY` and `MAILBOX`** kinds; routes by campaign type + health + remaining cap (round-robin/LRU), where a sender's **effective daily cap = warmup-adjusted cap** (`min(currentDailyCap, targetDailyCap)`), not the raw ceiling. This is the core of the 100k/mo path.
3. **Warmup policy module** (`lib/v2/outreach/warmup/*`): a state machine that, given `warmupStage` + recent health, computes the allowed daily cap and the next ramp step; O5s advances it. A degraded mailbox is paused/rolled back, not used.
4. Credential loader decrypts at use, never logs secrets (Invariant 9).
5. The adapter **cannot** be invoked without passing through the O2 gate.

Must not: enable live SMTP yet; print secrets; bypass suppression; exceed per-sender (warmup-adjusted) caps.

Verification: `npm run typecheck`; `node scripts/check-v2-provider-abstraction.mjs`

Exit proof: sandbox send succeeds only after the gate; SMTP adapter present but inert until O9; selector handles RELAY + MAILBOX; over-(warmup-adjusted)-cap send blocked; degraded mailbox excluded; missing sender fails safely; logs redacted.

---

### O4 — Manual Send

Change-kind: runtime + UI · Workflow stage: first outbound (SEE-IT)

WORKFLOW LINKAGE
- Upstream: `V2LeadAssignment`, contact identifier, company brief, suppression gate, sender pool, `EMAIL_SEND` job, `ProviderInterface` · Created/updated: `V2OutreachMessage` (**stores outbound `Message-ID`**), `V2OutreachActivity` (-> timeline), optional `workflowStatus` update · Downstream: O7 IMAP correlation, O8 reporting, lead timeline (Link A)
- Idempotency: `EMAIL_SEND` keyed by org+message id · Tenant: `outreach.send` · Proof (visible): sandbox send creates an outreach event on the lead timeline · Proof (auto): suppressed lead blocked; duplicate job safe; sync SMTP 5xx -> bounce+suppression

Allowed files: `lib/v2/outreach/send/*`, `lib/v2/jobs/handlers.ts` (wire `EMAIL_SEND`), `app/v2/outreach/*`, `components/v2/outreach/*`, `docs/v2/codex/SESSION_LOG.md`

Logic:
1. Compose from lead/contact only; pick a sender from the pool; set threading headers and enqueue `EMAIL_SEND`.
2. Worker checks suppression (O2) **immediately before** the SMTP call (Invariant 10).
3. **Persist the outbound `Message-ID`** on `V2OutreachMessage` (so O7 can correlate replies/bounces).
4. Write message + outreach activity; a synchronous SMTP `5xx` is recorded as a bounce + creates suppression; failed send is visible + retry-safe.

Verification: `npm run lint && npm run typecheck && npm run build`; `node scripts/check-v2-suppression-gate.mjs`; browser SEE-IT (sandbox)

Exit proof: suppressed lead blocked; sandbox send creates an outreach activity on the timeline with a stored `Message-ID`; duplicate job safe.

---

### O5 — Sequences

Change-kind: runtime + UI · Workflow stage: automated outreach

WORKFLOW LINKAGE
- Upstream: `V2Sequence`/`V2SequenceStep`, lead/contact, suppression gate · Created/updated: enrollment, `SEQUENCE_STEP_EXECUTE` handler, per-step outreach activity · Downstream: O5s scheduler, O7 IMAP inbound, O8 reporting
- Idempotency: enrollment by lead/contact/sequence; step by enrollment+step · Tenant: `outreach.send` · Proof (auto): duplicate step execution safe; bounce/reply/meeting halts future steps

Allowed files: `lib/v2/outreach/sequences/*`, `lib/v2/jobs/handlers.ts` (wire `SEQUENCE_STEP_EXECUTE`), `app/v2/outreach/*`, `scripts/check-v2-sequences.mjs`

Logic:
1. Enrollment idempotent by lead/contact/sequence.
2. **Sender stickiness:** an enrollment binds to ONE sender account; all steps + the reply thread use it, so replies land in that mailbox's IMAP and O7 correlation/threading stays coherent. If that sender goes unhealthy, hand off explicitly (don't silently split a thread across mailboxes).
3. Each step is job-backed with a `runAt`; each step checks suppression immediately before the provider call.
4. Bounce/reply/meeting halts future steps.

Verification: `npm run typecheck && npm run build`; `node scripts/check-v2-sequences.mjs`

Exit proof: duplicate step execution safe; bounce halts future steps; each step passes the gate.

---

### O5s — Background Scheduler / Worker + IMAP Poller (Link D, 100k/mo)

Change-kind: infra/runtime · Workflow stage: automated execution driver

WORKFLOW LINKAGE
- Upstream: `V2Job` queue (incl. `SEQUENCE_STEP_EXECUTE` with `runAt`), `claimNextJob`/`processJob` (✅), `V2SenderAccount` pool, IMAP mailboxes · Created/updated: a worker/cron that (a) drains due send jobs unattended and (b) polls IMAP for inbound mail · Downstream: sequences advance; O7 consumes inbound events; reporting
- Idempotency: reuses claim/process idempotency; IMAP UID high-water mark · Tenant: per-job org context · Proof (auto): a past-due step executes; IMAP poll ingests new mail once (no reprocess); throughput sustains target rate

Allowed files: `scripts/v2-job-worker.mjs` (new), `scripts/v2-imap-poller.mjs` (new), deployment cron config (documented), `package.json` (add `v2:worker`, `v2:imap` scripts), `docs/v2/codex/SESSION_LOG.md`

Logic:
1. Send worker: loop/cron calling `claimNextJob` -> `processJob` for due jobs, **bounded concurrency** sized to the 100k/mo target, respecting locks/retry/stale handling already in the job runtime and per-sender (warmup-adjusted) caps.
2. Honors `runAt`/delay so delayed sequence steps fire on time.
3. **Daily warmup tick:** advance each `MAILBOX` `currentDailyCap` toward `targetDailyCap` per the warmup policy (O3) when health is good; **pause/roll back** when bounce/complaint thresholds are exceeded.
4. **IMAP poller:** for **every mailbox + each relay return-path**, fetch new messages since the stored UID high-water mark, hand them to O7 correlation, advance the watermark (idempotent — no reprocessing).
5. Safe alongside route-driven draining (no double execution — relies on claim locking).

Verification: `npm run typecheck`; run the worker against a seeded delayed job + seeded inbound mail; `node scripts/check-v2-job-runtime.mjs`; `node scripts/check-v2-warmup.mjs`

Exit proof: a past-due sequence step executes unattended; IMAP poll ingests inbound mail exactly once; warmup cap advances on healthy days and rolls back on bad health; no double execution; stale jobs handled.

---

### O6 — Call / LinkedIn Activities

Change-kind: UI/runtime · Workflow stage: non-email outreach

WORKFLOW LINKAGE
- Upstream: lead/contact, shared identity resolver · Created/updated: call log + LinkedIn task as `V2OutreachActivity`/`V2ActivityRecord` on the timeline · Downstream: timeline (Link A), reports
- Proof (auto): a logged call appears on the lead timeline; LinkedIn import uses the shared resolver (no second resolver)

Allowed files: `lib/v2/outreach/*`, `app/v2/outreach/*`, `components/v2/outreach/*`

Logic:
1. Non-email actions write timeline events (no provider send risk).
2. LinkedIn identifier import goes through the shared resolver (Invariant / linkage contract).

Verification: `npm run typecheck && npm run build`; `node scripts/check-v2-lead-timeline.mjs`

Exit proof: logged call on timeline; LinkedIn import uses the identity resolver.

---

### O7 — IMAP Inbound: Reply + Bounce Correlation

Change-kind: runtime + security tests · Workflow stage: inbound event ingestion (replaces signed webhooks)

WORKFLOW LINKAGE
- Upstream: IMAP messages fetched by the poller (O5s), stored outbound `Message-ID` (O4), `V2OutreachMessage` · Created/updated: `V2InboundMailEvent` (idempotent), suppression on hard bounce, `V2OutreachActivity` (reply -> timeline), workflow update · Downstream: suppression gate (Link B), workflowStatus, O8 reporting
- Idempotency: `(senderAccountId, mailboxUid)` + `Message-ID` · Tenant: resolved from the sender account/mailbox · Proof (auto): un-correlatable mail ignored; replay ignored; hard-bounce DSN suppresses future sends

Allowed files: `lib/v2/outreach/inbound/*`, `lib/v2/outreach/inbound/parseDsn.ts`, `scripts/check-v2-imap-inbound.mjs`

Logic:
1. **Correlation = trust (Invariant 9 intent).** Match inbound `In-Reply-To`/`References` (reply) or DSN original-recipient/`Message-ID` (bounce) to an outbound message we actually sent. **Un-correlatable mail is ignored** (the SMTP/IMAP equivalent of rejecting an unsigned webhook).
2. Idempotent by IMAP UID + `Message-ID`; replay ignored.
3. **Hard-bounce DSN** (`multipart/report; report-type=delivery-status`, 5.x.x status) -> create `V2SuppressionEntry` + halt sequences (Link B). Soft bounce -> retry/backoff policy, no permanent suppression.
4. Reply -> write `V2OutreachActivity` (on the timeline) + halt sequence + update workflow if configured.

Verification: `npm run typecheck`; `node scripts/check-v2-imap-inbound.mjs` (fixtures: reply, hard-bounce DSN, soft bounce, spoofed/un-correlatable mail); `npm run test`

Exit proof: un-correlatable mail ignored; replay ignored; hard-bounce DSN suppresses future sends; reply lands on the lead timeline.

---

### O8 — Outreach Reporting

Change-kind: read model + UI · Workflow stage: management reporting

WORKFLOW LINKAGE
- Upstream: `V2OutreachMessage`/`V2OutreachActivity`/`V2InboundMailEvent`/`V2SuppressionEntry`/`V2LeadAssignment`/`V2SenderAccount` · Created/updated: outreach report read models + UI · Downstream: operators/managers
- Tenant: org-scoped · Proof (auto): counts match source records; no PII beyond authorized view

Allowed files: `lib/v2/outreach/reporting/*`, `app/v2/reports/*`, `components/v2/reports/*`

Logic:
1. Tenant-scoped: delivery / bounce / reply / meeting-conversion / sequence-performance / suppression-block / **per-sender health + send volume vs cap** metrics.
2. **Open/click are deferred** under SMTP/IMAP (no native tracking). Either hide those mock widgets or, if required, add a separate tracking-pixel/link-rewrite session first; do not show fake open rates.

Verification: `npm run typecheck && npm run build`; `node scripts/check-v2-outreach-reporting.mjs`

Exit proof: tenant-scoped; counts match source; per-sender volume visible; no fabricated open metrics; no PII leak.

---

### O9 — Live-Send Cutover + Deliverability (gated, 100k/mo)

Change-kind: runtime + ops, explicit approval · Workflow stage: go live at volume

WORKFLOW LINKAGE
- Upstream: O2 gate, O3 SMTP adapter + sender pool, verified sender domains, encrypted creds · Created/updated: live-send flag flip + per-sender/org rate-daily caps + warmup ramp + kill switch + deliverability config · Downstream: real SMTP sends at scale
- Tenant: per-org enablement · Proof (auto): live send only with verified domain + flag + passing gate + within caps; kill switch halts

Allowed files: `lib/v2/outreach/providers/*` (enable SMTP live), `lib/v2/outreach/limits/*`, `lib/v2/outreach/senderPool/*`, config, `scripts/check-v2-live-send-guards.mjs`

Logic:
1. Live sending requires: explicit org/config flag, suppression gate pass, within per-sender (warmup-adjusted) + org-wide caps, and **per-kind deliverability**:
   - `RELAY`: verified domain with **SPF + DKIM + DMARC** you control.
   - `MAILBOX` Workspace: custom-domain DKIM verified; plain `@gmail.com`: allowed but **capped low + flagged** (weak cold deliverability) — prefer for warm/reply traffic.
2. A `MAILBOX` only counts toward steady-state volume after it **passes a minimum warmup stage**; the pool spreads 100k/mo across healthy, warmed senders (relay carries bulk while mailboxes warm).
3. A kill switch immediately halts all live sends.
4. Real SMTP/IMAP credentials loaded from encrypted storage; never logged.

Must not: enable live send without per-kind auth (SPF/DKIM/DMARC or verified DKIM) + caps + kill switch; count un-warmed mailboxes as full capacity; exceed caps; print secrets.

Verification: `npm run typecheck`; `node scripts/check-v2-live-send-guards.mjs`; controlled live test to a verified internal address only

Exit proof: live send works under all guards for both RELAY + MAILBOX; per-kind auth verified; un-warmed mailboxes excluded from steady-state; pool + caps + warmup + kill switch enforced; no secret leakage.

---

### R-phase — Reporting, Operations, Hardening

Each is a normal UI/read-model session unless noted; all reuse existing scoped queries (no parallel truth).

- **R1 /v2/home** — context-scoped command center (lead counts, recent jobs, review queue, scoring/enrichment coverage, job health). Counts reuse existing read models; `NOT_SCORED` derived. SEE-IT: changing context changes counts.
- **R2 /v2/reports** — coverage/conversion across leads/activity/outreach; reuse scoped queries; export-consistent.
- **R3 /v2/jobs** — operations over `V2Job` (retry/cancel/inspect/stale/queue depth). SEE-IT: failed job inspectable; retry idempotent; cancel respects state.
- **R4 /v2/contacts** — contacts first-class, linked to `V2LeadAssignment`; generic email = weak evidence; mismatch -> review. SEE-IT: contact links to company + lead assignment.
- **R5 ICP authoring/publish (OCC) → now SC5** (see §4c.8). Managers create/clone/edit/diff/publish **schema-v2** ICP versions; published versions immutable; OCC publish; surfaces M3 feedback aggregates (closes Link C). SEE-IT: published version appears in context picker; stale publish rejected. Moved earlier (right after Z) because scoring correctness gates the product.
- **R6 rules-v2 + fact-token lock → replaced by SC1–SC4** (the multi-ICP scoring engine, §4c). The full multi-ICP rule schema (geo/industry/persona/size/disqualifiers/conditional/account-list/sub-ICP), per-dimension scorers, terminal gates, 4-state derivation, metrics/subScores, and the 18-ICP golden corpus live there — not an optional tail item.
- **R7 /v2/settings + AI/provider readiness** — read-only status for AI + SMTP/IMAP sender pool (enabled/disabled, sender health, missing-key warnings) **without printing secrets** (Invariant 9). SEE-IT: missing key renders a clear disabled state; no secret in source/logs.
- **R8 Account / Project / Offer hubs** — make the product tree operational: account/project health, offer→ICP coverage, lead rollups, review/enrichment/activity/outreach summaries; all reuse scoped queries (no parallel truth). SEE-IT: rollups match source; counts context/tenant-scoped.
- **R-AI AI insight runtime (advisory)** — *optional, only if the mock's AI panels are wanted*: populate `V2AiInsight` via `AI_INSIGHT_GENERATE` as **clearly-labelled advisory** (AGENTS.md: AI output is not production truth; benchmark scripts never call live providers). Never feeds qualification automatically.
- **H1 permission matrix** — audit/enforce `crm.read`, `workflow.update`, `score.enqueue`, `ingestion.apply`, `manager_review.decide`, `feedback.write`, `activity.write`, `outreach.send`, `outreach.admin`, `reports.read`; cross-tenant tests.
- **H2 scale tests** — large/concurrent uploads, bulk scoring/enrichment, large export, dashboard aggregates, recap duplicate load; **outreach at 100k/mo: sustained throughput across a mixed RELAY+MAILBOX pool, per-sender (warmup-adjusted) cap enforcement, warmup ramp simulation (cap grows over days, rolls back on degraded health), suppression hot-path latency at a large suppression list, IMAP poll across many mailboxes + relay return-paths, queue depth under burst**; record baselines + index gaps.
- **H3 security pass** — tenant isolation, secret redaction (SMTP/IMAP creds encrypted, never logged), suppression gate, inbound correlation trust (O7), PII export, audit coverage, V1 runtime leakage grep.
- **H4 data retention** — policy for raw uploads, job payloads, research snapshots, activity, email events, audit logs, soft-deleted records; runtime only after approval.

## 7. Workflow Smoke Matrix (end-to-end linkage proofs)

These stop isolated-session drift; each must pass as its stage lands.

```txt
S1 upload_to_scored_lead:    CSV -> V2IngestionJob -> Row -> identity -> V2LeadAssignment -> enrichment -> V2HardRuleAssessment -> /v2/leads row -> company evidence
   asserts: one active assignment per scope; lead links to ingestion row; evidence exists; no global company qualification.

S1b rules_v2_reachable_to_drawer:  ICP authoring upgradeSourceRulesToV2 (v1 -> valid v2) -> assessIcpRulesV2 -> REAL mapRulesV2AssessmentToPersistence shape -> buildLeadScoreExplanation kind "rules-v2"; a non-v2 assessment -> kind "legacy".
   asserts: a human path PRODUCES a schema-v2 ICP (Upgrade-to-rules-v2 button); a v2-scored lead renders the rules-v2 drawer (per-dimension subScores + terminal gates); the v1/v2 dispatch is real, not always-on. GUARD: `node scripts/check-v2-rules-v2-reachability.mjs` (prevents "engine built but unreachable" leakage — the SC1-SC6 gap).

S1c pipeline_chain_drainable:  enqueue source binding (score job MANUAL by default, INGESTION_JOB when bound) + enrichment binds to ingestion job + handler forwards binding to scoring + run-until-idle drains the COMPANY_ENRICHMENT + ICP_SCORE tail + search provider env-gated with stub fallback.
   asserts: every pipeline stage is enqueued in a scope the run control can claim, so the chain (parse->...->enrichment->scoring) never silently stalls. GUARD: `node scripts/check-v2-pipeline-linkage.mjs` (see §4d; prevents the "enrichment stuck QUEUED, leads unscored" leak — extend it for CRM/outreach pipelines).

S1d default_v2:  every demo preset (the "Create from preset" source) carries schema-v2 rules.
   asserts: a freshly created ICP defaults to schema-v2, so its leads score through the rules-v2 engine + show the rules-v2 drawer; v1 is kept ONLY as read-compat for pre-existing assessments. GUARD: `node scripts/check-v2-default-v2-presets.mjs` (stops a silent regression to a v1 default — the half-migrated state that hid the rules-v2 engine behind v1-only ICPs).

S2 ambiguous_upload_to_review:  ambiguous row -> candidate -> V2ManagerReviewItem -> resolve/link -> assignment update -> optional rescore (M2)
   asserts: one active review item by fingerprint; rerun no dup; resolution audited; old assessment immutable.

S3 score_correction_to_feedback:  score -> correction -> V2FeedbackExample -> ICP tuning signal (R5)
   asserts: old assessment + rulesJson unchanged; feedback linked to assessment; aggregate readable.

S4 activity_recap_to_timeline:  recap -> normalize -> shared resolver -> V2ActivityRecord -> queryLeadTimeline -> SDR metrics
   asserts: duplicate recap safe; fuzzy -> review; tenant tz correct; timeline == source records.

S5 lead_to_outreach:  lead/contact -> compose -> suppression gate -> SMTP send -> V2OutreachMessage(+Message-ID) -> V2OutreachActivity (timeline) -> IMAP reply/bounce(DSN) -> suppression/workflow/report
   asserts: no gate => test fails; un-correlatable inbound ignored; replay ignored (UID+Message-ID); hard-bounce DSN suppresses future sends; send respects per-sender caps.

S6 export_truth:  lead filters -> EXPORT_GENERATE -> file -> audit
   asserts: export row count == filtered lead query; references latest assessment snapshot; overlay explicit.

S7 unified_timeline:  for a worked lead, queryLeadTimeline shows activity + outreach + workflow + review events in one ordered stream (Link A).

S-UI ui_workflow_linkage:  every shipped /v2 UI surface is wired to a real read-model + a real action, uses the §4e kit, and surfaces no forbidden product state.
   asserts (per surface, as a UI session lands): no canonical "UNCERTAIN" string in any /v2 page/component; the LeadAssignment workspace renders LeadAssignment rows with an ICP column (not company-level scoring) and shows qualification separate from workflowStatus; NOT_SCORED is derived (no UNCERTAIN/placeholder); no outreach "send" control exists before the O2 suppression gate; the surface imports the canonical statusBadges (no ad-hoc badge). GUARD: extend a `scripts/check-v2-ui-*` smoke per surface; reuses the existing UI visibility check pattern. Makes the design pack's Visual QA checklist partly automated.
```

## 8. Universal Session Prompt Template

```txt
Read AGENTS.md invariants. REFRESH against actual git + schema state before acting (do not trust any doc's snapshot).

SESSION:            CHANGE-KIND:            WORKFLOW STAGE:

Goal:

WORKFLOW LINKAGE
- Upstream objects consumed:
- Objects created/updated:
- Downstream consumers:
- Idempotency key:
- Tenant boundary:
- User-visible proof:
- Automated linkage proof:
- Failure/rollback behavior:
(If any of upstream/downstream/idempotency/tenant cannot be named from the repo, STOP and report a scope gap.)

Allowed files:

Forbidden:
- V1 runtime changes unless explicitly approved
- Prisma schema/migrations unless this is an approved schema phase
- API contract changes unless this session owns the API
- qualification/workflowStatus merge; canonical UNCERTAIN; old-assessment mutation
- duplicate leads/reviews/scores on rerun; outreach send before the suppression gate
- fake data replacing real API data; secrets in logs or source

Implementation logic: 1. 2. 3.

Verification:
- npx prisma validate / generate (when schema touched)
- npm run lint / typecheck / build
- targeted smoke: node scripts/check-v2-<area>.mjs
- npm run test (when behavior added)
- git diff --check ; git status --short

Final response: files changed · runtime? · schema/migrations? · V1 touched? · verification run · open questions
```

## 9. What Can Wait vs Cannot

Can wait: visual polish, table density, command palette, advanced dashboards, chart polish, saved views, AI narrative copy.

Cannot wait (outcome- or safety-critical): scoring source of truth · tenant isolation · idempotency · immutable assessments · `LeadAssignment` as the unit · qualification vs workflowStatus separation · unified lead timeline (Link A) · suppression before any send (Link B) · inbound correlation trust (O7, no acting on un-correlatable mail) · per-sender rate caps + SPF/DKIM/DMARC for 100k/mo deliverability · export source of truth · V1 runtime leakage.

## 10. Next Session

Done so far: **Z1, Z2 (code), SC1-SC6** — the load -> qualify half of the OS is functionally
complete (multi-ICP scoring engine: schema-v2 + dictionaries + dimension scorers + terminal gates +
4-state derivation + SCORE-HV0 runtime wiring + ICP authoring UI + explainable why-drawer, all
proven against the 18-ICP golden corpus). SC1-SC5 are committed; SC6 is verified green in the
working tree, pending browser SEE-IT + commit.

Two small open items before pushing into Tracking:
- **Commit SC6** (per its session-log note, as `feat(v2): add rules-v2 lead explanations` +
  `feat(v2): enrich rules-v2 scoring evidence`), after a browser SEE-IT on `/v2/leads`.
- **Re-point the 120-company test ICP** to corrected/rules-v2 (update rulesJson + bulk rescore, or
  re-author from the SC5 authoring UI) so the live batch reflects the real ICP.

T1 is done — `docs/v2/plan/V2_ACTIVITY_AND_TIMELINE_CONTRACT.md` (activity schema §2, unified timeline union
§3 that O1 is bound to, timezone §4, fuzzy→review §5, claim-scope obligation §6).

```txt
SESSION: T2 - V2ActivityRecord Migration   (needs migration approval — AGENTS: schema work must be allowed)
CHANGE-KIND: approved Prisma migration
Goal: add the V2ActivityRecord table EXACTLY per the T1 contract §2 — fields, enums reused from
      activity-recaps/types.ts, @@unique([organizationId, sourceActivityHash]) idempotency, the timeline
      hot-path indexes, leadAssignmentId/companyId FKs, soft-delete. No cascade from core records.
Why next: T3 (ACTIVITY_APPLY runtime) and T4 (queryLeadTimeline) need the durable table; T1 locked its shape.
Gate: do not run the migration until schema work is explicitly approved (AGENTS absolute restrictions).
Add: migration drift guard + scripts/check-v2-activity-record-fks.mjs (FK/index/unique smoke).

Then: T3 (ACTIVITY_APPLY runtime; idempotent, fuzzy→review, claim-scope per §4d/§6) -> T4 (queryLeadTimeline
union per contract §3) -> T5 (recaps UI + lead-drawer timeline · SEE-IT) -> M1..M4 (CRM loops) ->
O1..O9 (outreach, O1 bound to contract §3) -> R/H (reporting + hardening).
```
