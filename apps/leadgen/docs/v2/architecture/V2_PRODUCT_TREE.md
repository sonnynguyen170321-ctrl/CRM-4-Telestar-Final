# Lead Gen Intelligence — V2 Product Tree

**Status:** Draft for review  
**Purpose:** define the product hierarchy so every future schema, API, UI, report, and workflow uses the same mental model.

## 0. Executive Decision

V2 is not a flat company scoring tool. It is a Lead Gen Intelligence operating system.

The product hierarchy is:

```txt
Organization
→ ClientAccount
→ Project / Engagement
→ Offer / Product
→ ICPProfile
→ ICPVersion
→ Company
→ Contact
→ LeadAssignment
→ ActivityRecord
→ HardRuleAssessment
→ AiInsight
→ SdrReview / ManagerReview
→ FeedbackExample
```

The central workflow object is **LeadAssignment**, not Company.

## 1. Why LeadAssignment is the center

A company can be a strong fit for one client/project/ICP and a poor fit for another.

Example:

```txt
BluePeak Systems
- Qualified for Acme Global / Cloud Security / Healthcare Payers ICP
- Uncertain for Beta Corp / Data Platform / SMB ICP
- Unqualified for Retail Expansion / Consumer Brands ICP
```

Therefore:

```txt
Company is reusable identity.
LeadAssignment is project-specific opportunity context.
Scoring belongs to LeadAssignment + ICPVersion.
Review belongs to LeadAssignment.
Pipeline belongs to LeadAssignment.
Outreach belongs to LeadAssignment.
```

## 2. Object responsibilities

| Object | Responsibility | Must not do |
|---|---|---|
| Organization | top-level tenant/workspace | contain scoring logic |
| User | person using the system | own lead identity directly |
| Team | operational grouping of users | replace RBAC checks |
| ClientAccount | customer/client workspace | store project-specific score |
| Project | engagement/campaign scope | redefine company identity |
| Offer/Product | solution being sold | own contacts directly |
| ICPProfile | named target profile | be used by SDR before published |
| ICPVersion | immutable published/draft rule set | mutate after publish |
| Company | organization identity | store one global final score |
| Contact | person identity | store per-project status |
| ContactIdentifier | email/phone/LinkedIn identity with validity | be treated as lead assignment |
| LeadAssignment | company/contact in a project+ICP context | be globally deduped away |
| HardRuleAssessment | deterministic score snapshot | mutate after creation |
| AiInsight | optional AI support snapshot | overwrite final review |
| FeedbackExample | append-only correction/evidence | silently self-train rules |

## 3. Source-of-truth boundaries

```txt
Company identity = Company + canonical domain + identity resolver
Person identity = Contact + ContactIdentifier
Project-specific qualification = LeadAssignment
Deterministic prediction = HardRuleAssessment
AI support = AiInsight
Human final = SDR/Manager Review + FeedbackExample
Export final = human final first, deterministic result second, AI optional
```

## 4. UI implication

The Company table may show a score only in a selected project/ICP context.

If no context is selected, the UI must show:

```txt
Score: context-selected score
Badge: multiple ICPs / multiple assignments
Tooltip/drawer: per-assignment score breakdown
```

It must not imply a blended global company score.

## 5. Pilot product surface

Pilot visible routes:

```txt
/v2/home
/v2/accounts
/v2/projects
/v2/icp-library
/v2/companies
/v2/contacts-or-leads
/v2/activity-recaps
/v2/review-queue
/v2/settings-or-admin
```

Hidden/deferred until built:

```txt
/v2/pipeline
/v2/outreach
/v2/reports
/v2/ai-insights
advanced theme editor
```


---

## Codex Guardrails
- Do not modify V1 routes, V1 API handlers, V1 scoring, V1 export, V1 AI, or V1 feedback logic.
- Do not modify `prisma/schema.prisma` from this spec alone.
- Do not create migrations until the relevant schema phase is approved.
- Do not implement runtime code until the phase prompt explicitly allows it.
- Preserve append-only history and source-of-truth boundaries.

## Human Review Gate
Before implementation, confirm:
1. The decision matches the V7 master plan.
2. The spec does not contradict another spec or ADR.
3. Open questions are resolved or explicitly deferred.
4. Codex allowed files are narrow enough for the next phase.
