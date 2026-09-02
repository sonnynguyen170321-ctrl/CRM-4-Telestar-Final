# Invariants — the non-negotiable rules

These are the rules every session upholds, generalized from the 16 TeleStar V2 `AGENTS.md`
invariants. If a task tempts you to violate one, **STOP and flag it** — cite the number in the
session log. They are ordered by how expensive they are to get wrong.

1. **Own your runtime.** Don't couple a new product to another system's tables/queues/business
   logic as a shortcut. Shared infra is limited to explicitly scoped auth/tenant/prisma
   (`@/lib/server/prisma`); it must not become a backdoor to another app's data.

2. **Pick the right unit of work, and keep it stable.** Decide what the core scored/tracked entity
   is (in TeleStar: `LeadAssignment = Company × Project × ICP`, never a bare Company) and never
   silently regress to a coarser one.

3. **Separate mutable workflow status from immutable outcome.** Workflow status changes; a
   qualification/decision/audit result does not. Never merge them or derive one blindly from the
   other.

4. **Audit/assessment rows are immutable.** Never update-in-place where history matters. Insert a
   new row and move the `latest…Id` pointer in the **same transaction** (except an idempotent rerun
   reusing an identical row by fingerprint).

5. **Tenant isolation is mandatory.** Every query/insert scoped by `organizationId` **from the
   session, never a client param**. Org A must never see Org B. New read-model → add a
   cross-tenant test. (See `tenant-spine.md`.)

6. **Idempotency on all jobs/upserts.** Re-running a job or re-uploading a file must not duplicate
   rows. Use idempotency keys / content hashes, **not filenames**. (See `job-engine.md`.)

7. **No fake rows for display states.** Derive states like `NOT_SCORED` in the read-model / UI from
   `latest…Id IS NULL` — never insert placeholder rows to represent "not done yet."

8. **Soft-delete is respected everywhere.** Every read (lists, dashboards, exports, activity)
   filters `deletedAt IS NULL` where the model has it. Never hard-delete core records in normal
   flows.

9. **Secrets & webhooks are secured.** Credentials stored encrypted, never logged. Inbound webhooks
   **verify the provider signature before acting**; unsigned events are rejected.

10. **Suppression is the last gate before any send.** No email/notification leaves the system
    without a synchronous suppression check immediately before the provider call. No flag or fast
    path skips it.

11. **Unicode / locale identity normalization.** Entity matching normalizes Unicode (NFC), strips
    diacritics for comparison, and handles locale legal prefixes/casing (e.g. Vietnamese
    `Công ty` / `TNHH` / `CP`). Wrong normalization creates duplicate or merged records. Add
    fixtures.

12. **One phase / one change-kind per session.** Don't combine unrelated UI and backend work.
    `schema + mapper + read-model` may travel together only when explicitly scoped. Stay inside the
    allowed files; if the task needs more, stop and propose a scope correction.
    (See `session-decomposition.md`.)

13. **Tests are part of the exit gate.** Every session that introduces behavior (idempotency,
    tenant isolation, transition validity, suppression, a resolver branch) adds/updates its
    automated check. Green typecheck + build. Not an afterthought.

14. **SEE-IT pairing.** A run of backend-only sessions is followed by a UI surface that makes the
    work visible in a browser before the next feature cluster starts. (See `ui-kit.md`.)

15. **Never commit / never advance without review.** Do not commit unless explicitly asked. One
    session, then stop and append the session log. Do not auto-start the next phase. Refresh
    against actual git state before acting on any plan.

16. **Source-of-truth hierarchy.** Keep one canonical plan (`BUILD_PLAN.md`) + one ledger
    (`SESSION_LOG.md`). Docs marked historical are not executable. When plan and code disagree,
    reconcile before building — don't build on a stale assumption.
