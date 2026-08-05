# Design-flag remediation — STATUS (resume pointer)

**Goal:** drive the [impeccable.style](https://impeccable.style) browser overlay to **zero flags**
on every route. No accepted exceptions — if a category is not at zero, it gets another pass.

**Last updated:** 2026-08-02, after the dead-token sweep.

---

## How to run the audit

The audit is a local re-implementation of the overlay's heuristics, deliberately **stricter**
than the tool so a clean local run predicts a clean scan.

```bash
# 1. dev server must be up
node ./node_modules/next/dist/bin/next dev -p 3000

# 2. full sweep (20 authenticated routes, assistant opened on each)
node scripts/design-audit.mjs

# 3. single route(s), verbose
node scripts/design-audit.mjs "/leads,/director" -v
```

Env overrides: `AUDIT_BASE_URL`, `AUDIT_EMAIL`, `AUDIT_PASSWORD` (defaults
`http://localhost:3000`, `dean@telestar.vn`, `telestar2026`).

Categories reported: `lowContrast, tiny, longLine, gradientText, glow, tintedShadow,
darkSurfaceGlow, springy, headingOrder, nestedCards, cramped, deadTokens` + font census.

---

## Baseline (before this round, 20 routes)

```
lowContrast: 16    <- /opportunities 14, /director 1, /automation 1
tiny:       220    <- every route (11px micro tier, threshold is <12px)
longLine:    12    <- admin pages, /automation, /settings, /leadgen-manager
headingOrder: 9    <- /, /inbox, /sequences, /templates, /team, /automation, /settings, /leadgen, /leadgen-manager
nestedCards: 23*   <- /leads 8, /director 8, /opportunities 7   (*measured on 3 routes only)
cramped:     12    <- /team 7, /automation 5
deadTokens:  18    <- /opportunities 11, /client-reports 5, /settings 2
gradientText, glow, tintedShadow, darkSurfaceGlow, springy: 0   (cleared in earlier rounds)
fonts: IBM Plex only, no generator-default faces
```

---

## Task list

- [x] **1. Extend the audit** — all 20 routes + `headingOrder`, `nestedCards`, `cramped`,
      `deadTokens`; `longLine` no longer requires >90 characters; `tiny` threshold raised to
      <12px. Committed as `scripts/design-audit.mjs`.
- [x] **2a. Dead tokens** — `text-muted`, `text-foreground`, `border-border`, `bg-surface`,
      `bg-muted`, `bg-background`, `bg-card`, `bg-foreground`, `text-background`,
      `border-muted`, `text-primary`, `text-secondary` mapped to real theme tokens across 63
      files. **These classes were never defined in the theme and silently did nothing.**
- [x] **2b. White-on-light text** — 116 `text-white` → `text-text-primary` where the surface is
      light; 115 kept on coloured backgrounds. Seven false positives on *dark ancestors*
      (assistant panel header, desktop gate, active nav pill, `bg-[#D42B1E]` bubbles) were
      reverted by hand.
- [x] **3. Heading structure** — 9 routes. Panel titles are `<h3>` carrying `.type-section`;
      the tier system fixed the size but not the tag. Promote top-level panel titles to `<h2>`
      (visually identical — `.type-section` drives size). Fixed `/templates`, `/automation`,
      `/team`, `/settings`, `/sequences`, `/leadgen`, `/leadgen-manager`, `/`, `/inbox`.
- [x] **4. Nested cards** — flatten wrappers, keep leaf cards. Kanban columns
      ([app/leads/page.tsx](../../app/leads/page.tsx) stage config carries
      `border border-card-border bg-gray-500/5`), tab bars / segmented controls (Director, Team,
      Opportunities), assistant inner blocks + its wide shadow.
      Once the wrapper is not a surface, the card inside it is top-level and the flag clears.
- [x] **5. Line length** — add `.prose-measure { max-width: 68ch }` to
      [app/globals.css](../../app/globals.css); apply to page subtitles and panel descriptions
      (the repeated `<p className="text-xs text-text-secondary">` under each `<h1>`).
- [x] **6. Table padding** — redefine `.table-row-dense` in globals.css to ~48px rows and
      12px/16px cell padding, so every table inherits it. **Data tables are the one documented
      exception to brand density** — cards, kanban and lists stay dense.
- [x] **7. Text floor** — `--text-micro` 11→12px, `--text-meta` 12.5→13px, body stays 14px.
      Then move flagged prose off micro: Inbox empty state and Templates previews →
      `type-body`; Admin ID string and Team caption → `type-meta`.
- [x] **8. Record the rules** in [.claude/rules/brand-design.md](../../.claude/rules/brand-design.md):
      one `<h1>` per page, no skipped levels, no card chrome on a container holding cards,
      prose ≤68ch, tables exception, and the canonical token names.

---

## Run 2026-08-05 — re-verified after the Admin Control Center landed

The claim above that every category was at zero **did not survive re-running the audit**.
The sweep found **145 flags**, most of them predating the admin console. Current state:

| Category | Before | After |
|---|---|---|
| `cramped` | 130 | **0** |
| `longLine` | 6 | **0** |
| `nestedCards` | 3 | **0** |
| `headingOrder` | 2 | **0** |
| `tiny`, `deadTokens`, `gradientText`, `glow`, `tintedShadow`, `darkSurfaceGlow`, `springy` | 0 | **0** |
| `lowContrast` | 4 *(measured)* | **71** *(measured — see below)* |

**`cramped` was one rule, not 130 problems.** `app/globals.css` sets `table th, table td`
padding *outside* any `@layer`, so it beats every Tailwind padding utility regardless of
specificity — the same trick the file already uses deliberately for ad-hoc text sizes. That
means a `py-*` class on a table cell has never done anything in this app. The single rule
was 12px vertical, giving 43px rows against the ~48px target in `brand-design.md`; it is now
16px, which clears 48px for both type tiers in use. Task 6 above claimed this was already
done — the padding half was, the row-height half was not.

**`lowContrast` went up because the audit got more accurate, not because the UI got worse.**
`parseRGB` only matched `rgba?()`. Chrome reports Tailwind v4 colours in modern syntax
(`bg-emerald-600` → `lab(55.05 -49.92 15.93)`), so the parser returned null and `bgOf` fell
through to its white fallback. That produced both false positives (white text on an emerald
button scored 1.00:1) and, more importantly, **false negatives** — any dark text on a `lab()`
background was measured against an imaginary white backdrop and passed. The parser now
rasterises through a canvas, which resolves any CSS colour exactly.

The 71 are real measurements and **not yet fixed**. They are two groups:

1. **`text-zinc-400` at 2.62:1** in the AI assistant's "Enter to send" hint. One component,
   present on every route — roughly 27 of the 71 are this single class.
2. **Channel colours at the `-500` weight**: `text-green-500` 2.22:1, `text-emerald-500`
   2.47:1, `text-blue-500` 3.76:1. These are the Phone / WhatsApp / Email colours from
   `brand-design.md` and they do not meet WCAG AA for normal text on white.

Group 2 needs a palette decision, not a mechanical fix — the same call that was already made
once for `--text-muted` (2.54:1 → 4.83:1). Until then this initiative is **not** at zero.

---

## Verification gate (all must pass before calling it done)

```bash
node scripts/design-audit.mjs          # every category 0
npx tsc --noEmit                       # 0 errors
npx vitest run                         # 386 passing / 37 files
node scripts/e2e-regression.mjs        # 34/34 functional checks
NODE_OPTIONS=--max-old-space-size=8192 npm run build   # green, 68/68 pages
```

Then re-scan with impeccable.style in the browser. The local audit approximates their
heuristics; anything still flagged gets a follow-up pass.

---

## Traps that have already cost time

1. **Stale CSS after a build.** `next build` clobbers `.next` under a running dev server, which
   then serves an old CSS chunk. Two full audit cycles reported pre-change values because of
   this. After any build or CSS edit: kill the dev server, `rm -rf .next/static .next/dev`,
   restart, hard-refresh.
2. **The build needs a bigger heap.** Default 2 GB dies in the TypeScript step with
   `FATAL ERROR: Ineffective mark-compacts near heap limit` (exit 134). Not a type error —
   `npx tsc --noEmit` is clean. Use `NODE_OPTIONS=--max-old-space-size=8192`.
3. **Tailwind v4 swallows same-named rules.** Defining `.text-brand-gold` in plain CSS is folded
   into Tailwind's utilities layer and loses to the generated rule. Add a separate theme colour
   instead (that is why `--color-brand-gold-text` / `--color-brand-orange-text` exist).
4. **Static class sweeps cannot see dark ancestors.** Any `text-white` → dark-text rewrite must
   be re-verified with the audit, which composites the real background. Seven false positives
   came from this.
5. **The repo path contains `&`** (`Sonny & AI`), which breaks npm/npx `.bin` shims. Call
   binaries through node: `node ./node_modules/next/dist/bin/next dev`.
6. **Windows/Git Bash mangles route arguments.** `node scripts/design-audit.mjs /leads` becomes
   `C:/Program Files/Git/leads`. Pass routes comma-joined and quoted, or run the full sweep.

---

## Related history

- `2592fbb` — round 1: contrast tokens, mono 24%→6.6%, motion, gradient, line length, nested card.
- `778fe2b` — round 2: IBM Plex font stack, neutral shadows, sidebar avatar contrast.
- Design rules live in [.claude/rules/brand-design.md](../../.claude/rules/brand-design.md).
