---
id: frontend-role-ux
version: 1.0.0
domain: frontend-role-ux
risk: R1
sources: [components/**, app/**, hooks/**, context/**, app/globals.css]
---

# Frontend and role surfaces

**LOAD WHEN** changing components, pages, role-scoped surfaces, or the design system.

**DO NOT LOAD WHEN** the change is in a service the component calls.

Scoped rule with the full detail: `.claude/rules/frontend-ux.md`.

## Structural decisions that affect routing

- **Lead detail is a right-side slide-over, never a route.** There is no `/leads/[id]` page.
- **Kanban and list share `/leads`** — the toggle is state or a query param.
- **The task dashboard is the root `/`** with three tabs, not three pages.
- **Desktop only, 1280px+.** `components/DesktopOnlyGate.tsx` blocks below 1024px. Do not add
  `sm:`/`md:`/`lg:` utilities; the sidebar collapse is a preference, not a breakpoint.
- `useState`/`useReducer` + Context. No external state library unless asked.

## Workflow rules that break the SDR loop if missed

- Phone task → Complete opens the **Call Logging modal**; outcome required; the task does not
  auto-close. Skip bypasses it.
- LinkedIn / WhatsApp tasks read **"Log & Complete"** and open the activity logger first.
- One active sequence per lead; enrolling elsewhere auto-unenrols behind a confirmation.
- **SDRs have no Team View** — they get a personal stats widget instead.

## Design discipline

An AI-design detector flagged this UI on eight counts. Reintroducing any restores the flag:

`--text-muted` is `#6B7280` (4.83:1) — never lighten it · mono is for **data** only, never
labels or prose · no gradient text · no decorative motion · no glow, no `0 0 Npx` shadows ·
never tint a shadow with a brand colour · fonts are IBM Plex, not Inter or Geist · no card
inside a card · prose capped at 68ch.

Type scale: 28 / 20 / 16 / 14 / 13 / 12. **12px is the floor.** Headings are styled globally —
a heading on the wrong tier gets a `type-*` class, never a raw size. Never introduce a new
`text-[Npx]`. Exactly one `<h1>` per route, no skipped levels. Tables are the documented
density exception.

## Known failure modes

- **A role surface that renders for the wrong role.** Hiding a control is not authorization,
  but showing one that 403s is still a defect.
- **Hydration mismatch** from time, randomness or `window` read during render.
- **A responsive utility added by habit**, which the desktop-only gate makes meaningless.
- **A new arbitrary font size**, which previously produced five near-identical micro sizes.

## Required tests

```
tests/typography-design-system.test.ts   tests/phase-9-role-surfaces.test.ts
tests/telestar-ai-ui-routes.test.ts
e2e/crm-journeys.spec.ts                 e2e/roles/desktop-gate.spec.ts
```

## Eval cases

- a role sees a nav item it cannot use → role surface, R1 (the API gate is R4)
- console hydration error on a dashboard → render-time nondeterminism, R1
- a heading renders at the wrong size → type scale, R1
