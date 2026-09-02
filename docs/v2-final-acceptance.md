# V2 Final Acceptance — baseline + decisions (pre-AWS finale)

Tracking doc for the finale/polish pass (plan: `.hermes/plans/2026-07-02_230534-v2-final-polish-aws-migration.md`).

## Baseline (2026-07-03)

| Gate | Result | Known pre-existing failures |
| --- | --- | --- |
| `npm run typecheck` | PASS | — |
| `npm run lint` | 3 errors / 52 warnings | `lib/v2/bullmq/facetCache.ts` (2× `no-explicit-any`); `components/v2/contacts/ContactFilterPanel.tsx:122` (setState-in-effect, saved-filters WIP) |
| `npx vitest run lib/v2` | 145 pass / 1 fail | `campaignRuntimePolicy.test.ts` + `identity/__tests__/debug-errors.test.ts` require `DATABASE_URL` (env-dependent, not logic) |
| Scanners | PASS | `check-v2-readmodel-filters`, `check-v2-revalidation`, `check-v2-pipeline-linkage` green |

New failures introduced by finale work must be fixed in the phase that introduces them; the
rows above are the accepted starting debt.

## Already shipped this branch (do not re-plan)

- Extraction quality: soft-404/thin-page gate, sentence evidence, hiring specificity.
- Scoring: graduated v2 engine (`assessIcpRulesV2`) wired as the single production path;
  coarse assessor retired; ICP editor authors persona tiers/dimension weights.
- Leads: priority-ranked queue + focus-deck drawer (optimistic desk actions, prev/next,
  keyboard, brainstorm canvas + heuristic outreach angles).
- SDR permission reframe + review-queue relabel; qualify override reachable from lead /
  contact / company surfaces with forward-only assessment pointer.

## Decisions for the plan's open questions (defaults — flag to change)

1. **LinkedIn access signal**: deterministic-first. Uploaded status columns + URL shape
   validation + contact-quality reason codes now; reachability probe sits behind a provider
   adapter interface (OFF by default, env-gated). No scraping inside scoring.
2. **AWS target**: ECS/Fargate (separate `web` + `worker` services, ElastiCache Redis, RDS
   Postgres, S3 for file artifacts). App Runner rejected: no long-running worker separation.
3. **User creation**: admin creates users directly in Settings with a temporary password +
   forced reset on first login. Invite-by-email deferred (no SES dependency pre-migration).
4. **AI outreach copy**: suggest-only; human approves before anything is saved/sent.
5. **Upload size**: current DB-backed storage up to 20k rows/file documented; S3 multipart
   is a post-migration follow-up.

## Finale progress (this branch)

| Phase | Status | Commit |
| --- | --- | --- |
| P0 baseline + acceptance doc | ✅ | this file |
| P1 BullMQ durable bridge (send/sequence/export) | ✅ | 5c5ee01 |
| P2 uploads stepper + preflight + wired controls | ✅ | 97d354a |
| P3 contact quality + LinkedIn access + filter | ✅ | 907b0cc |
| P4 richer taxonomy (+10 cats) + 8 ICP templates + picker | ✅ | pushed |
| P5 scoring explainability in the lead drawer | ✅ | pushed |
| P6 UI modernization | ◐ partial — leads/uploads modernized + ICP template picker; broad page-redesign deferred (needs browser) |
| P7 outreach readiness score + inbox reply classifier | ✅ | pushed |
| P8 AI console completion | ✅ mostly pre-existing (budget %, per-provider health/last-error, usage, run log, test-connection, kill via settings). Remaining: compose AI-suggest — needs AI enabled + browser |
| P9 settings user-CRUD | ✅ b94ed1c — admin create/disable/role, anti-lockout, audited |
| P9 reviews completion | ✅ resolve + evidence panel + source/priority filter bar; bulk-resolve remains (needs a batch route) |
| P10 AWS runbook + health | ✅ | `docs/aws-migration-runbook.md` (health endpoints already existed) |
| P11 wiring audit | ✅ | typecheck/vitest(168)/scanners green for finale files; readmodel FAIL is pre-existing WIP only |

## Required end-to-end flows (final QA checklist)

- [ ] Upload company CSV/XLSX → map columns → process to completion (stage-by-stage visible)
- [ ] Upload contact CSV/XLSX → identity match → lead upsert
- [ ] Company enrichment produces rich, evidence-cited intelligence
- [ ] Contacts with bad/private/404/no LinkedIn are reason-coded + filterable
- [ ] Scoring runs (BullMQ) → graduated assessment → lead queue filters reflect outcomes
- [ ] NEEDS_REVIEW items resolvable in /v2/reviews (writes back + audits)
- [ ] Qualified leads enroll into a campaign; dry-run send gates hold; suppression is final gate
- [ ] Export produces durable output incl. quality/reason columns
- [ ] /v2/jobs + /v2/runtime/health show queue health + terminal job states
- [ ] Web + worker boot from env only (AWS matrix in `docs/aws-migration-runbook.md`)
