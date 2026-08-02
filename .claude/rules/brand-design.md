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
| Section     | `--text-section`    | 19px   | panel / card headers |
| Subsection  | `--text-subsection` | 15.5px | group labels inside a panel |
| Body        | `--text-body`       | 13.5px | paragraphs, table cells, form values |
| Meta        | `--text-meta`       | 11.5px | timestamps, counts, secondary chrome |
| Micro       | `--text-micro`      | 10px   | badges, kbd hints, avatar initials |

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
