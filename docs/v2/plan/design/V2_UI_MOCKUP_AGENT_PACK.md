# TeleStar SDR OS V2 — UI Mockup Agent Pack

**File purpose:** A detailed design prompt/spec for generating mockups and guiding Codex/Claude/Figma/Weavy agents to implement TeleStar SDR OS V2 UI **without drifting into generic dashboard UI**.

Use this as the repo source of truth:

```txt
docs/v2/design/V2_UI_MOCKUP_AGENT_PACK.md
docs/v2/design/mockups/
```

---

## 0) How Agents Must Use This

### For image/mockup agents
Use the prompt packages in **Section 8**.

Recommended flow:
1. Generate **3 large board images**.
2. Generate **17 page slices**.
3. Generate **drawer slices** for high-risk details.

### For Codex/Claude coding agents
Do **not** code immediately.

The agent must:
1. Read this markdown file.
2. Inspect all mockup images.
3. Inspect existing UI components/routes.
4. Produce a plan only.
5. Wait for approval.
6. Code phase by phase.

---

## 1) Non-Negotiable Product Logic

These are product truths, not optional design notes.

- **LeadAssignment is the scoring unit.**
- Same company may appear across different ICPs.
- Same company should appear only once per ICP in a scoped LeadAssignment context.
- Company intelligence exists, but scoring happens on LeadAssignment.
- Qualification is separate from `workflowStatus`.
- `NOT_SCORED` is derived/read-model/UI state only.
- Do **not** use `UNCERTAIN`.
- Use `NEEDS_REVIEW`.
- AI is advisory-only.
- AI never silently overwrites final qualification.
- Outreach send must pass suppression and sender-health checks.
- Important changes must be auditable.

### UI must serve three users

**CEO**
- Funnel, ROI, meetings, team health, account health.

**Manager**
- ICP authoring, review queue, feedback, team measurement, governance.

**Lazy SDR**
- Open one lead and instantly know:
  - what the company does
  - why it scored this way
  - who to contact
  - what to do next
  - what outreach to approve

---

## 2) Global Visual Contract

### Visual style
Clean modern B2B SaaS admin UI.

Reference feel:
- Linear density
- Airtable table clarity
- HubSpot CRM utility
- Clay-style enrichment and scoring surfaces
- Salesloft/Apollo style outreach operations

### Required look
- Light mode only
- Background: `#F8FAFC`
- Surface: `#FFFFFF`
- Border: `#E5EAF2`
- Text: `#0F172A`
- Muted: `#64748B`
- Primary: `#0F5BF4`
- Success: `#16A34A`
- Warning: `#F59E0B`
- Error: `#EF4444`
- Purple: `#7C3AED`
- Teal: `#14B8A6`
- Amber: `#D97706`

### Required density
- Compact stat cards
- Compact data tables
- Filter panels
- Right-side drawers
- Tabbed detail panels
- Score rings
- Status badges
- Minimal whitespace
- Subtle borders, not heavy shadows

### Do not
- Do not make a marketing website.
- Do not make a landing page.
- Do not use dark mode.
- Do not use generic dashboard templates.
- Do not remove operational tables.
- Do not hide drawers.
- Do not use random gradients.
- Do not make cards oversized.

---

## 3) Global App Shell

Every screen should share the same shell.

### Sidebar
Include:
- Telestar mark/icon
- `TeleStar`
- `SDR OS V2`
- Navigation:
  - Home
  - Accounts
  - Projects
  - ICP Library
  - Companies
  - Contacts
  - Leads
  - Lead Assignments
  - Activity Recaps
  - Review Queue
  - Outreach
  - Reports
  - AI Insights
  - Settings
  - Admin

Active nav:
- pale blue background
- blue text/icon
- rounded row

### Topbar
Include:
- Global search:
  - `Search across accounts, projects, ICPs, companies, contacts, leads...`
- Workspace selector:
  - `AC Acme Global`
- Buttons:
  - `Upload Data`
  - `Run AI Insight`
- Optional notification/avatar

### Component primitives
The implementation should reuse:
- `AppShell`
- `Sidebar`
- `Topbar`
- `ContextBar`
- `PageHeader`
- `StatCard`
- `FilterPanel`
- `DataTable`
- `StatusBadge`
- `QualificationBadge`
- `WorkflowBadge`
- `ScoreRing`
- `DetailDrawer`
- `Tabs`
- `ActionButton`
- `UploadDropzone`
- `Stepper`
- `Timeline`
- `EvidenceCard`
- `AuditSnapshotCard`
- `SequenceCanvasNode`
- `SuppressionGateCard`
- `SenderHealthCard`

---

# 4) PAGE 1 / 3 — CORE WORKSPACES

## Board name
```txt
TeleStar SDR OS V2 — PAGE 1 / 3 — CORE WORKSPACES
```

## Board layout
```txt
Row 1:
- Home / Executive Workspace
- Accounts / Client Account Portfolio

Row 2:
- Projects / Engagement Workspace
- ICP Library / Profile + Version Builder

Row 3:
- System Reference / ICP Preview + Design Tokens full width
```

---

## 4.1 Home / Executive Workspace

Route:
```txt
/v2/home
```

Purpose:
CEO/manager overview of the whole SDR OS.

Header:
```txt
01 Home / Executive Workspace
Operating snapshot across SDR OS.
```

Top metric cards:
```txt
Active Accounts: 24
Active Projects: 38
Published ICPs: 56
Companies in Review: 142
Leads Assigned: 612
Meetings Booked: 27
AI Insights: 129
```

Main blocks:

### Pipeline Funnel
Show:
- Total Leads: 8,742
- Qualified: 2,341
- In Progress: 1,214
- Meeting Set: 486
- Win Rate: 2.1%

Visual:
- compact funnel or stacked horizontal bars
- green for healthy progression
- orange/red for risk

### Recent Projects
Columns:
- Project
- Account
- Stage
- Health
- Owner
- Due Date

Rows:
- Q2 Pipeline Acceleration
- AI Meeting Assistant
- Data Enrichment Program
- Cloud Security Launch
- Healthcare Growth ICP

### Next Actions
Items:
- Review 18 manager items
- Respond to 5 company updates
- Run AI Insight for 3 projects
- Upload new data
- Generate weekly recap

### AI Insights Snapshot
Items:
- Open insights
- Dismissed
- At-risk accounts
- Fresh recommendations

### Data Health
Items:
- Coverage
- Freshness
- Accuracy
- Duplicates

### Team Activity Today
Items:
- Jordan published ICP
- Taylor assigned leads
- Riley booked meeting
- AI generated cloud security insight

QA:
- Must feel like operating cockpit.
- Do not make it just a table.
- Cards must be dense and meaningful.

---

## 4.2 Accounts / Client Account Portfolio

Route:
```txt
/v2/accounts
```

Purpose:
Account-level CRM portfolio.

Header:
```txt
02 Accounts / Client Account Portfolio
Top-level CRM for client accounts and active engagements.
```

Metric cards:
```txt
Total Accounts
Active Projects
Published ICPs
Open Leads
Meetings
Manager Reviews
```

Filter panel:
- Region
- Owner
- Industry
- Account Health
- Team
- Status
- Last Activity
- Meeting Status

Main table columns:
- Account
- Owner
- Region
- Health
- Projects
- ICPs
- Open Leads
- Meetings
- Last Activity

Sample rows:
```txt
Acme Global / Alex Rivera / NA / Healthy / 8 / 14 / 612 / 27 / 2h
BrightWave / Jordan Lee / NA / Healthy / 6 / 9 / 284 / 11 / 3h
NorthStar / Taylor Morgan / EMEA / At Risk / 5 / 11 / 168 / 5 / 5h
CloudCore / Jamie Chen / APAC / Healthy / 3 / 6 / 92 / 2 / 1d
```

### Account Drawer
Title:
```txt
Acme Global
```

Subtitle:
```txt
Account drawer: Overview / Projects / Offers / ICPs / Activity / Feedback / Data Log
```

Tabs:
- Overview
- Projects
- Offers
- ICPs
- Activity
- Feedback
- Data Log

Cards:

**Account Overview**
- Owner: Alex Rivera
- Region: North America
- Industry: Technology
- Lifecycle: Active
- Account tier: Enterprise
- Primary contact: Ava Chen

**Account Health**
- Health score: 84
- Renewal risk: Low
- Last sync: May 12
- Active projects: 8
- Open risks: 2
- Coverage: Good

**Active Projects**
- Q2 Pipeline Acceleration
- Cloud Security Launch
- AI Meeting Assistant
- Data Enrichment Program

**Offers / Products**
- SDR Outsourcing
- AI Meeting Assistant
- Lead Research Service
- Data Enrichment

**Recent Activity**
- Alex updated project
- Jordan published new ICP
- Taylor assigned 45 leads
- Riley booked meeting

**Quick Actions**
- Open Account
- Create Project
- View Companies
- Add Offer/Product
- Generate Account Brief

QA:
- Drawer must be detailed.
- This is CRM, not analytics-only.

---

## 4.3 Projects / Engagement Workspace

Route:
```txt
/v2/projects
```

Header:
```txt
03 Projects / Engagement Workspace
Manage project execution and offer coverage.
```

Selected project:
```txt
Q2 Pipeline Acceleration
```

Status:
```txt
Active
```

Context fields:
- Account: Acme Global
- Owner: Jordan Lee
- Stage: In Progress
- Timeline: Apr 15 – Jun 30
- Team avatars

Right stat cards:
- Companies
- Open Leads
- Meetings
- MQLs
- SQLs
- Win Rate

### Offer / Product × ICP Coverage Matrix
Rows:
- AI Meeting Assistant
- SDR Outsourcing
- Lead Research Service
- Data Enrichment

Columns:
- Mid-Market SaaS
- ICP: Series B Growth
- ICP: FinTech Scaleups
- ICP: Healthcare Payers
- Global Manufacturers
- Coverage %

Cell states:
- Full match
- Partial match
- No match
- Not assessed

### Pipeline Snapshot
- Leads assigned
- Open leads
- Meetings booked
- MQLs
- SQLs
- Win rate

### Recent Project Activity
- Taylor assigned new leads
- Riley booked a meeting
- AI generated project insight
- Jordan published ICP
- Weekly recap generated

### Next Actions
- Review 12 high-intent leads
- Add coverage for 2 ICPs
- Run AI Insight
- Weekly project recap

### Shortcuts
- Add Offer/Product
- Link ICP
- Assign Leads
- View Companies
- Project Report
- Edit Project Settings

Optional Project Drawer:
Tabs:
- Overview
- Products
- ICPs
- Companies
- Leads
- Activity
- Reports
- Settings

---

## 4.4 ICP Library / Profile + Version Builder

Routes:
```txt
/v2/icp-library
/v2/icp-library/[id]/edit
/v2/icp-library/[id]/test
```

Header:
```txt
04 ICP Library / Profile + Version Builder
Manage ideal customer profiles, examples, exclusions and scoring rules.
```

Left library list:
- Search ICPs
- New ICP button
- Account group headers

Rows:
- Mid-Market SaaS RevOps Teams — DRAFT
- Cloud Security Platform Teams — PUBLISHED
- Data Infrastructure Teams — PUBLISHED
- IT Operations Leadership — ARCHIVED

Center panel:
```txt
Mid-Market SaaS RevOps Teams
DRAFT
```

Actions:
- Save Draft
- Duplicate Version
- Submit for Approval

Tabs:
- Overview
- Attributes
- Signals
- Notes
- Activity Log

Cards:

**Company Attributes**
- ARR $10M–$250M
- SaaS business
- 50–1,000 employees
- US, Canada, UK, Australia
- Active revenue team

**Target Persona**
- VP Sales
- Head of RevOps
- Chief Revenue Officer
- Demand Gen Director
- Marketing Ops

**Pain Points**
- Disconnected data
- Manual reporting
- Low attribution visibility
- Sales/marketing handoff gaps
- Pipeline quality issues

**Exclusions**
- Agencies / consultancies
- Very small businesses
- No clear B2B motion
- Offline-only companies
- Job boards / marketplaces without sales org

**Positive Signals**
- Hiring SDR / RevOps roles
- CRM / marketing automation stack
- Funding or expansion
- New GTM leadership
- Active content about pipeline growth

**Negative Signals**
- No website
- No team size signal
- Only local service business
- No buyer persona match
- Outdated site

**Good Fit Examples**
- BrightWave Digital
- CloudScale Inc.
- DataNimbus

**Bad Fit Examples**
- Local print shop
- Freelancer studio
- Generic agency

Right panel:
- Draft v1.3 current
- Published v1.2
- Archived v1.1
- Approval pending
- Diff vs previous

Version comparison:
- Draft v1.3 vs Published v1.2
- ARR range changed
- Geography added
- Negative signals added
- Examples updated
- Exclusion rules updated

---

## 4.5 System Reference / ICP Preview + Design Tokens

Purpose:
Source-of-truth area at bottom of Page 1.

Blocks:

**ICP Preview / Dry Run**
- ICP selector
- Sample assignment scoring
- Companies matched
- High fit
- At risk
- Low fit
- Not scored

Preview table columns:
- Company
- Fit Score
- Intent
- Fit Tier
- Qualification
- workflowStatus

Rows:
```txt
Acme Global / 87 / High / High / Qualified / IN_PROGRESS
BrightWave / 74 / Medium / Medium / Needs Review / OPEN
NorthStar / 49 / Low / Low / Unqualified / NOT_QUALIFIED
```

**Scoring Components / Weights**
- Fit score model 60%
- Intent signal strength 25%
- Data health multiplier 10%
- Recency/freshness 5%
- Total 100%

**Design Tokens / Core**
- Primary #0F5BF4
- Success #16A34A
- Warning #F59E0B
- Danger #EF4444
- Info #0EA5E9
- Shadow subtle
- Borders first
- Radius XS / SM / MD / LG

**Status Pairs**
- Success / On Track
- Warning / At Risk
- Info / Needs Review
- Danger / Blocked

**Typography / Spacing**
- H1 28/36
- H2 20/28
- H3 16/24
- Body 12/18
- Caption 11/16
- Grid 4 / 12 / 24

**Icon Style**
- Line icons 20px
- Rounded stroke
- SaaS admin style
- No emoji product icons
- Consistent sidebar/action/table icons

Prominent note:
```txt
LeadAssignment is the scoring unit.
Qualification is separate from workflowStatus.
NOT_SCORED is derived only.
Use NEEDS_REVIEW instead of UNCERTAIN.
AI is advisory-only.
```

---

# 5) PAGE 2 / 3 — LEADASSIGNMENT, INGESTION & CRM OPERATIONS

## Board name
```txt
TeleStar SDR OS V2 — PAGE 2 / 3 — LEADASSIGNMENT, INGESTION & CRM OPERATIONS
```

## Board layout
```txt
Row 1:
- LeadAssignment Workspace
- Lead Upload + Multi-ICP Scoring
- LeadAssignment Detail Drawer

Row 2:
- Ingestion Job Detail / Row Inspector
- Uploads / Data Uploads

Row 3:
- Companies Review Workspace
- Contacts Workspace
```

---

## 5.1 LeadAssignment Workspace

Route:
```txt
/v2/leads
```

Purpose:
Primary SDR cockpit.

Header:
```txt
01 LeadAssignment Workspace /v2/leads
Primary SDR cockpit: same company can appear once per ICP.
```

Context bar:
- Account: Acme Global
- Project: Cloud Security Launch
- Offer/Product: Cloud Security Platform
- ICP: Cloud Security 100–1,000
- Due Range: Last 7 Days

Metric cards:
```txt
Total LeadAssignments: 12,842
Qualified: 3,642
Needs Review: 4,981
Company Qualified Needs Contact: 1,876
Unqualified: 1,562
Not Scored: 1,203
Meeting Booked: 612
```

Filter panel:
- Qualification
- Workflow Status
- Score
- Owner / SDR
- Source
- Country
- ICP
- Confidence
- Has Contact
- Meeting status

Table columns:
- Checkbox
- Company
- Contact
- ICP
- Score
- Qualification
- Confidence
- Workflow Status
- Last Activity
- Row actions

Sample rows:
```txt
CloudScale Inc. / Sarah Mitchell / Cloud Security 100–1,000 / 92 / Qualified / High / Ready / 2h ago
DataNimbus / James Carter / Cloud Native 100–1,000 / 88 / Qualified / High / Scheduled / 3h ago
SecureStack / Priya Desai / Cloud Security 100–1,000 / 76 / Qualified / Medium / In Progress / 5h ago
PixelPoint / Michael Chen / Cloud Security 100–1,000 / 71 / Qualified / Medium / Needs Contact / 6h ago
BluePeak Systems / Elena Rivera / FinServ / 63 / Needs Review / Medium / Ready / 1d ago
InfraNova / David Lopez / Cloud Ops / 50 / Needs Review / Low / Needs Review / 1d ago
Northwind Labs / Anna Petrov / Cloud Ops / 44 / Unqualified / Low / Not Started / 2d ago
Zenith Tech / Daniel Kim / Cloud Security / 34 / Unqualified / Low / Not Started / 2d ago
Vector Ops / Chris Martin / Cloud Ops / 28 / Unqualified / Low / Not Started / 3d ago
BrightEdge / Fiona Dubois / Cloud Growth / 81 / Qualified / High / Booked / 3h ago
```

Side cards:

**Bulk Actions**
- Re-score selected
- Export filtered
- Assign owner
- Start outreach
- Convert to feedback

**Saved Views**
- My qualified leads
- Needs action
- No contact found
- High score no outreach
- Meeting booked

QA:
- This must feel like central cockpit.
- ICP column must be visible.
- Qualification and workflowStatus must be separate.
- No `UNCERTAIN`.

---

## 5.2 Lead Upload + Multi-ICP Scoring

Route options:
```txt
/v2/leads/upload
/v2/uploads/new
/v2/leads?mode=upload
```

Header:
```txt
02 Lead Upload + Multi-ICP Scoring
```

Stepper:
1. Upload File
2. Confirm Mapping
3. Select ICPs
4. Run Enrichment
5. Run Scoring
6. Review Results

Upload card:
- Dropzone
- File formats: CSV, XLSX
- Button: Choose File
- Example filename: `Acme_Prospects_May2025.csv`

Upload Settings:
- Deduplicate by: Company Domain + Email
- Source: Outbound List
- Default Owner: Unassigned
- Description: Q2 outbound list from marketing

Mapping preview columns:
- Uploaded Column
- Suggested Field
- Confidence
- Required?
- Sample Value

Fields:
- Company Name
- Website / Domain
- Contact Name
- Title
- Email
- LinkedIn
- Country
- Notes

Multi-ICP selector:
- Account selector
- Project selector
- Offer/Product selector
- ICP multi-select

Selected ICPs:
- Cloud Security 100–1,000
- Mid-Market SaaS RevOps
- FinTech Scaleups

Options:
- Apply all ICPs to all rows
- Apply ICPs by segment
- Skip rows with missing website
- Run website research before scoring

Daily Budget / Guardrails:
- Daily budget: $300
- Max rows per day: 10,000
- Used today: 2,536
- Estimated credits: 1,184
- AI mode: Needs Review only

Run History table:
- Run
- File
- ICPs
- Rows
- Enriched
- Scored
- Status
- Duration

CTA:
- Next: Confirm Mapping

---

## 5.3 LeadAssignment Detail Drawer

Purpose:
The lazy SDR’s main experience.

Drawer answers:
- What is this company?
- Why did it score this way?
- Who should I contact?
- What evidence supports this?
- What is the next best action?
- Can I start outreach now?

Title:
```txt
CloudScale Inc.
```

Subtitle:
```txt
Cloud Native SaaS · Qualified · Ready · LeadAssignment ID LA-002138
```

Actions:
- Re-score
- Mark Reviewed
- Start Outreach

Tabs:
- Overview
- Why Score
- Contacts
- Activity
- Feedback
- Data Log

### Overview tab cards

**Company Brief**
- What the company does
- What they sell
- Who they sell to
- Why they are hot
- Source links

Example:
```txt
CloudScale provides cloud security posture management and compliance automation for mid-market SaaS teams.
Sells to VP Engineering, Security, Compliance and IT operations leaders.
Recent site activity suggests expansion into cloud-native security operations.
Sources: homepage, careers page, LinkedIn, pricing/about page.
```

**Reason Breakdown**
- ICP Fit: 25/30
- Buyer Intent: 25/30
- Tech Fit: 20/20
- Data Health: 12/15
- Rule Sensitivity: 10/10

**Key Info**
- Assigned SDR: Alex Rivera
- Workflow: Ready
- Qualification: Qualified
- Confidence: High
- Last Activity: 2h ago
- Source: CSV upload + website enrichment

**Signals**
Positive:
- Funding in last 18 months
- Hiring keyword: Cloud Security
- 10+ employees on LinkedIn
- Website has compliance/security language
- Active job openings

Negative:
- Limited pricing info
- No clear public CRM stack
- No recent press mention

**Score Components**
- Rule Based: 68
- AI Research: 94
- Total Score: 92/100
- Confidence: High
- Evidence freshness: Good

**Next Best Action**
- Send personalized intro email to Sarah Mitchell.
- Use cloud security + compliance pain angle.
- Mention hiring/security expansion signal.

CTA:
- Start Outreach
- View Suggested Email

### Why Score tab
- Hard gates
- Positive fact tokens
- Negative fact tokens
- Evidence source links
- ICP match matrix
- Score calculation breakdown

### Contacts tab
Columns:
- Contact
- Title
- Source
- Status
- Last Activity
- Email Valid
- LinkedIn
- Owner

### Activity tab
Timeline:
- Lead uploaded
- Website enrichment completed
- ICP score calculated
- Review passed
- Outreach draft generated

### Feedback tab
- SDR final review
- Manager note
- Convert to learning example
- Correction reason

### Data Log tab
Snapshots:
- Raw input row
- Normalized company
- Website research
- Scoring assessment
- AI insight
- Final review

---

## 5.4 Ingestion Job Detail / Row Inspector

Route:
```txt
/v2/ingestion/[jobId]
```

Header:
```txt
04 Ingestion Job Detail / Row Inspector
Deep debug: uploaded row → company → LeadAssignment → score.
```

Job header:
- Job ID: #105
- File: Acme_Prospects_May2025.csv
- Status: Completed
- Started by: Brooklyn Simmons
- Started at: May 29, 2025 10:24 AM
- Duration: 18m 32s

Progress cards:
- Rows Uploaded: 2,536
- Rows Parsed: 2,536
- Companies Matched: 2,176
- Companies Created: 178
- LeadAssignments Created: 2,176
- Enriched: 2,176
- Scored: 2,176
- Errors: 12

Pipeline:
```txt
Upload → Parse → Normalize → Identity Match → Company Upsert → LeadAssignment Upsert → Enrichment → Scoring → Review Queue → Done
```

Main row table columns:
- Row
- Company Raw
- Domain Raw
- Email
- Identity Match
- Company Upsert
- LeadAssignment
- Score
- Status

Right Row Inspector:
Tabs:
- Raw Row
- Normalized
- Identity
- Records
- Scoring
- Errors

Sections:
- Raw row JSON
- Normalized fields
- Identity confidence
- Candidate list
- Resolver decision
- Created/linked company
- Created LeadAssignment
- Enrichment result
- Scoring job status
- Error trace

QA:
This is not upload history. This is ingestion debugging.

---

## 5.5 Uploads / Data Uploads

Route:
```txt
/v2/uploads
```

Metric cards:
- Total Uploads: 42
- Completed: 27
- Processing: 3
- Failed: 2
- Archived: 10
- Rows Processed: 158,642

Upload dropzone:
- Drag & drop CSV file here
- Choose CSV File

Upload table:
- File Name
- Rows
- Uploaded By
- Uploaded At
- Status
- Progress
- Actions

Upload detail drawer:
Tabs:
- Overview
- Mapping
- Runs
- Errors
- AI Usage
- Audit

Cards:
- File summary
- Mapping completeness
- Processing status
- AI usage summary
- Open Leads
- Open Companies
- Retry Failed Rows
- Export Errors

---

## 5.6 Companies Review Workspace

Route:
```txt
/v2/companies
```

Metric cards:
- Total Companies: 12,842
- Qualified: 3,642
- Needs Review: 4,981
- Unqualified: 1,562
- Reviewed: 1,203
- Company Qualified Needs Contact: 1,876

Filters:
- Qualification
- Workflow Status
- Owner / SDR
- Country
- Industry
- Employee range
- Enrichment freshness

Table:
- Company
- Domain
- Employees
- Score
- Qualification
- Rule
- Last Activity
- Owner

Company drawer:
Title:
```txt
CloudScale Inc.
```

Tabs:
- Summary
- Contacts
- LeadAssignments
- Activity
- Evidence
- Data Log

Cards:
- Company summary
- ICP fit
- Buying intent
- Tech fit
- Enrichment freshness
- Cross-ICP LeadAssignments
- Open in CRM
- View all leads

Important:
Company drawer shows company-level intelligence but must not pretend company is the scoring unit.

---

## 5.7 Contacts Workspace

Route:
```txt
/v2/contacts
```

Metric cards:
- Total Contacts: 24,568
- Active: 12,418
- Meeting Booked: 846
- Ready to Outreach: 5,412
- Bounced: 1,023
- Do Not Contact: 849

Filters:
- Contact Status
- Seniority
- Email Status
- Owner / SDR
- Has Meeting
- Has LinkedIn
- Source

Table:
- Contact
- Title
- Company
- Status
- Email
- Owner
- Last Activity

Contact drawer:
Title:
```txt
Sarah Mitchell
```

Subtitle:
```txt
VP Sales · CloudScale Inc.
```

Tabs:
- Overview
- Activity
- Evidence
- Feedback
- Outreach
- Meetings

Cards:
- Overview
- Signals
- Linked LeadAssignments
- Meeting Booked
- Outreach history

---

# 6) PAGE 3 / 3 — OUTREACH, REVIEW & GOVERNANCE

## Board name
```txt
TeleStar SDR OS V2 — PAGE 3 / 3 — OUTREACH, REVIEW & GOVERNANCE
```

## Board layout
```txt
Row 1:
- Outreach Hub
- Auto Email Sequence Builder
- Suppression Center + Sender Accounts

Row 2:
- Manager Review Queue

Row 3:
- Feedback / Learning Loop
- AI Settings / Usage Health
- Audit Trail / Data Log
```

---

## 6.1 Outreach Hub

Route:
```txt
/v2/outreach
```

Header:
```txt
11 Outreach Hub /v2/outreach
Manual compose, monitor, sequence automation, templates, suppression, senders, analytics.
```

Tabs:
- Compose
- Sequences
- Monitor
- Templates
- Suppression
- Senders
- Analytics

### Manual Compose card
- Select LeadAssignment
- Verified contact
- Company brief & evidence
- Outreach angle
- Preview + send

Fields:
- LeadAssignment: LA-002138
- Company: BrightWave Digital
- Contact: Brittany Nelson
- ICP: Mid-Market SaaS RevOps
- Score: 87
- Qualification: Qualified
- Workflow: Ready

### Verified Contact card
- Brittany Nelson
- VP Marketing
- Email verified
- LinkedIn verified
- Contact health good
- Location: Denver, CO

### Company Brief & Evidence card
- short company summary
- employee count
- maturity
- services/products
- growth signals
- pain points
- recent activity
- View AI research

### Outreach Angle card
- Topic: Growth Expansion
- Rationale generated
- Value prop selected
- Choose different angle
- Personalization score

### Send Readiness Checklist
- LeadAssignment selected
- Contact verified
- Suppression passed
- Sender healthy
- Template variables valid
- Sequence rules satisfied

### Outreach Monitor table
Columns:
- Sent At
- To
- Company
- Sequence
- Step
- Status
- Next Send
- Replies
- Meeting

Rows:
- brittany@brightwave / BrightWave / Growth Expansion / Email 1 / Sent
- michael@clearview / ClearView / Finance Reporting / Email 1 / Replied / Meeting Booked
- sarah@stark / Stark / Marketing Scale / Email 1 / Bounced

Important:
Show both manual compose and monitoring.

---

## 6.2 Auto Email Sequence Builder

Route:
```txt
/v2/outreach/sequences/[id]
```

Header:
```txt
12 Auto Email Sequence Builder
Automated sequence canvas with per-step suppression gate and exit rules.
```

Left Step Library:
- Email
- LinkedIn Message
- Call Task
- SMS
- Wait
- Branch if/then
- Goal
- Upload Field
- Webhook

Center sequence canvas:
```txt
Start — Lead enters sequence
↓
Email 1 — Value + relevance
↓
Wait — 2 days
↓
Branch — If replied
  yes → Stop
  no → Continue
↓
Email 2 — Case study
↓
Wait — 2 days
↓
Email 3 — Breakup
↓
End — No response
```

Right Step Settings panel:
- Selected Step: Email
- Subject
- From account
- Template
- Variables
- Send window
- Rate limit
- Preview
- Test send

Safety Rules card:
- Stop on reply
- Stop on bounce
- Stop on meeting
- Stop if suppressed
- Daily sender limit
- Max touches per contact
- Do not enroll without verified email

Footer metrics:
- Enrolled contacts
- Open rate
- Reply rate
- Bounce rate
- Meetings booked

---

## 6.3 Suppression Center + Sender Accounts

Routes:
```txt
/v2/outreach/suppression
/v2/outreach/senders
```

Purpose:
Mandatory final gate before any send.

Suppression table:
- Identifier
- Type
- Reason
- Added By
- Expires
- Status

Rows:
- test@acme.com / Email / Hard Bounce / System / Never / Active
- vendor.com / Domain / Do Not Contact / Admin / Never / Active
- Acme Global / Company / Policy / Admin / Never / Active

Sender Accounts table:
- Sender
- Provider
- Health
- Daily Cap
- Sent Today
- Bounce Rate
- Warmup

Rows:
- alex@telestar.ai / Google / Healthy / 50 / 21 / 0.2% / Complete
- jordan@telestar.ai / Microsoft / Healthy / 50 / 18 / 0.1% / Complete
- riley@telestar.ai / Google / Warning / 40 / 36 / 1.1% / Week 3/4

Actions:
- Add Suppression
- Import Suppression List
- Add Sender
- Run Health Check

Suppression drawer:
Tabs:
- Details
- Scope
- Source
- Audit

Sender drawer:
Tabs:
- Overview
- Limits
- Health
- Recent Sends
- Audit

---

## 6.4 Manager Review Queue

Route:
```txt
/v2/reviews
```

Metric cards:
- Total in Queue: 152
- High Priority: 36
- Overdue: 28
- Due Today: 24
- Completed 7d: 96

Filters:
- Status
- Severity
- Type
- Owner
- Due date
- Source type
- Reason

Table columns:
- ID
- Type
- Company
- Reason
- Severity
- Status
- Owner
- Due Date

Rows:
- #2489 / Company / Invalid Industry / Company Match / Urgent / In Review / Jordan / May 22
- #2488 / Contact / BrightWave / Wrong title / High / In Review / Ava / May 23
- #2487 / Lead / NorthStar / Missing website / Medium / Pending / Riley / May 24

Review drawer:
Title:
```txt
#2489 Company Match
```

Subtitle:
```txt
Invalid Industry · candidate records · resolution form
```

Tabs:
- Details
- Context
- History
- Audit

Cards:
- Matched Records
- Evidence
- Recommended Next Action
- Resolution Form

Actions:
- Approve Match
- Reject
- Link Existing
- Create New
- Convert to Feedback
- Complete Review

---

## 6.5 Feedback / Learning Loop

Route:
```txt
/v2/feedback
```

Metric cards:
- Reviewed Examples: 1,248
- Corrections Made: 412
- Learning-worthy: 259
- Training Split: 70%
- Validation Split: 20%
- Test Split: 10%

Table:
- Company
- Predicted Score
- Final Score
- Decision
- Learning Flag
- Dataset Split
- Saved By

Rows:
- BrightWave / 87 / 90 / Keep / Learning-worthy / Training / Aisha
- NorthStar / 74 / 40 / Corrected / Correction / Validation / Michael
- DataNova / 66 / 75 / Keep / Learning-worthy / Training / Riley

Learning Guardrails:
- Feedback links to immutable assessment
- Rules are unchanged by AI
- Human approves tuning
- Training examples are explicitly flagged
- Corrections are auditable

Feedback drawer:
Tabs:
- Overview
- Original Assessment
- Human Review
- Learning Metadata
- Audit

---

## 6.6 AI Settings / Usage Health

Route:
```txt
/v2/settings/ai
```

AI Configuration:
- AI mode: Primary Provider
- Advisory-only: OpenAI
- Default model: gpt-4o-mini
- Max rows per upload: 100
- Backup provider: Anthropic
- AI scope: Needs Review only

Daily Usage:
- 1,248 / 2,000 credits
- 62% used
- Feature usage:
  - Company scoring
  - Research
  - Insights
  - Outreach drafts

AI Governance Rules:
- AI advisory only
- AI output appended to audit trail
- No silent overwrite of qualification
- Admin can override AI mode
- AI runs mostly on NEEDS_REVIEW
- PII policy shown in settings

AI event table:
- Time
- Feature
- Model
- Input Count
- Cost
- Status
- Owner

---

## 6.7 Audit Trail / Data Log

Routes:
```txt
/v2/account-data-log
/v2/audit
```

Audit table:
- Timestamp
- Actor
- Source
- Object
- Action
- Status

Rows:
- May 29 10:22 / Alex / Outreach / Email Send / Sent / Success
- May 29 10:45 / AI Engine / AI Insight / Company Score / Generated / Success
- May 29 11:10 / Jordan / Review / Approval Match / Approved / Success

Event Snapshots:
- Website Research
- Local Rule Result
- AI Insight
- Final Review
- Outreach Send
- Manager Resolution

Audit event drawer:
Tabs:
- Overview
- Before / After
- Related Records
- Raw Payload
- Evidence

Cards:
- Actor
- Timestamp
- Object
- Action
- Previous value
- New value
- Related LeadAssignment
- Related Company
- Related Contact
- Immutable snapshot link

---

# 7) Image Generation Packages

## Package A — Three Large Boards

### A1: Core Workspaces

```txt
Create a highly detailed enterprise SaaS dashboard mockup for TeleStar SDR OS V2 — PAGE 1 / 3 — CORE WORKSPACES.

Visual style: clean modern B2B SaaS admin UI, white surfaces, light slate background, blue primary actions, compact enterprise data density, similar to Linear + Airtable + HubSpot admin. Use Inter/system sans-serif. Rounded cards, subtle borders, minimal shadows, dense but readable tables. Light mode only.

Create one large design board containing multiple app screens arranged in a grid. Every screen uses the same shell: left sidebar with TeleStar logo and nav items, topbar with global search, workspace selector “AC Acme Global”, actions “Upload Data” and “Run AI Insight”.

Include these screens:
1. Home / Executive Workspace
2. Accounts / Client Account Portfolio with detailed Account Drawer
3. Projects / Engagement Workspace
4. ICP Library / ICP Profile + Version Builder
5. System Reference / ICP Preview + Design Tokens

Must show notes:
- LeadAssignment is the scoring unit
- Qualification is separate from workflowStatus
- NOT_SCORED is derived only
- No UNCERTAIN; use NEEDS_REVIEW
- AI is advisory-only

Do not create dark mode. Do not make it a landing page. It must look like an internal enterprise SaaS operating system.
```

### A2: LeadAssignment / Ingestion / CRM

```txt
Create a highly detailed enterprise SaaS dashboard mockup for TeleStar SDR OS V2 — PAGE 2 / 3 — LEADASSIGNMENT, INGESTION & CRM OPERATIONS.

Visual style: clean B2B SaaS admin UI, light background #F8FAFC, white cards, subtle borders #E5EAF2, primary blue #0F5BF4, compact tables, dense but readable layout, Inter/system font. Use badges, score rings, filters, drawers, and tabbed panels. Light mode only.

Create one large design board with multiple detailed screens:
1. LeadAssignment Workspace /v2/leads
2. Lead Upload + Multi-ICP Scoring
3. LeadAssignment Detail Drawer
4. Ingestion Job Detail / Row Inspector
5. Uploads / Data Uploads
6. Companies Review Workspace /v2/companies
7. Contacts Workspace /v2/contacts

Important product rule:
LeadAssignment is the scoring unit. One company can appear multiple times across different ICPs, but only once per ICP. Qualification is distinct from workflowStatus. NOT_SCORED is derived only. Do not use UNCERTAIN; use NEEDS_REVIEW.

The LeadAssignment Detail Drawer must be very detailed with tabs: Overview, Why Score, Contacts, Activity, Feedback, Data Log. Include Company Brief, Reason Breakdown, Key Info, Signals, Score Components, and Next Best Action.

The Ingestion Row Inspector must show: Raw row JSON, Normalized fields, Identity confidence, Candidate list, Resolver decision, Created/linked records, Scoring job status, Error trace.

Do not make the layout sparse. This is a dense operating workspace for managers and SDRs.
```

### A3: Outreach / Review / Governance

```txt
Create a highly detailed enterprise SaaS dashboard mockup for TeleStar SDR OS V2 — PAGE 3 / 3 — OUTREACH, REVIEW & GOVERNANCE.

Visual style: clean enterprise B2B SaaS admin UI. White cards, light slate background, blue primary actions, compact tables, clear badges, right-side drawers, dense operational layout. Use Inter/system font. Similar to Linear, Airtable, HubSpot, and modern sales engagement tools. Light mode only.

Create one large design board with multiple detailed screens:
1. Outreach Hub /v2/outreach
2. Auto Email Sequence Builder
3. Suppression Center + Sender Accounts
4. Manager Review Queue /v2/reviews
5. Feedback / Learning Loop
6. AI Settings / Usage Health
7. Audit Trail / Data Log

Product rules:
Outreach can only send after suppression and sender-health checks pass. AI is advisory-only and never silently overwrites final qualification. All important actions append to audit trail.

The Outreach Hub must include tabs: Compose, Sequences, Monitor, Templates, Suppression, Senders, Analytics. Include Manual Compose, Verified Contact, Company Brief & Evidence, Outreach Angle, Send Readiness Checklist, and Outreach Monitor table.

The Auto Email Sequence Builder must include left Step Library, center vertical sequence canvas, right Step Settings panel, and Safety Rules.

The Manager Review Queue must include a detailed right drawer with Matched Records, Evidence, Recommended Next Action, and Resolution Form.

Do not create a marketing website or landing page. This must look like an internal production-grade SaaS operating system for SDR teams.
```

---

## Package B — Page-Level Slices

Generate after Package A.

Recommended files:
```txt
01-home-executive-workspace.png
02-accounts-client-account-portfolio.png
03-projects-engagement-workspace.png
04-icp-library-version-builder.png
05-system-reference-icp-preview-design-tokens.png
06-leadassignment-workspace.png
07-lead-upload-multi-icp-scoring.png
08-leadassignment-detail-drawer.png
09-ingestion-job-row-inspector.png
10-uploads-data-uploads.png
11-companies-review-workspace.png
12-contacts-workspace.png
13-outreach-hub.png
14-auto-email-sequence-builder.png
15-suppression-center-senders.png
16-manager-review-queue.png
17-feedback-ai-audit-governance.png
```

Priority generation order:
1. `06-leadassignment-workspace.png`
2. `08-leadassignment-detail-drawer.png`
3. `09-ingestion-job-row-inspector.png`
4. `13-outreach-hub.png`
5. `14-auto-email-sequence-builder.png`
6. `16-manager-review-queue.png`
7. Remaining slices

---

# 8) Coding Agent Prompt

Use this after placing markdown and mockups in the repo.

```txt
CONTEXT:
We are implementing TeleStar SDR OS V2 UI from a design source pack inside the repo.

SOURCE OF TRUTH:
- docs/v2/design/V2_UI_MOCKUP_AGENT_PACK.md
- docs/v2/design/mockups/01-core-workspaces.png
- docs/v2/design/mockups/02-leadassignment-ingestion-crm.png
- docs/v2/design/mockups/03-outreach-review-governance.png
- optional slices in docs/v2/design/mockups/slices/

GOAL:
Rebuild the V2 UI to match the provided mockups as closely as practical using existing Next.js / React / Tailwind components.

FIRST TASK — PLAN ONLY:
Do not edit files yet.

Read:
1. docs/v2/design/V2_UI_MOCKUP_AGENT_PACK.md
2. all PNG mockups
3. existing V2 app shell, sidebar, topbar, table, card, drawer, badge, and route components
4. existing /v2 route structure

Then produce:
1. Existing UI file inventory
2. Missing component inventory
3. Route-by-route implementation plan
4. Component reuse plan
5. Exact files you propose to edit
6. Visual risks where exact pixel match may not be possible
7. Verification checklist

ALLOWED AFTER APPROVAL ONLY:
- app/v2/** route UI files
- components/v2/**
- components/shared/**
- app/globals.css only for design tokens if needed
- mock/static data files only if needed for UI preview

FORBIDDEN:
- Do not touch V1.
- Do not change database schema.
- Do not change Prisma migrations.
- Do not modify scoring logic.
- Do not modify Auth0 / tenant resolver logic.
- Do not invent new product states.
- Do not replace the design with a generic SaaS template.
- Do not code until the plan is reviewed.

VISUAL REQUIREMENTS:
- Match the mockups closely.
- Same layout rhythm: left sidebar, topbar, dense cards, compact tables, filter panels, right drawers.
- Use light mode only.
- Preserve enterprise density.
- Use blue primary action buttons.
- Use rounded cards and subtle borders.
- Avoid oversized whitespace.
- Avoid marketing landing-page style.
- Tables must remain central to the UI.

PRODUCT REQUIREMENTS:
- LeadAssignment is the primary scoring unit.
- One company may appear multiple times across different ICPs, but only once per ICP.
- Qualification is separate from workflowStatus.
- NOT_SCORED is derived UI state only.
- Do not use UNCERTAIN; use NEEDS_REVIEW.
- AI is advisory-only.
- Outreach send must pass suppression and sender-health checks.

IMPLEMENTATION PRIORITY:
1. UI kit primitives.
2. /v2/leads LeadAssignment Workspace.
3. LeadAssignment detail drawer.
4. Upload + multi-ICP scoring surface.
5. /v2/ingestion/[jobId] row inspector.
6. /v2/outreach hub + sequence builder + suppression/senders.
7. /v2/reviews manager review queue.
8. Remaining pages.

VERIFICATION:
Run:
- npm run lint
- npm run typecheck
- npm run build

Manual visual verification:
- Compare each implemented route against the matching PNG mockup.
- Check sidebar/topbar consistency.
- Check card/table/drawer density.
- Check qualification badges.
- Check no UNCERTAIN appears.
- Check LeadAssignment page is not accidentally company-level scoring.
- Check outreach shows suppression gate before send.
- Check ingestion shows row-to-company-to-LeadAssignment pipeline.

EXIT CONDITION:
Stop after producing the plan. Wait for approval before editing code.
```

---

# 9) Implementation Phases

## Phase 1 — UI Kit Primitives
- AppShell
- Sidebar
- Topbar
- ContextBar
- StatCard
- DataTable
- FilterPanel
- StatusBadge
- QualificationBadge
- WorkflowBadge
- ScoreRing
- DetailDrawer
- Tabs
- ActionButton
- UploadDropzone
- Stepper
- Timeline
- EvidenceCard
- AuditSnapshotCard

## Phase 2 — Core Workspaces
- /v2/home
- /v2/accounts
- /v2/projects
- /v2/icp-library
- /v2/icp-library/[id]/test

## Phase 3 — LeadAssignment + Ingestion
- /v2/leads
- LeadAssignment drawer
- Upload + multi-ICP scoring surface
- /v2/ingestion/[jobId]
- /v2/uploads

## Phase 4 — CRM
- /v2/companies
- /v2/contacts
- Company drawer
- Contact drawer

## Phase 5 — Outreach
- /v2/outreach
- Sequence builder
- Suppression center
- Sender accounts
- Outreach monitor

## Phase 6 — Governance
- /v2/reviews
- /v2/feedback
- /v2/settings/ai
- /v2/account-data-log

---

# 10) Visual QA Checklist

## Shell
- Sidebar consistent across routes
- Topbar consistent across routes
- Active nav state visible
- Global search exists
- Upload Data button exists
- Run AI Insight button exists

## Density
- Tables are compact
- Cards are not oversized
- No huge empty whitespace
- Enterprise admin feel preserved

## Product logic
- LeadAssignment is visible as core unit
- ICP column visible on lead scoring pages
- Qualification and workflowStatus are separate
- No UNCERTAIN exists anywhere
- NOT_SCORED appears only as derived UI state
- Outreach suppression gate visible before send
- AI advisory-only copy visible

## Drawers
- Account drawer exists and is detailed
- LeadAssignment drawer exists and is very detailed
- Company drawer exists
- Contact drawer exists
- Manager Review drawer exists
- Drawers have tabs, cards, metadata, actions and evidence

## Critical routes
- /v2/leads matches LeadAssignment cockpit
- /v2/ingestion/[jobId] shows row inspector
- /v2/outreach shows compose + sequences + suppression
- /v2/reviews shows manager resolution drawer

## Build verification
- `npm run lint` passes
- `npm run typecheck` passes
- `npm run build` passes

---

# 11) Recommended Asset Pack Structure

```txt
docs/v2/design/
├─ V2_UI_MOCKUP_AGENT_PACK.md
└─ mockups/
   ├─ 01-core-workspaces.png
   ├─ 02-leadassignment-ingestion-crm.png
   ├─ 03-outreach-review-governance.png
   └─ slices/
      ├─ 01-home-executive-workspace.png
      ├─ 02-accounts-client-account-portfolio.png
      ├─ 03-projects-engagement-workspace.png
      ├─ 04-icp-library-version-builder.png
      ├─ 05-system-reference-icp-preview-design-tokens.png
      ├─ 06-leadassignment-workspace.png
      ├─ 07-lead-upload-multi-icp-scoring.png
      ├─ 08-leadassignment-detail-drawer.png
      ├─ 09-ingestion-job-row-inspector.png
      ├─ 10-uploads-data-uploads.png
      ├─ 11-companies-review-workspace.png
      ├─ 12-contacts-workspace.png
      ├─ 13-outreach-hub.png
      ├─ 14-auto-email-sequence-builder.png
      ├─ 15-suppression-center-senders.png
      ├─ 16-manager-review-queue.png
      └─ 17-feedback-ai-audit-governance.png
```

Minimum acceptable pack:
- 3 large board PNGs
- this markdown file

Best pack:
- 3 large board PNGs
- 17 page slices
- key drawer slices:
  - leadassignment-drawer.png
  - row-inspector.png
  - account-drawer.png
  - manager-review-drawer.png
  - sequence-step-settings.png
  - contact-drawer.png

---

# 12) Final Instruction to Agents

The design is not inspiration.

It is the implementation contract.

If the code output does not visually resemble the mockups in layout, density, route structure, component pattern, drawer detail and product semantics, the implementation is incomplete.
