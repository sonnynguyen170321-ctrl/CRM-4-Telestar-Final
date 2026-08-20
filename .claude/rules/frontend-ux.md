---
paths:
  - app/**
  - components/**
  - hooks/**
  - context/**
  - app/globals.css
  - tailwind.config.*
domain: frontend-role-ux
risk: R1
---

# Frontend, brand, and the non-obvious UX rules

Full product specification: `SKILL.md`. This rule carries only what is easy to get wrong.

## Structural decisions that affect routing

- **Lead detail is a right-side slide-over panel, never a route.** There is no `/leads/[id]`
  page. Clicking a lead anywhere opens the slide-over.
- **Kanban and list share `/leads`** — the toggle is component state or a `?view=` param, not
  a second route.
- **The task dashboard is the root `/` route** with three tabs (Today / Yesterday / Overdue),
  not three pages.
- **Desktop only, 1280px+.** Below 1024px `components/DesktopOnlyGate.tsx` blocks the app.
  Do not add `sm:`/`md:`/`lg:` responsive utilities. The sidebar collapse is a user
  preference, not a viewport breakpoint.
- State is `useState`/`useReducer` plus Context. No Redux/Zustand/Jotai unless explicitly
  requested. API routes, not Server Actions.

## Workflow rules that break the SDR loop if missed

- **Phone task → Complete opens the Call Logging modal.** Outcome required; the task does not
  auto-close. Skip bypasses the modal.
- **LinkedIn / WhatsApp tasks say "Log & Complete"**, not "Complete", and open the activity
  logger first.
- **One active sequence per lead.** Enrolling in a new one auto-unenrolls from the current
  one, behind a confirmation modal.
- **SDRs have no Team View** — they get a personal stats widget on the dashboard instead.
- Every meaningful action writes an `activities` row. The backend owns that, not the
  component; it is the source of truth for the leaderboard and coaching.

## Design discipline

An AI-design detector flagged this UI on eight counts. These are rules now — reintroducing any
puts the flag back.

- **Contrast.** `--text-muted` is `#6B7280` (4.83:1 on white). Never lighten it; the previous
  `#9CA3AF` measured 2.54:1 and failed WCAG AA everywhere. New text colors clear 4.5:1, or 3:1
  at ≥18.66px bold.
- **Mono is for data** — numbers, percentages, IDs, timestamps, counts. Never for labels,
  headings, empty states or prose. Uppercase label + mono is the specific combination to avoid.
- **No gradient text**, no `bg-clip-text`. The wordmark is solid `--brand-red`.
- **No decorative motion** — no idle float, bounce, elastic easing, pulsing glow, aurora
  background or rotating conic border. Motion reports state: loading, progress, hover/focus.
- **No glow.** No `0 0 Npx` shadows, no `drop-shadow` halos. Use a border, a ring or an inset
  accent bar.
- **Shadows are neutral.** Never tint a shadow with a brand color at any offset.
- **Fonts are IBM Plex** (Sans, Sans Condensed, Mono), deliberately. Inter and Geist are what
  nearly every generated app ships and detectors flag them by name. Same for Poppins and
  Montserrat.
- **No card inside a card.** Never put card chrome on a container that holds cards.
- **Prose gets a measure** — `.prose-measure`, capped at 68ch.

## Type scale

Six tiers as tokens in `app/globals.css`: page title 28 / section 20 / subsection 16 / body 14
/ meta 13 / micro 12. **12px is the floor.**

`<h1>`/`<h2>`/`<h3>` are styled globally — a heading lands on its tier with no size class.
A heading on the wrong tier gets a `type-*` class, never a raw size. Never introduce a new
`text-[Npx]` value: arbitrary sizes previously produced five near-identical micro sizes that
read as noise.

Exactly one `<h1>` per route. Never skip heading levels.

Tables are the documented exception to tight density: ~48px rows, 12/16px cell padding.
