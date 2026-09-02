# V2 Schema → Frontend Wiring Audit (#13)

Living audit of backend↔frontend wiring: unwired buttons, dead server actions, mis-wired links, and
data-integrity spot checks. Started during the W1 pass of the 14-item upgrade program.

## Method
- Static scans: dialog-state-without-render, exported server actions never imported, external
  `<a href>` without a scheme.
- Live DB checks (tenant/soft-delete leaks) against the `v2-org-telestar-dev` org (7.7k leads).
- Headless drive (Playwright + minted session) for the surfaces changed.

## Confirmed bugs — FIXED
| Area | Bug | Root cause | Fix |
|------|-----|-----------|-----|
| Accounts | "Add offer" button did nothing | the offer `<Dialog>` was never rendered (state + handler existed) | added the dialog in `AccountWorkspaceClient.tsx` (project preselected) — #12 |
| Drawers/company | Website link → app 404; some external links dead | stored URLs without a scheme resolve as internal relative paths | new `toExternalHref()` applied to every external anchor (6 files) — #8 |
| Leads | Run-scoring button (toolbar) was a bug | — | removed — #10 |
| Research | Re-run hangs, no error surface | `/process` fetch had no timeout → `busyRef` stuck | AbortController timeout + inline error box + retry — #7 |
| Outreach | Unibox unreachable | `CampaignNav` had no Inbox entry (page + read-model existed) | added Inbox pill — #4 |

## Open findings — NOT yet wired (need a UX decision, documented not guessed)
| Symbol | File | Note |
|--------|------|------|
| `createIcpFromPresetAction` | `app/v2/icp-library/actions.ts` | Exported server action, **never imported**. A "Create ICP from preset" entry point appears to be missing. Wire a preset picker/button, or remove if deprecated. |
| `markTemplateUsedAction` | `app/v2/outreach/templates/actions.ts` | Exported, **never imported**. Template "used" telemetry is never incremented — should be called from the compose/send path when a template is applied. |

## Data-integrity checks — CLEAN (no leak)
Against `v2-org-telestar-dev` (5,461 active CONTACT + 2,310 COMPANY assignments):
- Cross-org contact leak: **0** · cross-org company leak: **0**
- Active assignment → soft-deleted contact: **0** · → soft-deleted company: **0**
- CONTACT-level rows with null `contactId`: **0**
- Duplicate active CONTACT assignments (same project+ICP): **4** (negligible; a unique index guards this).

**#9 "lead leakage" conclusion:** the list query wiring is correct — no tenant/soft-delete/null leak.
The perceived "a lot that look like they fit" is **volume + ranking**: 2,899 `NEEDS_REVIEW` + 1,595
`NOT_SCORED` leads are ranked into the top band by the priority formula, so the queue *looks* full of
fitting leads. Real levers (not a bug fix): (a) a default filter hiding `NOT_SCORED`/low-confidence on
the leads workspace, and (b) scoring quality — deepened by the W5 industry taxonomy. No data mutation
performed (the 4 dups are safe to leave).

## Data follow-ups (not UI wiring)
- **Contact LinkedIn (#8):** the read model correctly sources a contact's own LINKEDIN identifier.
  If a contact shows the *company's* LinkedIn, the wrong URL was written to that contact's identifier
  during ingestion/people-discovery → fix in W2/W3 (extraction), not the drawer.
- **Research `/process` route (#7):** client always unsticks now; making the route itself always
  return a definite terminal/error status is W2/#3 runtime-stability work.

## Table parity (#5)
Companies (`app/v2/crm/companies/page.tsx`) and contacts (`components/v2/contacts/ContactWorkspaceTable.tsx`)
both already render through the shared `components/shared/DataTable.tsx` primitive (frameless). Component
parity is achieved; any residual difference is page-layout level (sidebar/filters) → W6 polish.
