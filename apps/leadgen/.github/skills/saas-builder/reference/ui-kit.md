# UI Kit — compose surfaces from shared primitives

UI sessions **compose existing primitives + consume existing read-models**. They never touch
schema, queries, or scoring. Reference implementation: **TeleStar V2** — `components/shared/*`.

## The primitives

| Need | Primitive |
|------|-----------|
| List surface (the workhorse) | `DataTable` / `DataTableShell` + `FilterBar` / `FilterChipBar` |
| App frame + navigation | `AppShell` / `SideNav` / `TopBar` / `PageHeader` / `PageToolbar` |
| Detail / side panel | `V2DetailDrawer` / `DrawerSection` / `PanelCard` |
| Metrics | `MetricCard` / `StatCard` / `WorkspaceMetricGrid` |
| State kit | `EmptyState` / `LoadingSkeleton` / `ErrorState` / `FriendlyErrorState` |
| Feedback / actions | `ConfirmDialog` / `StickyActionBar` / `V2ActionButton` / `RowMenu` |
| Theming | `ThemeProvider` / `ThemeToggle` |
| Status / scores | `statusBadges` / `ScoreRing` / `EntityAvatar` |
| Keyboard | `useListKeyboard` / `RouteListKeyboard` |

## Rules for a surface

- **Every list surface = `DataTable` + a filter bar + the state kit.** Don't hand-roll a table.
- **Every surface handles all three states**: loading (`LoadingSkeleton`), empty (`EmptyState`),
  error (`ErrorState`). A surface without them is unfinished.
- **Consume a read-model, render its Row type.** The page imports `queryX()` (server component) or
  receives its Row[] as props — it does not query Prisma directly.
- **Theming**: light + dark via `ThemeProvider`; target **WCAG AA** contrast. No hard-coded colors
  — use the token system the app already ships.
- **One surface per session.** Stay inside that surface's files. If it needs a new read-model or a
  schema change, STOP — that's a different (earlier) session, not this one.

## Anti-slop

The TeleStar redesign banned specific tells: rainbow avatars, per-row rainbow buttons, side-stripe
accents, metric walls, numbered eyebrows. Prefer one primary action per row, background tint over
stripes, triage-first layouts. Design should read as calm and deterministic, not decorated.

## SEE-IT

A `ui-surface` session is how a cluster of backend sessions becomes **visible**. Its exit-gate is a
**SEE-IT browser pass**: open the page, perform the core action, confirm the data round-trips. No
next feature cluster starts until the last one's SEE-IT passes.

## Session fit

`ui-surface` change-kind. Consumes: read-model(s) + action(s) produced by earlier sessions +
the shared primitives. Produces: one page/route. Exit-gate: SEE-IT.
