# Plan — Unified Leadger UI theme + bug backlog

> Planning doc (not yet built). Follows PRODUCT.md (register `product`, SDR-led, premium-yet-calm,
> WCAG AA + dark parity) and the impeccable `shape` + `layout` flows. Home / Leads / Companies were
> already redesigned as the exemplar; this plan makes **every** surface share one design language and
> tracks the open bug fixes.

## Context — why
The surfaces don't read as one product. Concretely, four different table/list idioms exist side by side:

| Surface | Idiom today |
|---|---|
| Companies | shadcn `<Table>` (clean data table — just redesigned) |
| Contacts | raw `<table>` with `border-separate` rounded "card-table" rows |
| Leads | `rounded-xl border` card-per-row list (no table) |
| Accounts | `<table>` + `divide-y` + **8 grid-cols + 21 card containers** — a table/card-grid soup ("messy") |

Plus per-page drift in headers, spacing rhythm, empty/loading/error states, and component vocabulary
(buttons, badges, chips, avatars). The token migration made everything *color*-consistent; it did not
make it *structurally* consistent. The fix is a **small, enforced design system** that all surfaces
consume — so companies, contacts, and accounts are visibly the same product.

---

## Part A — Bug backlog (keep in the plan)

### A0. `runtime/sync` 500 — DONE ✅ (commit 0317c07, pushed)
Filtered `V2Job`/`V2RuntimeRun` by a non-existent `deletedAt`, and queried invalid enum `'COMPLETED'`
→ every poll 500'd → job notifications dead app-wide. Fixed + verified live.

### A1. "Needs contact" fires on leads that HAVE a contact (investigated — root-caused)
**Evidence (live DB):** 366 leads are `COMPANY_QUALIFIED_NEEDS_CONTACT`; **57 of them have a contact**,
and **all 57 of those contacts have no job title** (0 with a title). 1,344 / 4,361 contacts (31%) have
no title at all.

**Root cause chain:** contact created/uploaded without a `title` → `buildScoringInput.buildPersonaEvidence`
returns `undefined` when `!row.contactTitle` → normalized `evidence.contact.titlePresent = false` →
`needsContactEvidence()` returns true → qualification = `COMPANY_QUALIFIED_NEEDS_CONTACT`. So a lead that
*has* a contact still shows "needs contact" purely because that contact has no title.

**Three distinct problems, three fixes:**
1. **Logic (over-firing):** in `lib/v2/scoring/rules/deriveQualification.ts` `needsContactEvidence()`, the
   first branch returns true on `!evidence.contact?.titlePresent` **without** checking that the ICP actually
   requires a persona title. Gate it: only treat a *present-but-titleless* contact as "needs contact" when
   `required.personaTitle` (or `rules.persona.requirePersonaForFinalQualification`) is set. If the ICP
   doesn't require a title, a present contact should route to QUALIFIED/NEEDS_REVIEW by score, not
   needs-contact. (A truly absent contact — `!evidence.contact` — still correctly needs one.)
   Add a fixture/test for "strong company + present contact, no title, ICP does not require title → not
   NEEDS_CONTACT".
2. **Label (misleading):** `COMPANY_QUALIFIED_NEEDS_CONTACT` renders as "needs contact" even when a contact
   exists but lacks a title. In `statusBadges` / the qualification label map, split the presentation:
   contact absent → "Needs a contact"; contact present but title missing → "Needs a decision-maker" (or
   "Contact — no title"). Requires threading "has a contact" into the badge (already on the row/read model).
3. **Upload / data (31% titleless):** the CSV mapping likely isn't capturing a title column. Audit the
   ingestion column mapping/auto-detect (`title` / `job title` / `position` / `role` synonyms) so uploaded
   contacts keep their title; add a "Find title" enrichment affordance for legacy titleless contacts (the
   research engine already discovers titles). Related "UNKNOWN" display = titleless/nameless contacts
   surfacing as "Unknown" — the resolver + label fixes cover it.

### A2. Vietnamese company-name dedup misses suffix + short-forms (Invariant 11)
The legal-prefix stripper handles prefix forms (`Công ty TNHH ABC`) but not suffix forms (`ABC TNHH`), and
is missing short-forms (`co phan`, `tnhh mtv`, `dntn`) → duplicate companies/leads. Fix the normalizer +
add Vietnamese fixtures (Invariant 11 explicitly requires this).

### A3. `queryContacts` soft-delete leak (Invariant 8)
The open-review facet subquery in `lib/v2/crm/queryContacts.ts` counts soft-deleted `V2ManagerReviewItem`
rows (missing `deletedAt IS NULL`). Add the filter; add a regression check.

### A4. Send `SEND_UNCONFIRMED` has no recovery
A worker crash marks SMTP-delivered sends as permanently `FAILED (SEND_UNCONFIRMED)` with no Sent-sync
reconciliation. Add a reconcile pass (IMAP Sent / provider message-id match) to flip confirmed deliveries
back to SENT. Larger; schedule after A1–A3.

---

## Part B — Unified Leadger UI theme (shape brief)

**Feature summary.** One design system, enforced, that every V2 surface consumes so the product reads as a
single tool. Not a re-skin per page — a small set of shared primitives + rules, then each of the ~12
surfaces is migrated onto them.

**Primary outcome.** A user moving companies → contacts → accounts → leads sees the *same* table, the same
row rhythm, the same header, the same chips and states. Nothing looks bolted on.

**Design direction.** Restrained (product floor); one accent for primary/selection/state; a second neutral
layer for nav/toolbars. Light default, full dark parity. Anchors: **Linear** (calm dense tables + generous
section separation), **Attio** (premium CRM record tables + drawers), **Stripe Dashboard** (trustworthy
data density + real states). Per PRODUCT.md principles (speak business not schema; premium through
restraint; act in place).

**The system (what gets built once, in `components/shared/`):**
1. **`DataTable`** — the single dense-table primitive (sticky header, sortable head, row selection, `j/k`
   nav, contained horizontal scroll, mobile→stacked cards, standard empty/loading/error). Companies,
   Contacts, Accounts, Reviews, Campaign-leads, Suppression, Senders, Jobs all render through it. **This
   replaces the four divergent idioms.** Leads keeps a `FocusList` variant (card-per-row is right for the
   priority deck) but built from the same tokens/vocabulary.
2. **`PageHeader`** (exists) — mandated on every route: eyebrow-free title + one human sentence + a single
   right-aligned primary action + optional cluster tabs. No numbered eyebrows.
3. **`PanelCard`** (exists) — the only panel container; one shadow scale; never nested.
4. **State kit** — `EmptyState` (teaching + CTA), `Skeleton` (no mid-content spinners), `ActionableError`
   (fix, not `Code:`). One vocabulary, used everywhere.
5. **Chip/badge vocabulary** — one `StatusBadge` + `Chip` + `Avatar` (single-hue token, initials). No
   rainbow avatars, no per-row rainbow buttons, no side-stripe borders (all now banned + swept).
6. **Row-action vocabulary** — one primary action style (accent) + one ghost/secondary; identical across
   surfaces.

**Scope / fidelity.** Production-quality, but **plan-then-build per surface**. Sequence: build the
`DataTable` + finalize the state kit → migrate the CRM cluster first (Companies is already close; Contacts
+ Accounts are the visible mismatch the user named) → then Reviews/Sequences/Campaigns/Templates/Senders/
Suppression/Ingestion → then Reports/Settings/AI/Research page. Each migration = swap the idiom for the
shared primitive; no query/logic change.

**Key states (every surface).** default · empty (teaching + CTA) · loading (skeleton) · error
(ActionableError) · edge (0 / 1 / typical / 500+ rows, long names, missing fields). Company-level vs
contact-level leads render honestly.

**Interaction model.** Tables: `j/k`/Enter/`x`, sticky header, drawer opens in place, act inline. Global
Cmd+K, NotificationBell deep-links, toast on every mutation. Motion 150–250ms, state-only, reduced-motion
fallback.

**Content.** De-jargon everywhere (continue the "Leadger→Pipeline", resolved-name, "needs a
decision-maker" work). Empty states teach; errors are fixes.

---

## Part C — Layout sub-plan (`/impeccable layout`)
- **Spacing:** 4pt scale (Tailwind steps); 8–12px within a group, 24–32px between groups, 48–64px between
  page regions; `gap` over margins. No arbitrary values.
- **Hierarchy:** squint-test primary→secondary→groups in 2s via space + weight first; the PageHeader title
  is the anchor.
- **Tables:** dense rows, generous frame (Linear); one row-height rhythm shared across surfaces; selection
  = full accent bg tint (never a side-stripe); one hover treatment.
- **Accounts specifically:** replace the table+card-grid soup (8 grid-cols / 21 card containers) with one
  `DataTable` for the account list + at most one summary strip; kill the nested cards.
- **Elevation:** one sm→md→lg shadow scale; semantic z-index scale (dropdown→sticky→backdrop→modal→toast→
  tooltip).
- **Responsive:** structural (collapse nav, responsive table, stacked cards on mobile) — not fluid type.
- **Verify:** squint test, rhythm beat, 2s hierarchy read, comfortable density, uniform scale, graceful
  collapse → `/impeccable polish` per surface.

---

---

## Part D — API route architecture upgrade (refresh lag + correctness)

**Symptoms.** Refresh/navigation feels laggy; a suspected bug in the route logic; want faster, cleaner,
error-free routes ("a waterfall route, or clone a proven design").

**Diagnosed causes.**
1. **Constant polling.** `GlobalJobWatcher` polls `/v2/api/runtime/sync` **every 5s, `cache:no-store`, on
   every page and every open tab, for ~2h** — each poll runs 2 aggregate MAX queries + a completed-jobs
   scan. N tabs = N pollers hammering the DB continuously even when idle.
2. **Full-tree refresh.** Mutations call blanket `router.refresh()`, which re-runs the entire route's
   server components — including the heavy leads/companies **LATERAL directory queries** — instead of
   revalidating just the affected read-model. That is the felt "refresh lag."
3. **Inline drain on the request path.** The self-driving `/v2/crm/companies/runs/[runId]/process` drain
   executes jobs **inline inside a request `$transaction`** with `FOR UPDATE SKIP LOCKED`, and is polled
   every 4s. Under load this risks Prisma connection-pool exhaustion (Antigravity perf finding) and blocks
   the request thread.
4. **The one hard route bug** (runtime/sync `deletedAt` + invalid `'COMPLETED'` enum) is fixed in A0, but
   the polling/refresh pattern itself is the lag.

**Redesign — clone proven patterns, and explicitly AVOID request waterfalls (sequential dependent fetches
are the lag; parallelize with `Promise.all`).**
1. **Kill the 5s poll → push / smart cadence (biggest win).**
   - Best: **SSE** — one `/v2/api/runtime/events` `ReadableStream` per session; the runtime emits
     job-completion events; the client subscribes once (clone the standard Next.js Route-Handler SSE
     pattern). No polling.
   - Interim if SSE is too much now: **visibility-aware exponential backoff** — poll only while a run is
     active, back off to 30–60s when idle, and pause on `document.visibilityState === "hidden"`; share one
     poller across tabs via `BroadcastChannel`. Cuts ~95% of idle polls with a tiny change.
2. **Granular revalidation, not `router.refresh()`.** Tag the heavy read-models and use
   `revalidateTag(entity)` / `revalidatePath(specific)` after a mutation so only the affected query
   re-runs.
3. **Cache the heavy directory read-models.** Wrap the leads/companies LATERAL queries in `unstable_cache`
   with tags (or a short TTL); invalidate on the specific mutation. A refresh then re-reads cache, not the
   full LATERAL.
4. **Move draining off the request path.** `/process` should trigger/enqueue and report status, not run
   jobs inline; bound concurrency; let the worker drain when live. Removes the pool-exhaustion risk.
5. **One typed, cached query layer** ("the clean waterfall done right"): consolidate the ad-hoc raw-SQL
   route handlers behind a tenant-scoped read-model module (request → cache → DB), parallelized. Optionally
   adopt **TanStack Query** on the client for dedup + background stale-while-revalidate instead of manual
   polling/refresh.
6. **Indexes / N+1.** `V2Job` already has `@@index([organizationId, status, nextAttemptAt])`. Audit the
   directory LATERAL queries for missing composite indexes; consider a materialized read-model for the
   heaviest directory.

**References to clone:** Next.js Route Handlers + `revalidateTag`; SSE via `ReadableStream`; TanStack Query
(cache/refetch/dedup); stale-while-revalidate.

**Verification:** polls/min before→after (target: ~0 when idle); p50/p95 of the heavy routes; no 500s;
refresh feels instant (cached read-model + granular revalidation); pool never exhausts under a burst.

---

## Co-code split — Antigravity + Claude (this doc is the shared source of truth)
- **Claude (logic + data + primitives + API):** the bug fixes (A1 scoring gate/label/upload, A2 VN dedup,
  A3 soft-delete, A4 send recovery), the shared **`DataTable` + state-kit primitives**, and **Pillar D**
  (SSE/caching/revalidation/off-request drain). Anything touching scoring, queries, schema, or route logic.
- **Antigravity (UI phase only — its role is UI/component generation):** once `DataTable` + the state kit
  land, **migrate the ~12 surfaces onto them** — Contacts + Accounts first (the named mismatches), then the
  CRM cluster, then the rest. UI-only: consume the shared primitives + existing read-models; **no scoring,
  schema, API, or query changes**; stay inside the active surface's files; one surface per session; append
  `SESSION_LOG.md`.
- **Both:** respect the V2 invariants (unit = LeadAssignment; tenant-scoped; soft-delete; no fake rows);
  **no commit without the user asking**; refresh against git before acting; if a task needs out-of-scope
  changes, stop and flag.

## Sequencing
A0 done. Then **D1 (kill the 5s poll → visibility-aware backoff, quick win) + A1 (needs-contact) + A3
(soft-delete leak)** — small, high-trust, immediately-felt. Then **B/C**: build `DataTable` + state kit →
Antigravity migrates Contacts + Accounts first (the named mismatches) → CRM cluster → the rest, in parallel
with Claude landing the rest of **Pillar D** (granular revalidation + cached read-models + off-request
drain, then SSE). **A2 (VN dedup)** and **A4 (send recovery)** are their own backend sessions. Surface
migrations are presentational (Antigravity); bug fixes + primitives + API (Claude) touch logic and get
tests.

## Verification
Per change: typecheck 0, eslint clean, impeccable design-hook clean, `vitest lib/v2` green (+ new tests for
A1/A2/A3). Per surface: SEE-IT — same table/header/states as its siblings; dark parity; no horizontal page
overflow; mobile stacked; empty/loading/error present. Bug fixes: re-query the DB to confirm the
needs-contact counts move only when they should; VN fixtures; soft-delete regression.
