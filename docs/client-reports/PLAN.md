# Client-Facing Campaign Report — PLAN

Source: `C:\Users\admin\Downloads\client-facing-campaign-report-implementation.md`

Goal: formal Client Reports module — frozen, client-safe campaign report snapshots (exec summary + KPI scorecard + funnel + channel activity + meetings + opportunity handoff + SDR contribution + insights), with preview → narrative → approve → export/share. Implements working-order item `3. Client-facing campaign report` (after `2A` Leadgen Manager, which is DONE as of this plan).

## Status

| Phase | Task | Status |
|-------|------|--------|
| 0 | Assessment + this plan | DONE |
| 1 | Schema + migration | DONE |
| 1 | lib/client-reports (access, metrics, snapshot, sanitization, validation, shareLinks, exporters) | DONE |
| 1 | API: list/create, preview, [id] GET/PATCH/DELETE, approve, share, export csv/pdf, public token | DONE |
| 2 | UI: `/client-reports` list + create modal + `[id]` detail + narrative editors + approval bar + sidebar nav | DONE |
| 3 | Export buttons + share modal + public share page + view tracking + archive/history | DONE |
| 4 | BPO metrics (leadgen quality, meeting outcomes, opportunity handoff, client acceptance, source attribution) + ClientReportSettings | DONE |
| 5 | Tests + lint + typecheck + build | DONE |

## Required deviations from source doc

1. **PDF = browser print-to-PDF, no new dependency.** Repo has no PDF lib; the existing team page (`app/team/page.tsx` `handleExportPDF`) builds an HTML string and opens a print window. Same pattern: `[id]/export/pdf/route.ts` returns sanitized, styled `text/html`; the UI opens it for print. XLSX deferred (no `exceljs`).
2. **Direct email sending skipped.** Spec Phase 1/2 = download PDF + secure share link. Email-from-CRM is Phase 3 gated on the Deliverability module (item 4). We stop at share links + recipient storage.
3. **`ClientReportSettings` deferred to Phase 4.** Spec offers `ClientReportSettings` on `Client` or as separate model ("later"). SDR-name display mode is therefore stored in the snapshot: `internal` audience → full names, `client` audience → "First L." (the existing team-page safe format). Phase 4 adds the settings model + per-client overrides.
4. **Leadgen quality section always built, feature-detected.** `LeadPoolItem` now exists (2A done). `metrics.ts` probes the pool tables; if zero pool rows for the tenant/campaign/period it falls back to `Lead`-derived source/quality basics and returns a `warning` (preview payload carries `warnings: string[]`).
5. **Share token stored hashed** (sha256 of 32-byte random token). `passwordHash` column present; password support implemented in `lib/shareLinks.ts` but the Phase 3 UI surfaces it. Expiry + revoke supported.
6. **`team_lead` is a real role** in this schema (it is), so spec's `canCreateClientReport` (`director|floor_manager|team_lead`) works as written.

## Permission model

- `director`: view all, create, approve, share, archive.
- `floor_manager`: view own floor/campaigns, create, approve, share, archive.
- `team_lead`: view own pod/campaigns, create drafts, edit narrative. Cannot approve.
- `sdr`: view own contribution only. Cannot create/share.
- `leadgen_manager`: view (esp. lead supply/data quality section). Cannot approve.
- Clients never get accounts; they consume approved reports via secure share links or emailed PDF.

## Schema additions (Phase 1)

- `enum ReportStatus` (`draft|internal_review|approved|shared|archived`), `ReportPeriodType` (`weekly|monthly|custom`), `ReportAudience` (`internal|client`), `ReportExportType` (`pdf|csv|share_link`; `xlsx` omitted until exporter exists).
- `model ClientReport` (clientId, campaignId?, title, periodType, periodStart, periodEnd, status, audience, summary?, keyWins[], blockers[], recommendations[], clientActions[], snapshotJson, generatedBy, approvedBy/At, sharedAt, archivedAt, tenant).
- `model ClientReportRecipient`, `model ClientReportExport`, `model ClientReportShareLink` (tokenHash @unique, expiresAt?, revokedAt?, passwordHash?, viewCount, lastViewedAt).
- Back-relations on `Client`, `Campaign`, `User`, `Tenant`.

## Phases

1. **Schema + migration** — edit `prisma/schema.prisma`; manual migration `20260802040000_add_client_report_ecosystem`; `migrate deploy`; `prisma generate`.
2. **lib/client-reports** — access.ts (canCreate/canApprove/canView), validation.ts (zod schemas), sanitization.ts (client-safe note rewrite + display-name modes), snapshot.ts (ClientReportSnapshot type + merge/sanitize), metrics.ts (live builder from Lead/Activity/Task/Meeting/Opportunity/SequenceEnrollment/LeadPoolItem), shareLinks.ts, exporters.ts (csv + print-html).
3. **API** — `app/api/client-reports/{route,preview}` + `[id]/{route,approve,share}` + `[id]/export/{csv,pdf}` + `public/[token]` (view tracking). AuditLog row on approve/archive.
4. **UI** — sidebar nav entry (after Opportunities); `/client-reports` list page w/ filters + Create modal; `[id]` detail: status bar, KPI cards, funnel, channel table, lead quality, meetings, opportunities, reps, insights editor, approval bar.
5. **Export/share** — export buttons (PDF print, CSV download), share modal (link + expiry + copy, revoke), public client-safe page, view count, archive/history list.
6. **BPO metrics + settings** — wire leadgen quality + meeting outcome + opportunity handoff + client acceptance rate + source attribution into metrics.ts; add `ClientReportSettings` model + per-client defaults.
7. **Verification** — `tests/client-reports.test.ts` (access, sanitization, metrics shape, snapshot freeze, share link token/verify/revoke), `vitest run`, `tsc --noEmit`, `eslint`, `npm run build`.

## Acceptance (done criteria per spec)

- [x] Manager creates report for client/campaign/date range
- [x] Preview pulls real CRM metrics (lead, activity, meeting, opportunity)
- [x] Manager adds exec summary, wins, blockers, recommendations
- [x] Approve freezes snapshot; audit logged
- [x] Approved report exports to PDF (print) and CSV
- [x] Approved report shares via secure link; views tracked; revocable
- [x] Client-facing version hides internal notes by default (sanitization)
- [x] History stored by client/campaign/period
- [x] Metrics filterable by client, campaign, period
- [x] BPO client-acceptance / opportunity-handoff metrics present
