# SKILL.md — TeleStar Company-First Lead Filter

## Purpose
Build a company-first lead filtering tool for TeleStar.

The tool must:
- ingest CSV files,
- filter and score companies before leads,
- classify each company into a business type,
- return a 0–100 score with a short reason and a one-sentence company summary,
- support human feedback so the model and rules improve over time,
- minimize AI token usage by running deterministic rules first.

## Product Philosophy
Always filter companies first.
Only after a company is qualified should the app continue to lead-level qualification.

The manual workflow the team already uses is the source of truth for the first version.
The tool should match that workflow as closely as possible.

## TeleStar ICP
### Positive ICP
- GEO: USA, Australia, Singapore, Norway, Switzerland, Denmark, Sweden, UK, Canada, Israel
- Verticals: Tech, Software, SaaS
- Personas: Founder, CEO, COO, CRO, VP Sales, Head of Sales Dev, Head of Growth, VP Business Development, VP Growth, Head of Sales, Head of Business Development, Director of Sales, Director of Business Development
- Minimum size: 3 employees

### Disqualifiers
- one-person company
- Gmail account
- company has offices in India, Pakistan, Bangladesh, or Philippines
- website offline or not reachable
- services / consulting / agency-based product
- B2C-only, especially with no pricing signal and no B2B product signal

## Company-First Input Columns
The company scoring flow should prioritize these columns:
- Company Name
- Website
- Company Country
- Company LinkedIn URL
- Company Industry
- Company Phone 1
- Company Staff Count Range
- any team notes or tags

Optional lead-level columns are used later only after company qualification:
- Lead Name
- Title
- Contact LinkedIn URL
- Contact Country
- Department
- Seniority
- Email 1 Validation
- Email 2
- Contact Phone 1
- Contact Phone 2
- workflow stage / notes fields

## Canonical Output for Company Filtering
Each company row must return:
- company_name
- website
- company_country
- type
- note
- company_score
- qualification
- confidence
- one_sentence_company_summary
- hard_rule_flags
- review_state

### Allowed Type Values
Use exactly one of these values:
- Not Relevant
- PAAS
- SAAS
- Cloud
- ITO
- Data Solution
- AI Solution
- AI Service
- Cyber Security
- Blockchain Solution

## Scoring Rules
### Stage 1 — Deterministic Hard Rules
Run hard rules first.
If a company matches a disqualifier strongly, do not call the AI unless the row is ambiguous and needs explanation.

Suggested hard-rule logic:
- Staff count = 1 or solo founder -> Not Relevant
- Website unreachable / dead / broken -> Not Relevant
- Company country in excluded office locations -> Not Relevant
- Services / consulting / agency / outsourcing -> Not Relevant
- B2C only with no evidence of B2B product fit -> Not Relevant

### Stage 2 — AI Classification
Only send to AI rows that:
- are not already disqualified,
- have unclear product type,
- need a better summary,
- or need confidence-based scoring.

The AI should return:
- company_score (0–100)
- type
- qualification
- reason
- one_sentence_company_summary
- confidence

### Stage 3 — Human Review
The UI must allow a user to correct:
- type
- qualification
- note
- company_score

These corrections must be stored as feedback examples.

## Suggested Score Bands
- 0–29: not relevant
- 30–49: weak fit
- 50–69: possible fit, review needed
- 70–84: strong fit
- 85–100: very strong fit

## Token Optimization Rules
To save tokens:
1. run local rule checks before any model call,
2. cache results by normalized website and company name,
3. avoid sending full rows when only 3–5 fields are needed,
4. batch uncertain rows,
5. use structured JSON output only,
6. reuse prior corrections as few-shot examples only when useful,
7. do not re-score unchanged rows.

## Feedback Learning Loop
Store every manual correction with:
- company name
- website
- original model output
- final human label
- final human type
- final human score
- notes
- timestamp

Use this data to:
- improve rules,
- improve prompts,
- build a gold test set,
- evaluate changes before shipping.

## UI Requirements
### Main pages
1. Upload CSV
2. Map columns
3. Company scoring results
4. Review and edit labels
5. Feedback history
6. Lead filtering page, unlocked only after company filtering is stable

### Results table columns
- Company Name
- Website
- Company Country
- Type
- Note
- Score
- Qualification
- Confidence
- Summary
- Review action

### Filters
- score range
- qualification
- type
- country
- review state

## Recommended Tech Stack
- Frontend: Next.js + Tailwind + shadcn/ui
- CSV parsing: PapaParse
- Backend: Next.js API routes or Node.js service
- Queue/background jobs: for large files
- DB: Postgres
- Cache: Redis
- AI: OpenAI Responses API with structured outputs

## Implementation Order
1. Create CSV upload and column mapping
2. Add company-level parsing and normalization
3. Add hard-rule filter engine
4. Add AI scoring for uncertain rows only
5. Add review table and edit actions
6. Add feedback storage
7. Add score history and evaluation
8. Add lead-level filtering as a second phase

## Codex Instructions
When Codex builds this project, it should:
- prioritize company-first filtering,
- keep UI simple and fast,
- keep model calls small and selective,
- avoid over-engineering before the first working version,
- match the existing manual workflow used by the team,
- make outputs easy to export back into CSV.

## Acceptance Criteria
The first version is done when:
- a CSV can be uploaded successfully,
- columns can be mapped,
- company rows can be classified,
- hard disqualifiers work reliably,
- AI is only called for uncertain rows,
- results can be edited and saved,
- feedback is persisted for future improvement,
- company output matches the team’s manual format.

