# V1-ERA MOCK

This is a single-tenant, company-first, `Uncertain`-era mock. It is NOT the V2 model. V2 UI follows `docs/v2/plan/V2_UIUX_DESIGN_SPEC_FULL.md`: multi-ICP Context Bar, LeadAssignment-centered workflow, and no canonical `UNCERTAIN` state.

# TeleStar Company-First Tool — UI/UX Flow

## 1) Product Goal
The interface should help the team upload a company CSV, map columns quickly, review scoring results, correct labels, and export a cleaned company list.

The design should feel fast, simple, and practical for daily filtering work.

---

## 2) Primary User Journey
1. Open dashboard
2. Upload company CSV
3. Preview detected columns
4. Map CSV columns to canonical fields
5. Run scoring
6. Watch job progress
7. Review scored companies in a table
8. Edit type / note / score if needed
9. Save feedback
10. Export filtered results

---

## 3) Main Screens

### A. Dashboard
Purpose: show upload history and current status.

Components:
- primary CTA: Upload CSV
- recent uploads list
- total companies processed
- qualified count
- not relevant count
- uncertain count
- feedback count

Useful actions:
- resume an in-progress job
- open previous result set
- export last qualified list

---

### B. Upload Screen
Purpose: let the user upload a company CSV.

Components:
- drag-and-drop upload area
- file size and row count preview
- supported file format note
- upload validation messages

Validation checks:
- CSV only
- required minimum headers detected
- duplicate file detection if needed

---

### C. Column Mapping Screen
Purpose: connect uploaded columns to canonical company fields.

Required mappings:
- Company Name
- Website
- Company Country
- Company LinkedIn URL
- Company Industry
- Company Phone 1
- Company Staff Count Range

Optional mappings:
- notes / tags / comments

UX details:
- auto-suggest the most likely column matches
- allow manual override
- show preview rows beside the mapping panel
- highlight unmapped critical fields in red
- allow skipping optional fields

---

### D. Scoring Progress Screen
Purpose: show live processing state while the job runs.

Components:
- progress bar
- rows processed / total rows
- qualified / rejected / uncertain counts
- current row being processed
- estimated time remaining
- error log if any rows fail

UX details:
- avoid blocking the user
- allow the user to leave the page and come back later
- auto-refresh results in the background

---

### E. Company Results Screen
Purpose: review, sort, filter, and edit company scores.

Table columns:
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

Filter controls:
- qualification dropdown
- type dropdown
- country dropdown
- score range slider
- search by company name or website

Table actions:
- open row detail drawer
- edit type
- edit score
- edit note
- mark qualified
- mark not relevant
- mark uncertain

---

### F. Company Detail Drawer / Side Panel
Purpose: explain why the model scored the company that way.

Sections:
- company identity
- current classification
- score breakdown
- reason text
- hard rule flags
- summary sentence
- raw input snapshot

Editing controls:
- override company type
- adjust score
- add reviewer note
- save feedback

---

### G. Export Screen
Purpose: export results in a clean CSV.

Options:
- full export
- qualified only
- uncertain only
- not relevant only
- selected rows only

Export columns:
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

### H. Feedback History Screen
Purpose: show how the model is improving over time.

Components:
- correction history table
- reviewer name
- predicted vs final label
- predicted vs final type
- timestamp
- search and filter by company or reviewer

Optional analytics:
- most common correction types
- type distribution
- score distribution before vs after review

---

## 4) Recommended Layout
### Global layout
- left sidebar for navigation
- top bar for upload state, user actions, and export button
- main content area for table and detail panels

### Table layout
- sticky header
- fixed first column for company name
- compact row height for dense review work
- expandable row or side drawer for explanation

### Visual style
- clean B2B dashboard style
- minimal color usage
- strong contrast for status tags
- neutral background with clear highlighted states

---

## 5) Status Colors / Labels
Use consistent labels across the app:
- Qualified
- Uncertain
- Not Relevant
- Needs Review
- Processing
- Failed

Avoid too many badge styles. Keep them readable at a glance.

---

## 6) Review Workflow
The review workflow should be extremely fast:
1. user opens uncertain row
2. reads reason and summary
3. edits type or score if needed
4. adds a short note
5. saves
6. row is written to feedback history

The default action should be the most common action the team takes.

---

## 7) Empty States
Design empty states for:
- no uploads yet
- upload in progress
- no results after filters
- no uncertain rows
- no feedback yet

Each empty state should guide the next action clearly.

---

## 8) Error States
Handle these gracefully:
- invalid CSV
- missing required columns
- file too large
- upload failed
- AI request failed
- website verification failed
- background job interrupted

Each error should show:
- what happened
- which file or row is affected
- what the user can do next

---

## 9) Mobile / Responsive Notes
This app is mainly desktop-first because row review is dense.

Still support:
- responsive sidebar collapse
- scrollable tables
- compact summary cards on smaller screens

---

## 10) First Build Priority
1. Dashboard
2. Upload screen
3. Column mapping screen
4. Results table
5. Detail drawer
6. Feedback save flow
7. Export flow
8. Feedback history

---

## 11) Acceptance Criteria
The UI/UX is ready when:
- a user can upload a CSV in under 1 minute
- column mapping is obvious and low-friction
- company scoring results are easy to scan
- edits can be saved without leaving the table
- exports are one click away
- the company-first workflow feels natural

