# TeleStar Lead Scoring Tool — PRD

## 1) Goal
Build a CSV-based lead filtering and scoring tool for TeleStar that:
- screens leads against TeleStar ICP and disqualifying rules,
- uses AI only when needed to reduce token usage,
- returns a score from 0 to 100, a qualification verdict, a company type, and a one-sentence company summary,
- learns from human feedback over time to improve scoring quality.

## 2) Primary Use Case
A user uploads a CSV of company records first. The tool:
1. detects and maps company-level columns,
2. runs company filtering and company-type classification first,
3. assigns a score from 0 to 100 with a reason and one-sentence company summary,
4. lets the user review and correct company-level labels,
5. stores feedback so future scoring improves,
6. only after company filtering is stable, uses the qualified company set for lead-level filtering.

This keeps the workflow aligned with the manual process the team already uses.

## 3) ICP Rules
### Positive ICP
- GEO: USA, Australia, Singapore, Norway, Switzerland, Denmark, Sweden, UK, Canada, Israel
- Vertical: Tech, Software, SaaS
- Persona: Founder, CEO, COO, CRO, VP Sales, Head of Sales Dev, Head of Growth, VP Business Development, VP Growth, Head of Sales, Head of Business Development, Director of Sales, Director of Business Development
- Minimum size: 3 employees

### Disqualifiers
- one-person company
- Gmail account
- offices in India, Pakistan, Bangladesh, or Philippines
- website offline
- services/consulting-based product

## 4) Inputs
### Company-first CSV columns
The company filter will use these columns first:
- Company Name
- Website
- Company Country
- Company LinkedIn URL
- Company Industry
- Company Phone 1
- Company Staff Count Range
- any notes or tags added by the team

### Optional lead columns for later phase
These lead columns may be used only after company-level qualification:
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

### Data quality rules
- Prefer Company Country over contact country.
- Prefer Company Staff Count Range for size qualification.
- Prefer Website and Company LinkedIn URL for company-type classification.
- Treat notes as human hints, not as source of truth.
- Lead-level fields must not override a company-level disqualification.

## 5) Outputs
### Company-level output
For each company record, return:
- company_score: integer 0–100
- qualification: qualified | unqualified | uncertain
- company_type: Not Relevant | PAAS | SAAS | Cloud | ITO | Data Solution | AI Solution | AI Service | Cyber Security | Blockchain Solution
- reason: short explanation string or short list
- one_sentence_company_summary: single-sentence description of what the company does
- confidence: 0.0–1.0
- hard_rule_flags: object showing which disqualifiers were triggered
- review_note: optional field for ambiguous cases

### Lead-level output (later phase)
After company qualification, the tool may return:
- lead_score
- lead_fit_reason
- persona_match
- contact_quality flags

## 6) Scoring Logic
### Stage A — Company hard rules
Use deterministic checks first on company-level fields.

Strong disqualifiers:
- Company Staff Count Range indicates 1 employee / solo founder / one-person company
- Website is offline, unreachable, or too weak to verify the company
- Company Country or inferred office location is in India, Pakistan, Bangladesh, or Philippines
- Company clearly indicates services, consulting, agency, outsourcing, or project-based work
- Company is B2C-only with no clear pricing or no evidence of B2B product fit

Soft negatives:
- Company industry is outside Tech / Software / SaaS / Cloud / AI / Security / Data signals
- ambiguous website content
- weak or missing company footprint
- duplicate or outdated domain

### Stage B — AI company scoring
Only score records that are not immediately disqualified or that need category interpretation.
AI should assess:
- whether the company is product-led or service-led
- likely product type
- fit to TeleStar ICP
- quality of company evidence
- short reasoning
- confidence level

### Suggested score bands
- 0–29: not relevant
- 30–49: weak fit
- 50–69: possible fit, review needed
- 70–84: strong fit
- 85–100: very strong fit

### Stage C — Lead filtering later
After company qualification is done, use lead-level data to rank contacts inside qualified companies.
Lead-level scoring should only run on companies already marked qualified or uncertain.

## 7) Learning Loop
The tool must support feedback input from the user:
- qualified / unqualified verdict
- corrected company type
- corrected score
- notes

Store feedback as training examples for:
- prompt refinement,
- rule tuning,
- future model training,
- evaluation benchmarks.

## 8) Token Optimization Requirements
- Run local rules before calling AI
- Batch records for scoring
- Cache results by company domain/name
- Avoid sending full CSV to model
- Use structured JSON outputs only
- Reuse prior feedback examples as few-shot data only when needed

## 9) UI Requirements
### Main screens
1. Upload company CSV
2. Map company columns
3. Run company filtering and scoring
4. Review company-level results
5. Save corrections and feedback
6. Only then open lead-level filtering for qualified companies

### Result table should show
- company name
- website
- country
- company type
- score
- qualification
- reason
- summary
- note/review button

### Optional review filters
- show only qualified
- show only uncertain
- show only not relevant
- filter by company type
- filter by score range

## 10) Technical Stack Suggestion
- Frontend: Next.js + Tailwind + shadcn/ui
- CSV parsing: PapaParse
- Backend API: Node.js / Next.js API routes
- DB: Postgres
- Cache: Redis
- Queue/background jobs for large files
- AI: OpenAI Responses API with structured outputs

## 11) Success Criteria
The tool is successful if it:
- reduces manual screening time,
- keeps AI usage low,
- improves scoring quality after feedback,
- handles 30k+ leads reliably,
- produces consistent structured outputs.

## 12) Build Order
1. PRD
2. SKILL.md for Codex
3. Data schema
4. Scoring engine
5. CSV import and column mapping
6. UI dashboard
7. Feedback loop
8. Evaluation and tuning

