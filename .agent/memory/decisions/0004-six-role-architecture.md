---
id: ADR-0004
title: Six operational roles, scoped by managerId
status: accepted
classification: CURRENT_CANONICAL
---

# ADR-0004 — Six roles

## Context

Telestar runs two distinct functions: outbound reps who work leads, and a leadgen team who
source and qualify them. Early documentation described four roles — director, floor_manager,
team_lead, sdr — because leadgen was added later and the docs were not.

## Decision

Six roles: `director` · `floor_manager` · `team_lead` · `sdr` · `leadgen_manager` · `leadgen`.

Scoping walks `managerId` on the users table: a Team Lead sees SDRs whose `managerId` is
theirs, a Floor Manager sees everyone under their Team Leads, a Director sees all. SDRs see
only their own leads and tasks.

Son (BD Manager) maps to `director`. BD Manager is a title, not a permission level; there is no
`bd_manager` value.

## Why

Leadgen work has a different object scope from SDR work — a leadgen user works a pool and a
campaign requirement, not an assigned lead list. Modelling them as SDRs would have required
either widening SDR scope or special-casing leadgen inside every SDR query.

`managerId` rather than a denormalised team column: the hierarchy is already a tree, and a
tree walked at query time cannot disagree with itself the way a cached team id can.

## Consequences

- `role` is a **`String` column, not a database enum.** The database will not reject an invalid role, so nothing but a generated drift check keeps role lists honest. Any hand-written four-role list in a doc, test or fixture is stale by definition.
- Every role-scoped query walks the manager relationship; there is no shortcut.
- Six-role coverage is required for acceptance. Four-role evidence does not certify a six-role product.

## Alternatives

- **A `teamId` column.** Rejected: two sources of truth for the same hierarchy.
- **Roles as a database enum.** Not chosen historically; the drift check exists because of it. Revisiting this is a reasonable future ADR.

## Protection

- `e2e/roles/**` — every persona reaches its routes and no other
- `tests/podScoping.test.ts`
- `tests/phase-9-role-surfaces.test.ts`
- Generated `role-map.json` + drift check (phase 3/6) — the only thing that can catch a stale role list
