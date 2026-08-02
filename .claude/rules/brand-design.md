---
description: Telestar brand palette, UI design guidelines, and visual standards for the CRM
globs: "**/*.tsx, **/*.jsx, **/*.css, **/*.module.css, **/tailwind.config.*,  **/globals.css"
alwaysApply: true
---

# Brand & Design — Telestar SDR CRM

Logo: a fiery star with flame-wing motif on a dark background. The UI should feel
**fast, sharp, and industrial** — think Linear, Attio, HubSpot. Not soft or playful.

## Brand Palette

| Token        | Hex       | Usage                                        |
|--------------|-----------|----------------------------------------------|
| Primary dark | `#0A0A0A` | Sidebar background (range: `#0A0A0A`–`#1A1A1A`) |
| Fire red     | `#D42B1E` | Primary action color — buttons, active states |
| Flame orange | `#E8611A` | Secondary accent — hover states, badges       |
| Gold/amber   | `#F5A623` | Highlights, success states (Won deals)        |
| Hot yellow   | `#FEDD44` | Sparingly — attention-only elements           |

Dark sidebar, light content area (white or very light gray). Logo in sidebar header.

## Layout & Typography

- **Desktop-only.** The CRM targets desktop (1280px+) exclusively — there is no mobile/responsive
  support. Below 1024px a full-screen "use desktop" gate (`components/DesktopOnlyGate.tsx`) blocks the
  app instead of reflowing. Do **not** add Tailwind responsive breakpoint utilities (`sm:`/`md:`/`lg:`).
  The sidebar collapse is a manual user preference (icon-only ↔ expanded), not viewport-driven.
- Monospace accents for IDs and timestamps.
- Tight spacing: 12–16px padding in cards, 8px gaps in lists, 36–40px table row height.
- 1px solid muted borders. Subtle elevation only for modals and slide-over panels.
- Icons: **lucide-react** throughout — every channel, stage, and action gets an icon.

## Type Scale

Six tiers, defined as tokens in `app/globals.css`. Density stays SDR-tight — the contrast
lives in the jump between tiers, not in overall size.

| Tier | Token | Size | Used for |
|------|-------|------|----------|
| Page title  | `--text-page-title` | 28px   | the single `<h1>` per route |
| Section     | `--text-section`    | 20px   | panel / card headers |
| Subsection  | `--text-subsection` | 16px   | group labels inside a panel |
| Body        | `--text-body`       | 14px   | paragraphs, table cells, form values |
| Meta        | `--text-meta`       | 12.5px | timestamps, counts, secondary chrome |
| Micro       | `--text-micro`      | 11px   | badges, kbd hints, avatar initials |

**11px is the floor.** Nothing renders smaller. Prose at 10px reads as "tiny body
text" to accessibility audits and to people over 40 looking at a 1440p monitor.

Rules:

- **`<h1>`/`<h2>`/`<h3>` are styled globally** — a heading lands on its tier with no size
  class. Do not add `text-2xl`/`text-sm` to a heading to "fix" its size.
- **A heading on the wrong tier gets a `type-*` class**, not a raw size: a panel header
  written as `<h3>` becomes `<h3 className="type-section …">`. The same classes
  (`type-page-title`, `type-section`, `type-subsection`, `type-body`, `type-meta`,
  `type-micro`) work on any element, including a `<span>` acting as a card title.
- **Never introduce a new `text-[Npx]` value.** Arbitrary sizes previously produced five
  near-identical micro sizes (8/9/10/11/13) that read as noise. Existing ones are remapped
  onto the scale in `globals.css`; new code should use a tier.
- The root is `html { font-size: 17.5px }`, so rem-based Tailwind steps render fractional
  (13.109px, 15.312px). Tier sizes are absolute px on purpose. `text-xs`/`text-sm`/`text-lg`/
  `text-2xl` are snapped onto the scale, so existing markup stays on whole pixels.

## Colour & Motion Discipline

An AI-design detector flagged this UI on eight counts. The fixes are rules now, not
one-offs — reintroducing any of these puts the flag back:

- **Contrast.** `--text-muted` is `#6B7280` (4.83:1 on white). Never lighten it: the previous
  `#9CA3AF` measured 2.54:1 and failed WCAG AA everywhere it appeared. Any new text colour
  must clear 4.5:1 against its actual background, 3:1 for ≥18.66px bold.
- **Mono is for data.** Numbers, percentages, IDs, timestamps, counts. Never for labels,
  headings, empty states or prose — that pushed mono to 24% of all text against a 10–15%
  budget. Uppercase label + mono is the specific combination to avoid.
- **No gradient text.** No `bg-clip-text`. The wordmark is solid `--brand-red`.
- **No decorative motion.** No idle float, bounce, elastic easing, pulsing glow, aurora
  background, or rotating conic border. Motion must report state: loading spinners, toast
  progress, hover/focus transitions. A global `prefers-reduced-motion` guard collapses
  what remains.
- **No glow.** No `0 0 Npx` box-shadows or `drop-shadow` halos. Use a solid border, a ring,
  or an inset accent bar.
- **Shadows are neutral.** Never tint a shadow with a brand colour — no `shadow-brand-red/10`,
  no `rgba(212,43,30,…)` in a `box-shadow`. A coloured shadow at *any* offset reads as a
  glowing accent, not just a zero-offset one. Use plain `shadow-sm` / `shadow-md`.
- **Fonts are IBM Plex**, deliberately: Plex Sans (body), Plex Sans Condensed (chrome),
  Plex Mono (data). Inter and Geist are the stack nearly every generated app ships, and
  detectors flag them by name. Do not reintroduce them, or Poppins/Montserrat.
- **Prose gets a measure.** Cap running text at `max-w-[68ch]`.
- **No card inside a card.** Use a divider or spacing to group within a panel.

## Channel Color Map

| Channel   | Color         |
|-----------|---------------|
| Email     | Blue          |
| Phone     | Green         |
| LinkedIn  | Indigo/navy   |
| WhatsApp  | Emerald/teal  |

## Pipeline Stage Badge Colors

| Stage           | Color                        |
|-----------------|------------------------------|
| New             | Gray                         |
| Sequence Active | Blue                         |
| Replied         | Amber/yellow                 |
| Meeting Booked  | Emerald/green                |
| Won             | Green with checkmark         |
| Lost            | Red with X                   |
