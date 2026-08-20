---
paths:
  - lib/auth.ts
  - lib/auth/**
  - lib/admin/**
  - lib/podScoping.ts
  - app/api/auth/**
  - app/api/admin/**
  - app/api/users/**
  - app/api/campaigns/**
domain: auth-rbac-tenancy
risk: R4
---

# Authorization, roles, and tenancy

## Six roles

`director` · `floor_manager` · `team_lead` · `sdr` · `leadgen_manager` · `leadgen`

Six. Any list naming four is stale. `role` is a `String` column, not a database enum, so
nothing but a generated drift check keeps role lists honest — treat a hand-written role list
in a doc or test as suspect.

Scoping walks `managerId`: a Team Lead sees SDRs where `managerId = teamLead.id`, a Floor
Manager sees everyone under their Team Leads, a Director sees all. SDRs see only their own
leads and tasks.

Son (BD Manager) maps to `director`. BD Manager is a title, not a permission level.

## Tenancy is not optional

Every query is tenant-scoped, enforced by the `lib/prisma.ts` extension. Cross-tenant reads
are the highest-severity defect class this repository has; `e2e/roles/tenant-isolation.spec.ts`
exercises it through the real HTTP surface.

## Removing people is not a delete

Removing a campaign member or deactivating a user runs an impact check first and returns
**409** unless the caller names a handling mode (`transfer_work` / `pause_tasks` /
`keep_existing_work`) plus a reason. Enforcement lives in `lib/admin/campaignMembers.ts`; both
`/api/admin/assignments` and `/api/campaigns/[id]/members` delegate to it so it cannot be
bypassed. Do not add a third path.

The impact panel discloses stale attributions — leadgen pool rows, archived leads, paused
email accounts, acknowledged and resolved health alerts. These are deliberately excluded from
`totalOpen`: they record *who did something*, not work someone must pick up. Rolling them in
would start returning 409 on removals that are correct today, which is the opposite of the
intent.

## Enforcement lives in one layer

Authorization is enforced in the domain services, not re-implemented at call sites and not
reproduced in the agent layer. A UI that hides a control is not authorization; the API must
refuse.

Changes here are **R4**: independent verification required, and the role E2E suite is part of
the evidence, not an optional extra.
