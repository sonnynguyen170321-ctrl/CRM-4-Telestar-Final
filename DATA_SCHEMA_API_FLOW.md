# TeleStar Company-First Tool — Data Schema & API Flow

## 1) Core Objects
The app should be built around these objects:
- UploadJob
- CompanyRecord
- CompanyScore
- FeedbackExample
- LeadRecord (later phase)

The first release should fully support UploadJob, CompanyRecord, CompanyScore, and FeedbackExample.
LeadRecord can be added after company scoring is stable.

---

## 2) Database Schema

### A. upload_jobs
Tracks each CSV upload.

Fields:
- id: uuid / string
- file_name: string
- file_size: integer
- status: queued | processing | completed | failed
- total_rows: integer
- processed_rows: integer
- qualified_rows: integer
- rejected_rows: integer
- uncertain_rows: integer
- created_by: string / user id
- created_at: timestamp
- completed_at: timestamp nullable
- error_message: text nullable

### B. company_records
Stores normalized company rows from CSV.

Fields:
- id: uuid / string
- upload_job_id: foreign key
- company_name: string
- website: string nullable
- company_country: string nullable
- company_linkedin_url: string nullable
- company_industry: string nullable
- company_phone_1: string nullable
- company_staff_count_range: string nullable
- raw_row_json: json
- normalized_row_json: json
- created_at: timestamp

### C. company_scores
Stores model and rule results for each company.

Fields:
- id: uuid / string
- company_record_id: foreign key
- qualification: qualified | unqualified | uncertain
- company_type: Not Relevant | PAAS | SAAS | Cloud | ITO | Data Solution | AI Solution | AI Service | Cyber Security | Blockchain Solution
- company_score: integer 0–100
- confidence: decimal 0.0–1.0
- reason: text
- one_sentence_company_summary: text
- hard_rule_flags_json: json
- model_name: string nullable
- model_version: string nullable
- scoring_source: rules | ai | rules_plus_ai
- created_at: timestamp
- updated_at: timestamp

### D. feedback_examples
Stores human corrections for learning.

Fields:
- id: uuid / string
- company_record_id: foreign key
- predicted_company_score: integer nullable
- predicted_company_type: string nullable
- predicted_qualification: string nullable
- final_company_score: integer nullable
- final_company_type: string nullable
- final_qualification: string nullable
- final_note: text nullable
- reviewer: string nullable
- created_at: timestamp

### E. lead_records (later phase)
Only needed after company scoring is stable.

Fields:
- id: uuid / string
- company_record_id: foreign key
- lead_name: string nullable
- title: string nullable
- contact_linkedin_url: string nullable
- contact_country: string nullable
- department: string nullable
- seniority: string nullable
- email_validation: string nullable
- email_2: string nullable
- phone_1: string nullable
- phone_2: string nullable
- raw_row_json: json
- created_at: timestamp

### F. lead_scores (later phase)

Fields:
- id: uuid / string
- lead_record_id: foreign key
- lead_score: integer 0–100
- qualification: qualified | unqualified | uncertain
- reason: text
- confidence: decimal 0.0–1.0
- created_at: timestamp

---

## 3) Normalization Rules
Normalize inputs before scoring.

### Company normalization
- trim spaces
- lowercase website domain for dedupe
- normalize country names to a canonical list
- convert company size range into a structured min/max where possible
- remove duplicate rows by normalized company name + domain
- keep original raw row for auditability

### Deduplication rules
Prefer this order:
1. normalized website domain
2. company name + country
3. company LinkedIn URL

---

## 4) API Flow

## A. Upload CSV
### Endpoint
`POST /api/uploads`

### Purpose
Create a new upload job and store the file.

### Steps
1. receive file
2. create upload_job row
3. parse CSV headers
4. return mapping suggestions

### Response
- upload_job_id
- detected_columns
- preview_rows

---

## B. Map Columns
### Endpoint
`POST /api/uploads/:id/map-columns`

### Purpose
Save canonical mapping between uploaded columns and expected company fields.

### Inputs
- company_name_column
- website_column
- company_country_column
- company_linkedin_url_column
- company_industry_column
- company_phone_column
- company_staff_count_column

### Response
- success
- mapped_fields

---

## C. Start Scoring Job
### Endpoint
`POST /api/uploads/:id/run`

### Purpose
Start processing the company rows.

### Pipeline
1. parse rows
2. normalize each company
3. run hard rules
4. send uncertain rows to AI
5. save results
6. update job progress

### Notes
This should run as a background job for large files.

---

## D. Get Upload Status
### Endpoint
`GET /api/uploads/:id`

### Purpose
Show live progress.

### Response
- status
- total_rows
- processed_rows
- qualified_rows
- rejected_rows
- uncertain_rows
- error_message

---

## E. List Company Results
### Endpoint
`GET /api/uploads/:id/results`

### Purpose
Return scored company rows with filtering and pagination.

### Query params
- qualification
- company_type
- country
- score_min
- score_max
- search
- page
- page_size

---

## F. Save Human Feedback
### Endpoint
`POST /api/company-scores/:id/feedback`

### Purpose
Store manual correction.

### Inputs
- final_company_score
- final_company_type
- final_qualification
- final_note

### Response
- saved

---

## G. Re-score Company
### Endpoint
`POST /api/company-scores/:id/rescore`

### Purpose
Re-run scoring after a manual correction or rule update.

---

## 5) Scoring Pipeline

### Step 1 — Parse and normalize
Extract company-level fields from each row.

### Step 2 — Hard-rule pass
Immediately mark rows using deterministic rules.

### Step 3 — AI pass for uncertain rows
Only call AI if:
- the website is accessible,
- the company is not already disqualified,
- the type is not obvious from rules,
- the score needs confidence-based classification.

### Step 4 — Save final output
Write to `company_scores`.

### Step 5 — Feedback loop
Store corrections and add them to training/eval data.

---

## 6) AI Request Design
The AI request should include only the minimum required fields:
- company_name
- website
- company_country
- company_industry
- company_staff_count_range
- company_linkedin_url
- extracted website signals if available

The model must return structured JSON only.

### Required JSON fields
- company_score
- qualification
- company_type
- reason
- one_sentence_company_summary
- confidence
- hard_rule_flags

---

## 7) Token-Saving Strategy
- never send full CSV rows to the model
- score by company, not by lead, in v1
- cache by domain and company name
- use hard rules before model calls
- only send ambiguous rows to AI
- batch uncertain rows together where possible
- store model output and reuse it for duplicates

---

## 8) Frontend Data Flow
1. user uploads file
2. app previews headers
3. user maps columns
4. app runs company scoring
5. user reviews results in a table
6. user edits any row and saves feedback
7. app exports cleaned company list
8. later, app opens lead scoring using qualified companies only

---

## 9) Export Format
The export should support:
- CSV
- filtered CSV
- qualified-only CSV
- review-only CSV

Recommended export columns:
- Company Name
- Website
- Company Country
- Type
- Note
- Score
- Qualification
- Confidence
- Summary

---

## 10) Implementation Priority
1. UploadJob schema
2. CompanyRecord schema
3. Company scoring engine
4. Result table UI
5. Feedback capture
6. Export
7. Lead-level phase

---

## 11) Acceptance Criteria
The schema and API layer are complete when:
- CSV upload works
- columns can be mapped
- company scoring results are saved
- hard rules work without AI where possible
- AI is only called for uncertain rows
- feedback is stored
- results can be exported
- the company-first workflow is stable enough to unlock lead filtering later

