---
id: auth-rbac-tenancy
version: 1.0.0
domain: auth-rbac-tenancy
risk: R4
sources: [lib/auth.ts, lib/auth/**, lib/podScoping.ts, lib/admin/**, app/api/admin/**]
---

# Authorization, roles, tenancy

**LOAD WHEN** changing sessions, roles, pod scoping, tenant filtering, campaign membership, or
anything that decides who may see or act on a record.

**DO NOT LOAD WHEN** the change merely calls an already-scoped service without altering scope.

Every change here is **R4**: independent verification, and the role E2E suite is evidence, not
an optional extra.

## The six roles

`director` · `floor_manager` · `team_lead` · `sdr` · `leadgen_manager` · `leadgen`

Six. **Any list naming four is stale** — leadgen was added later and the docs were not.
Generated truth: `.agent/generated/role-map.json`.

`role` is a **`String` column, not a database enum**, so the database rejects nothing. A
typo'd role is not a constraint violation; it is a user who matches no scope rule and silently
sees nothing — or, worse, falls through to a broader branch.

Scoping walks `managerId`: Team Lead → their SDRs; Floor Manager → everyone under their Team
Leads; Director → all. SDRs see only their own leads and tasks. Son (BD Manager) maps to
`director`; it is a title, not a permission level.

## Core invariants

- **Every query is tenant-scoped.** Enforced by the `lib/prisma.ts` extension. A bare
  `new PrismaClient()` opts out and needs a specific reviewed reason.
- **Enforcement lives in the domain services.** Not re-implemented at call sites, not
  reproduced in the agent layer. A UI that hides a control is not authorization.
- **Removing someone runs an impact check first.** Removing a campaign member or deactivating
  a user returns **409** unless the caller names a handling mode (`transfer_work` /
  `pause_tasks` / `keep_existing_work`) plus a reason. `lib/admin/campaignMembers.ts` owns it;
  both routes delegate, so it cannot be bypassed. Do not add a third path.

## Known failure modes

- **Widening by default.** A new branch that falls through to "see everything" when a role does
  not match is invisible in tests written for the roles that do match. Test the negative.
- **The scope-shape mismatch.** `Task` and `Activity` own `userId`; `Lead` owns
  `assignedToId`. One scope object for both makes Prisma reject the query outright and the
  endpoint 500 for every role except director — which looked, from the UI, like a feature that
  never appeared.
- **Stale attributions treated as open work.** The impact panel discloses leadgen pool rows,
  archived leads and acknowledged alerts, and deliberately excludes them from `totalOpen`.
  They record *who did something*, not work to pick up; counting them starts returning 409 on
  removals that are correct.
- **Four-role assumptions.** Any fixture, test or doc enumerating roles is suspect until
  checked against the generated map.

## Required tests

```
tests/access-control.test.ts     tests/podScoping.test.ts
tests/tenant-*.test.ts           tests/rls-policy-coverage.test.ts
tests/admin-impact.test.ts       tests/object-auth-red-team.test.ts
tests/session-revocation.test.ts tests/mass-assignment.test.ts
e2e/roles/**                     e2e/admin/**
```

## Eval cases

- a Floor Manager sees another floor's leads → pod scoping, R4
- deactivating a user silently orphans tasks → impact check, R4
- a new role appears in the UI but not in scope rules → generated role drift, R4
