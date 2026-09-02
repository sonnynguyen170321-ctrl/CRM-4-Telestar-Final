# LEARN — understand the spine you just shipped

You built TeleStar V2 over a month. This is a read-order to *understand* it, so the next SaaS isn't
a black box. Do one step per sitting. Each step: **read one file, answer one question** (out loud or
in a note). The goal is not to memorize code — it's to see *why* each piece exists.

## 1. Tenant isolation — the thing that makes it multi-tenant
**Read:** `lib/v2/tenant/requireTenantContext.ts`
**Question:** where does `organizationId` come from, and why is it fatal to ever take it from a
client parameter instead? Trace what would happen if one query forgot to filter by it.
→ deep dive: `reference/tenant-spine.md`, `reference/invariants.md` #5

## 2. Auth — how a login becomes a trusted session
**Read (in order):** `lib/v2/auth/password.ts` → `lib/v2/auth/session.ts` → `scripts/v2-signup.mjs`
**Question:** why is the password stored as `scrypt$salt$key` with a pepper, and why is only the
*hash* of the session token stored (not the token)? What does a DB leak get an attacker in each
case?

## 3. Wiring — how a screen reads and writes data safely
**Read:** one read-model `lib/v2/crm/queryContactLeads.ts` + one action `app/v2/crm/companies/actions.ts`
**Question:** why do reads go through a `query*.ts` read-model and writes through a `"use server"`
action, instead of querying Prisma inside the component? What does that boundary protect?
→ deep dive: `reference/api-wiring.md`

## 4. Jobs — how slow work leaves the request
**Read:** `lib/v2/jobs/enqueueJob.ts` (the idempotency check) + skim `scripts/v2-runtime-worker.mjs`
**Question:** what stops a re-uploaded file from creating duplicate work? Why can the same enqueue
call run with Redis in prod and *without* Redis in dev?
→ deep dive: `reference/job-engine.md`

## 5. Deploy — how the four containers become a live site
**Read:** `deploy/aws-ec2/CONSOLE-SETUP.md` + `reference/deploy-ec2.md` (the gotcha ledger)
**Question:** name what each container does (web, worker, imap, migrate) and why `migrate` runs
*before* the others. Recall three gotchas that cost you real time on go-live.

## 6. The spine as a whole
**Read:** `AGENTS.md` (the 16 invariants) + `reference/session-decomposition.md`
**Question:** the #1 pain was sessions not linking. How do `BUILD_PLAN.md` + `SESSION_LOG.md` +
"one change-kind per session" fix that? Could you have built TeleStar faster with this spine from
day one?

---

**When you can answer all six without re-reading**, you understand the stack well enough to run
`saas-builder` on a new product and trust what it produces.
