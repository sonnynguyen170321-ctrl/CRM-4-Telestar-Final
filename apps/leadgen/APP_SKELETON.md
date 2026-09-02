# V1-ERA MOCK

This is a single-tenant, company-first, `Uncertain`-era mock. It is NOT the V2 model. V2 UI follows `docs/v2/plan/V2_UIUX_DESIGN_SPEC_FULL.md`: multi-ICP Context Bar, LeadAssignment-centered workflow, and no canonical `UNCERTAIN` state.

# TeleStar Company-First Tool — App Skeleton for Codex

## 1) Recommended Stack
- Frontend: Next.js App Router + Tailwind + shadcn/ui
- CSV parsing: PapaParse
- Tables: TanStack Table
- Forms: React Hook Form + Zod
- State: lightweight local state + server actions or API routes
- Background jobs: simple queue worker for large files
- DB: Postgres
- Cache: Redis
- AI: OpenAI Responses API with structured outputs

---

## 2) Project Structure
```text
app/
  layout.tsx
  page.tsx
  uploads/
    page.tsx
    [id]/
      page.tsx
  companies/
    page.tsx
    [id]/
      page.tsx
  feedback/
    page.tsx
  exports/
    page.tsx
  api/
    uploads/
      route.ts
    uploads/[id]/route.ts
    uploads/[id]/map-columns/route.ts
    uploads/[id]/run/route.ts
    uploads/[id]/results/route.ts
    company-scores/[id]/feedback/route.ts
    company-scores/[id]/rescore/route.ts
components/
  dashboard/
  uploads/
  companies/
  feedback/
  shared/
lib/
  ai/
  csv/
  db/
  scoring/
  normalization/
  validation/
  utils/
  types/
workers/
  process-upload.ts
  score-company.ts
  export-results.ts
prisma/
  schema.prisma
```

---

## 3) Pages to Build First
### `/`
Dashboard landing page
- upload CTA
- recent uploads
- counts for qualified / uncertain / not relevant
- quick links to last result set

### `/uploads`
Upload and mapping flow
- file upload
- header preview
- column mapping
- start scoring

### `/uploads/[id]`
Upload progress page
- job status
- progress bar
- totals
- errors
- live refresh

### `/companies`
Company results table
- filters
- search
- export
- review actions

### `/companies/[id]`
Company detail drawer/page
- score explanation
- hard rules
- summary
- edit and save feedback

### `/feedback`
Feedback history and correction log
- predicted vs final labels
- reviewer notes
- trend summary

### `/exports`
Export options
- full export
- qualified only
- uncertain only
- reviewed only

---

## 4) Core Components
### Upload components
- `CsvDropzone`
- `FilePreviewCard`
- `HeaderMapper`
- `MappingChecklist`

### Scoring components
- `CompanyScoreBadge`
- `QualificationTag`
- `TypeBadge`
- `ConfidenceMeter`
- `ReasonList`
- `SummarySentence`

### Review components
- `CompanyTable`
- `CompanyFilters`
- `CompanyRowActions`
- `CompanyDetailDrawer`
- `FeedbackForm`

### Shared components
- `AppShell`
- `TopBar`
- `SideNav`
- `StatCard`
- `EmptyState`
- `ErrorBanner`
- `LoadingSkeleton`

---

## 5) Data Types
Define TypeScript types early so Codex stays aligned.

### Company type
```ts
export type CompanyType =
  | 'Not Relevant'
  | 'PAAS'
  | 'SAAS'
  | 'Cloud'
  | 'ITO'
  | 'Data Solution'
  | 'AI Solution'
  | 'AI Service'
  | 'Cyber Security'
  | 'Blockchain Solution';
```

### Qualification type
```ts
export type Qualification = 'qualified' | 'unqualified' | 'uncertain';
```

### Company score result
```ts
export type CompanyScoreResult = {
  companyName: string;
  website?: string;
  companyCountry?: string;
  type: CompanyType;
  qualification: Qualification;
  score: number;
  confidence: number;
  reason: string;
  note?: string;
  oneSentenceCompanySummary: string;
  hardRuleFlags: Record<string, boolean>;
};
```

---

## 6) Rule Engine Modules
Keep these separate from AI.

### `lib/scoring/hardRules.ts`
Responsible for:
- solo-company detection
- excluded-country detection
- services/consulting detection
- website offline detection
- B2C-only weak-fit detection

### `lib/scoring/typeClassifier.ts`
Responsible for:
- mapping company into one of the allowed types
- using website signals, industry, and notes
- returning `Not Relevant` when needed

### `lib/scoring/scoreCompany.ts`
Responsible for:
- combining hard rules + AI result
- final score normalization
- final qualification label

### `lib/normalization/company.ts`
Responsible for:
- trimming whitespace
- normalizing domains
- standardizing countries
- parsing staff ranges

---

## 7) AI Layer
### `lib/ai/companyScorer.ts`
The AI should only receive minimal fields:
- company_name
- website
- company_country
- company_industry
- company_staff_count_range
- company_linkedin_url
- extracted website signals if available

The AI must return structured JSON only.

### Response schema
- company_score
- qualification
- company_type
- reason
- one_sentence_company_summary
- confidence
- hard_rule_flags

---

## 8) API Contracts
### `POST /api/uploads`
Create a new upload job.

### `POST /api/uploads/:id/map-columns`
Save column mapping.

### `POST /api/uploads/:id/run`
Start scoring.

### `GET /api/uploads/:id`
Get job status.

### `GET /api/uploads/:id/results`
Fetch scored companies with filters.

### `POST /api/company-scores/:id/feedback`
Save user correction.

### `POST /api/company-scores/:id/rescore`
Recompute score after feedback.

---

## 9) First UI Priority
Build in this order:
1. App shell
2. Dashboard cards
3. CSV upload page
4. Column mapper
5. Results table
6. Detail drawer
7. Feedback save flow
8. Export flow

---

## 10) UX Rules for Codex
- keep everything desktop-first
- optimize for fast review of many rows
- keep actions visible in the row or side drawer
- use short labels and plain language
- show progress clearly
- do not overload the screen with unnecessary charts
- make export one-click

---

## 11) Environment Variables
```bash
DATABASE_URL=
REDIS_URL=
OPENAI_API_KEY=
OPENAI_MODEL=
NEXT_PUBLIC_APP_URL=
```

---

## 12) Development Milestones
### Milestone 1
- upload CSV works
- mapping works
- hard rules work
- results table renders

### Milestone 2
- AI scoring works
- review drawer works
- feedback saves

### Milestone 3
- export works
- caching works
- duplicate detection works
- lead-level phase can begin

---

## 13) Codex Build Prompt
Use this as the main instruction for Codex:

Build a company-first lead filtering app for TeleStar. The app must ingest CSV files, map company columns, run hard-rule filtering before AI, classify companies into allowed types, score them from 0 to 100, show reasons and a one-sentence summary, allow human feedback edits, and export clean results. Keep token usage low by calling AI only for uncertain rows. Use a clean desktop-first dashboard UI.

---

## 14) Acceptance Criteria
The skeleton is good when:
- the app can be scaffolded from this structure,
- each page has a clear job,
- the rules and AI parts are separated,
- the output format matches the team’s manual workflow,
- it is easy to extend into lead-level filtering later.

