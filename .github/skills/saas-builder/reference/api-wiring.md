# API Wiring — reads, writes, and the read-model boundary

The wiring layer is where tenant isolation is enforced in practice. Reference implementation:
**TeleStar V2** (Next.js App Router). Three shapes, each with a job:

## 1. Reads → tenant-scoped read-models

A **read-model** is a query function that owns a slice of read data. Components never query the DB
directly; they call a read-model. Reference: `lib/v2/crm/query*.ts` (`queryLeadWorkspace.ts`,
`queryContactLeads.ts`, `queryLeadDrawerReadModel.ts`, …).

Shape:
```ts
export async function queryTicketQueue(filters: TicketFilters): Promise<TicketRow[]> {
  const ctx = await requireTenantContext();            // tenant from session
  return prisma.ticket.findMany({
    where: {
      organizationId: ctx.organizationId,              // ALWAYS scoped
      deletedAt: null,                                 // ALWAYS soft-delete filtered
      ...applyFilters(filters),
    },
    // select only what the surface needs; map to a flat Row type
  });
}
```

Rules:
- Scope by `ctx.organizationId` and filter `deletedAt: null` in **every** read-model.
- Return a **flat `Row` type**, not raw Prisma models — the UI consumes the Row, so schema changes
  don't ripple into components.
- Sanitize/guard filter inputs (dates → `YYYY-MM-DD`, enums → allow-list) before they hit SQL.
- The read-model's `produces` (function + Row type) is what `ui-surface` sessions `consume`.

## 2. Writes from the UI → server actions

Reference: `app/v2/*/actions.ts` (`login/actions.ts`, `crm/companies/actions.ts`). Shape:

```ts
"use server";
export async function createTicketAction(formData: FormData) {
  const ctx = await requirePermission("ticket.create");   // authZ at the choke-point
  // validate input …
  await prisma.ticket.create({ data: { organizationId: ctx.organizationId, /* … */ } });
  revalidatePath("/tickets");                              // targeted revalidation
}
```

Rules:
- First line resolves context via `requireTenantContext` / `requirePermission` — **before** any
  work. If it throws, return early.
- Stamp `organizationId` from the context on every insert.
- Prefer **granular `revalidatePath`/`revalidateTag`** over blanket refetches.
- Offload slow work to a job (`enqueue…`, see `job-engine.md`) — actions return fast.

## 3. Machine callers / webhooks → route handlers

Reference: `app/api/*/route.ts`. Use route handlers for health checks, webhooks, worker callbacks,
exports — anything not driven by a form submit.

Rules:
- **Webhooks verify the provider signature before acting**; unsigned = 401 (invariant #9).
- Worker-facing routes are gated by a shared secret (`V2_WORKER_SECRET`), not a session cookie.
- `app/api/health/route.ts` returns `{database:"ok"}` on `SELECT 1`, 503 otherwise — the deploy
  healthcheck gate.

## The boundary that prevents fragmentation

```
UI component ──calls──> read-model (query*.ts)     ──reads──> prisma (tenant-scoped)
UI form      ──calls──> server action (actions.ts) ──writes─> prisma (tenant-scoped)
external     ──hits───> route handler (route.ts)   ──verify─> then acts
```

Because reads go through named read-models and writes through named actions, a `ui-surface` session
`consumes` those names and never touches the DB — that's what keeps UI sessions in their lane.

## Session fit

`read-model` and `api` are distinct change-kinds. A read-model session produces a `query*.ts` + Row
type; an api session produces an action or route. A `ui-surface` session consumes both and produces
only the page. Each carries a test exit-gate (tenant isolation for reads; happy-path + validation
for writes; signature-rejection for webhooks).
