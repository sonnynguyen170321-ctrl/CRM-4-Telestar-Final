<!--
  SESSION_LOG.md — append-only ledger. One block per session, newest at the TOP.
  This is the memory that lets the next session (even a cold one) trust what came before.
  Never rewrite history; only append. Generalizes docs/v2/codex/SESSION_LOG.md.
-->

# SESSION_LOG — <Product Name>

<!-- Copy the block below to the top for each new session. -->

## <YYYY-MM-DD> — S<id> · <change-kind> · <one-line title>

- **Queue row:** S<id> (consumes: <…> · produces: <…>)
- **Files changed:** <paths>
- **Runtime changed?** yes/no
- **Schema / migrations changed?** yes/no (migration name if yes)
- **Invariants touched / upheld:** <cite numbers, e.g. #5 tenant isolation via requireTenantContext>
- **Exit-gate run:** <the check + result — test name, typecheck, SEE-IT pass>
- **Open questions / handoff:** <what the next session needs to know>
- **Status:** done / blocked (why)

---

<!-- Example (delete once real entries exist):

## 2026-07-19 — S2 · read-model · queryTicketQueue

- **Queue row:** S2 (consumes: S1 Ticket model + TicketStatus · produces: queryTicketQueue, TicketRow)
- **Files changed:** lib/tickets/queryTicketQueue.ts, lib/tickets/types.ts, lib/tickets/__tests__/queryTicketQueue.test.ts
- **Runtime changed?** no
- **Schema / migrations changed?** no
- **Invariants touched / upheld:** #5 (scoped by ctx.organizationId), #8 (deletedAt: null)
- **Exit-gate run:** vitest queryTicketQueue.test.ts — green; asserts cross-tenant rows excluded
- **Open questions / handoff:** TicketRow shape is what S4 (ui-surface) renders
- **Status:** done
-->
