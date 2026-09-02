# Lead Gen Intelligence — ThemeProfile Spec

**Status:** Draft for review  
**Purpose:** keep controlled personalization without letting it block the pilot.

## 0. Executive Decision

ThemeProfile stays in the roadmap. It is controlled, non-critical, and feature-flagged.

It must not block scoring, identity, ingestion, activity recap, company review, manual send, or Stop & Ship.

## 1. Allowed early scope

```txt
accent color from approved palette
density: compact | comfortable
default landing page
saved views
saved columns
account/project icon or emoji
```

## 2. Optional later scope

```txt
special cursor for selected users
subtle button animation
workspace theme presets
custom dashboard card order
```

## 3. Forbidden

```txt
arbitrary CSS
layout builder
custom workflow stages from theme
changing status color semantics
changing qualification colors
custom JS
per-user permission hiding via theme
```

## 4. Data concept

```txt
ThemeProfile
- id
- org_id
- name
- applies_to: org | team | user | project
- accent_color
- density
- default_landing_page
- saved_view_ids
- enabled_flags
```

## 5. Pilot rule

ThemeProfile may be implemented only after the core pilot workflow is usable or if it is extremely cheap and isolated.


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
