# V2 SDR Workflow Wiring Audit — 2026-06-19

Audit of the actual codebase against the target outcome: the V2 pages must form ONE logically-linked SDR workflow that actually works (upload → score → CRM → outreach), not isolated islands. Grounded in code, file:line cited. Pairs with Antigravity's "Fix SDR UX Wiring and Blindspots" plan.

## 0. TL;DR

The **runtime is real and mostly complete**. The **glue between pages is missing**, and there is **one genuine data-model bug** (contact identity is company-scoped, contradicting the person-centric schema → job-change duplicates). The fix is ~80% UI wiring on existing backends + 1 resolver change + a few indexes. No schema migration is required for the wiring; the contact-identity fix is a resolver change (optionally one index).

---

## 1. Architecture truth (the spine)

Data model (`prisma/schema.prisma`):

- **V2Company** (`:556`): `@@unique([organizationId, canonicalDomain])`; identity = canonical domain, fallback `nameNormalized`. Companies are scored per ICP via assessments on their LeadAssignments.
- **V2Contact** (`:650`): person record. **Has NO `companyId`** — deliberately person-centric. Emails/phones/linkedin live in **V2ContactIdentifier** (`:680`) with `isGeneric`/`isValid`/`validityStatus`.
- **V2LeadAssignment** (`:706`) = **Company × Project × ICPVersion** (+ optional `contactId`, `assignmentLevel COMPANY|CONTACT`, `workflowStatus`, `latestHardRuleAssessmentId`). This is the unit of scoring/outreach (Invariant 2). Dedup = partial-unique indexes `V2LeadAssignment_active_company_assignment_key` / `..._active_contact_assignment_key` (referenced in `upsertLeadAssignments.ts:827`).

Pipeline (works end-to-end at runtime):

1. **Upload → map** — one column mapping carries BOTH company + contact columns: `{company, website, domain, email, contact, linkedin}` (`lib/v2/ingestion/types.ts:32`). So a mixed file (company + contact per row) is already supported per-row; `importProfileSuggestion` classifies company/contact/mixed.
2. **Parse → Normalize → IdentityMatch** (`lib/v2/ingestion/handlers.ts`) → sets `matchedCompanyId` / `matchedContactId`, or `candidate` → Manager Review, or `none` → create company.
3. **LEAD_ASSIGNMENT_UPSERT** (`lib/v2/ingestion/upsertLeadAssignments.ts`) → creates COMPANY-level lead (company only) or CONTACT-level lead (company+contact); idempotent on the active-assignment partial unique; then **enqueues COMPANY_ENRICHMENT** bound to the ingestion job, which **chains to ICP_SCORE**. So: companies ARE scored per ICP, contacts ARE saved + matched to their company via the LeadAssignment.
4. **Outreach send is real**: `createManualSend` (`lib/v2/outreach/send/createManualSend.ts`) inserts `V2OutreachMessage` QUEUED + enqueues `EMAIL_SEND`; the **suppression gate is the last synchronous check before the provider** (Invariant 10); transport sandbox until a sender is flipped live (OL7). Sequences + enrollment runtime exist (`lib/v2/outreach/sequences/*`).

Contacts ARE linked to leads/companies in read models: `queryContacts` / `getContactDetail` (`lib/v2/crm/queryContacts.ts`) derive the contact's company from its **latest active LeadAssignment**, and return `linkedLeadAssignments` + `recentActivities` + identifiers. Compose (`app/v2/outreach/compose/page.tsx`) already pulls the contact's primary valid EMAIL identifier, shows a readiness checklist (email present / not suppressed / healthy sender), drafts a message, and sends.

**Conclusion:** "outreach is a toy" is not because the runtime is fake — it is because the pages are **not wired into each other**, the **happy path is long and unguided**, and **empty states don't lead anywhere**.

---

## 2. The genuine data-model bug — contact identity is company-scoped (job change)

`resolveExactContactForCompany` (`lib/v2/identity/resolveIdentity.ts:296`) filters contact candidates to `candidate.companyId === companyId` (`:302`), then matches the email **only within that company's contacts** (`:309-319`). Candidate contacts are loaded by joining `V2Contact → V2LeadAssignment → company` (`lib/v2/ingestion/handlers.ts:555-570`), so each candidate's `companyId` is its existing LeadAssignment's company.

Consequence — **job change breaks person identity**:

- Person at Company A (email `p@x.com`) has a LeadAssignment. Later they appear in an upload for Company B with the same email.
- Identity resolves company = B, then looks for a contact with `p@x.com` **already linked to B**. None → no contact match → the row becomes a **company-level lead** (or a new duplicate contact), and the same human is now split across records.

This contradicts the schema, which made `V2Contact` **company-agnostic on purpose**. Suppression is email-global (good — an unsubscribe at A still blocks B), but the **contact DB duplicates people** and `/v2/contacts` cannot show "this person, now at B (prev A)".

**Recommended fix (resolver, not schema):** add an email-first, company-agnostic contact reuse path. If an email exactly matches an existing non-generic contact (any company), **reuse that V2Contact** and create a **new LeadAssignment** to the new company. Keep contact person-centric; "current employer" stays derived from the latest active LeadAssignment (already how `queryContacts` does it). Optional supporting index: `V2ContactIdentifier(organizationId, type, normalizedValue)` already exists (`schema:700`) — the global lookup is cheap. Add Vietnamese/Unicode normalization fixtures (Invariant 11) for the email/name path.

This is the only change that touches matching semantics — propose it explicitly and gate it behind review before implementing (it changes how leads/contacts are created).

---

## 3. The 5 workflow asks — status vs gap

| Ask | Runtime | Gap (why it feels broken) |
|---|---|---|
| **/v2/leads = CRM, filter leads by company → start outreach; link contacts/companies/outreach** | Lead workspace + drawer + cross-ICP company view (`queryCompanyCrossIcpLeadAssignments`) exist | No **company facet / "work an account" group-by-company** on the leads page (only free-text `search` + `domain` filter). No first-class **Compose / Enroll** action from the lead drawer/bulk bar wired to `/v2/outreach/compose?leadAssignmentId=` / enroll. (Antigravity W-items; partly WIP at HEAD.) |
| **/v2/uploads = split a mixed lead+company file, score companies per ICP, save+match contacts** | Mapping carries company+contact; pipeline scores companies + saves+matches contacts per row | The run is **daemon-dependent / unguided** — no synchronous "Process pipeline" button, so the SDR uploads and sees nothing happen. Empty states + smart-context default missing. (Antigravity items.) Mixed-file is per-row only; a file with **separate company-only and contact-only sections** still needs each contact row to carry its company column. |
| **/v2/contacts = contact DB linked to leads for outreach** | `queryContacts`/`getContactDetail` already join company + linkedLeadAssignments + activity | No **Compose jump** from a contact; "employer" is latest-LA only and **wrong on job change** (§2). No primary-email selection when multiple identifiers. |
| **/v2/outreach = make it usable (not a toy)** | compose + sequences + senders + suppression + send runtime all real | **No entry points** from leads/contacts; **long unguided happy path** (needs published ICP → scored QUALIFIED lead → enriched email → live sender); empty states dead-end. Reports show **sender UUIDs** not names (Antigravity). |
| **Primary key to manage companies+leads + faster index; job-change case** | Company `unique(org,domain)`; LeadAssignment partial-unique active tuple; contact identity via identifier | Keys exist — they just aren't **documented/surfaced**. The real issue is the **company-scoped contact identity** bug (§2), not a missing PK. |

---

## 4. Target workflow (the logical links to build)

```
/v2/uploads ──(mixed file: company+contact cols)──▶ map ▶ [Process pipeline] (sync)
     │                                                          │
     ▼                                                          ▼
companies scored per ICP                         contacts saved + matched to company
     └──────────────┬───────────────────────────────────────────┘
                    ▼
/v2/leads (CRM)  ── filter/group BY COMPANY (work an account) ── open lead
   │  links: contact (▶/v2/contacts), company (▶/v2/companies)
   ▼
LeadDrawer: why-score + contact + email
   ├─[Compose 1-off]──▶ /v2/outreach/compose?leadAssignmentId=…  (suppression-gated)
   └─[Enroll in sequence]──▶ sequence (per-step gate, stop-on-reply)
                    │
                    ▼
        activity ▶ lead timeline ▶ /v2/reports
/v2/contacts = cross-account person DB ─▶ jump to a person's leads + compose
```

---

## 5. Sequenced wiring fixes (mostly UI glue on existing runtime)

Each = one change-kind session; `lint && typecheck && build` + smoke + SEE-IT; commit + push.

- **W1 — Lead/Contact → Outreach connective.** "Compose 1-off Email" on `LeadDrawer` + `ContactDrawer` → `/v2/outreach/compose?leadAssignmentId=…`; "Enroll in sequence" on `LeadDrawer` + `LeadBulkActionBar`. (Antigravity; verify/finish the HEAD WIP.) Pure UI.
- **W2 — Leads "work an account" view.** Add a `companyId` facet + group-by-company on `/v2/leads` reusing `queryCompanyCrossIcpLeadAssignments`; clicking a company shows all its leads across ICPs to start outreach. Read-model reuse, no new lead query.
- **W3 — Guided ingestion run.** "Process pipeline" synchronous drain button on the ingestion job page (drain `processNextV2Job` inline / `run-until-idle`), so upload→score completes without the daemon. Empty-state CTAs (Create Account→Project→ICP→Upload) + smart-context default on `/v2/leads`. (Antigravity.)
- **W4 — Contacts → outreach.** Compose jump from `ContactDrawer`; show all linked leads; primary-email picker when multiple identifiers.
- **W5 — Outreach onboarding + QoL.** Outreach hub empty-state checklist (add sender → publish ICP → qualify lead → compose); `useFormStatus` loading on "Run due steps"; reports show `displayName`/`fromAddress` not `senderId.slice` (Antigravity); carry `projectId`/`icpVersionId` into the enroll/"Add leads" links.
- **W6 — (REVIEW-GATED) Contact identity = email-global.** The §2 resolver change so job-change reuses the person. Stop for explicit approval before implementing — it changes lead/contact creation semantics; add Vietnamese/Unicode fixtures + an idempotency/dedup smoke.

## 6. Data-model recommendations

- **Lead PK** — already correct: partial-unique on active `(org, project, icpVersion, company[, contact])`. Document it in the schema comments; don't add a new key.
- **Company key** — `unique(org, canonicalDomain)` is the right natural key; keep nameNormalized as fuzzy fallback (already used).
- **Contact identity** — keep `V2Contact` company-agnostic (it already is). Fix the **resolver** (W6), not the schema, so one human = one V2Contact and "employer" derives from the latest active LeadAssignment.
- **Index for the account view (W2)** — if group-by-company filtering is slow, add `V2LeadAssignment(organizationId, companyId, workflowStatus)`; existing `(organizationId)`, `(companyId)`, `(organizationId, workflowStatus)` indexes already cover most paths.
- **Job change** — no schema change needed once W6 lands: a job change = reuse contact + new LeadAssignment to the new company; old LeadAssignment stays as history; suppression remains email-global.

## 7. Verification (every wiring session)

`npm run lint && npm run typecheck && npm run build`; relevant smoke; grep guards (no `UNCERTAIN`, no global company score, no V1 imports, no plaintext secrets); SEE-IT: single shell, every nav link resolves, lead→compose prefills the contact email, suppression gate visible before send.

## 8. Immediate next action

W1 (Compose/Enroll buttons) — smallest change that makes the lead→outreach loop feel connected — then W3 (guided ingestion run) so a fresh upload visibly produces scored leads. W6 (contact identity) is the one item that needs explicit approval before coding.
