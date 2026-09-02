# Session Decomposition — how to split a plan into linked sessions

This is the mechanism that kills fragmentation. A plan is not built in one giant session; it is
built as a **queue of small sessions**, each doing exactly one kind of change, each declaring a
**contract** so the next session links to it instead of re-deriving it.

## The one rule: one change-kind per session

A session does exactly one of:

| change-kind | what it touches | example |
|-------------|-----------------|---------|
| `schema` | `prisma/schema.prisma` + a migration | add `Ticket` model + FK to `Org` |
| `read-model` | a `query*.ts` read function + its types | `queryTicketQueue.ts` |
| `api` | a server action or a route handler | `createTicket` action, `/api/webhooks/x` |
| `ui-surface` | **one** page/screen + the primitives it composes | the ticket queue page |
| `job` | a queue processor + its enqueue call | `ticket.autoassign` worker |
| `deploy` | infra/compose/env/CI | add worker service to compose |
| `test` | an automated check for existing behavior | tenant-isolation test for tickets |

**Allowed exception:** `schema + read-model` may travel together when the read-model is meaningless
without the new columns and both are explicitly scoped in the session. Nothing else combines.

Never combine unrelated UI and backend work. Never let a `ui-surface` session touch schema,
scoring, or queries — it consumes existing read-models only.

## The session contract

Every session in the queue carries four fields. This is what makes sessions link:

```
- id: S3
  change-kind: read-model
  consumes: Ticket model + TicketStatus enum (from S1); org tenant context (spine)
  produces: queryTicketQueue(filters) -> TicketRow[]; TicketRow type
  exit-gate: unit test — returns only current-tenant, deletedAt IS NULL rows
```

- **consumes** — the concrete artifacts (types, tables, functions) it needs to already exist. A
  session is **unblocked** only when everything in `consumes` exists.
- **produces** — the concrete artifacts it hands forward. The next session's `consumes` should
  name these exactly.
- **exit-gate** — the check that proves done: a test, a typecheck/build, or a SEE-IT browser pass
  for UI. No exit-gate → the session isn't real.

## Ordering — dependency, not feature

Order the queue by dependency, not by which feature feels exciting:

```
schema  →  read-model  →  api  →  ui-surface  →  deploy
                    ↘  job  ↗        (jobs slot where producer/consumer sit)
```

A `ui-surface` cannot precede the `read-model` it renders. An `api` write cannot precede the
`schema` it writes to. `deploy` sessions come after the thing they ship exists and is tested.

## SEE-IT pairing

A run of backend-only sessions (schema/read-model/api/job) must be followed by a **`ui-surface`
session that makes the work visible in a browser** before starting the next feature cluster. If you
can't see it, you can't trust it.

## Writing the queue

Put the queue as a table in `BUILD_PLAN.md` (see `templates/BUILD_PLAN.md`):

| id | change-kind | consumes | produces | exit-gate | status |
|----|-------------|----------|----------|-----------|--------|
| S1 | schema | Org (spine) | Ticket model, TicketStatus | migration applies clean | pending |
| S2 | read-model | S1 | queryTicketQueue | tenant-isolation test | pending |
| S3 | api | S1 | createTicket action | happy-path + validation test | pending |
| S4 | ui-surface | S2, S3 | /tickets page | SEE-IT: create + list a ticket | pending |

## After each session

Append `SESSION_LOG.md` (see `templates/SESSION_LOG.md`) and **stop for review**. The log is the
memory that lets the next session — even a cold one — trust what came before. This generalizes the
TeleStar `docs/v2/codex/SESSION_LOG.md` + `V2_CODEX_GUARDRAILS.md` discipline that keeps a
long-running agent build coherent.
