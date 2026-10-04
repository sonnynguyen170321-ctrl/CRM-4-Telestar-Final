# TASKS — Telnyx Dialer

Owner: **C** = Claude (code), **O** = Owner (account, ops, production). Each phase is one PR, merged on
green CI. Tests are Postgres-backed: `createTestTenant` (`tests/helpers/testTenant.ts`), a second tenant
for isolation, route handlers imported directly.

**Standard Definition of Done (every code phase)**
1. Tests written first (red), then the code (green).
2. Mutation check on the phase's critical files: hand-made mutants (break a rule, run the suite, expect
   red, restore — the practice used on every PR since 2026-09), no survivors.
3. Reviews: code-reviewer + security-reviewer (+ database-reviewer for schema); reviewers are told never
   to `git checkout`.
4. Merge main, regenerate registries: `npm run agent -- facts`, route coverage/authorization, RLS inventory.
5. Full serial `npm test` + `next build` green.
6. Deploy with `scripts/deploy.sh` (pre-deploy backup) and smoke.

---

## Phase 0 — Safety, account, planning
| ID | Task | Files | Tests | Deps | Owner |
|---|---|---|---|---|---|
| D0.1 | Backup + restore-drill commands (isolated drill Postgres) | `docs/BACKUP_RESTORE_RUNBOOK.md` | — | — | C |
| D0.2 | Run `backup.sh --tag pre-dialer --offsite`; restore into the drill DB; compare row counts; record evidence | runbook | Counts match | D0.1 | O |
| D0.3 | Telnyx setup per `docs/dialer/TELNYX_SETUP.md`: Level 2; concurrency raise to ≥40; outbound voice profile; credential connection (parking on, webhook + failover); Call Control app; VN number; auto-recharge; keys into the VPS env | `TELNYX_SETUP.md` | — | — | O |
| D0.4 | Written Telnyx answers: VN rates, caller ID into VN, Voice Brandname, `clientState` on `call.initiated` | `docs/dialer/TELNYX_ANSWERS.md` | — | D0.3 | O |
| D0.5 | Spike (throwaway branch): SDK `clientState` / `X-` header reaches `call.initiated`; park→connect latency | throwaway | Live: 10 calls, p95 < 1.5 s | D0.3 | C+O |
| D0.6 | Planning docs (PRD, ARCHITECTURE, SYSTEM_DESIGN, TECH, TASKS, ADR-001, TELNYX_SETUP); `telephony` domain | `docs/dialer/*`, `.agent/registry/domains.yaml` | Registry check | — | C |

**GO/NO-GO #1 (spike):** if the token cannot reach `call.initiated`, switch to server-originated
click-to-call and update ADR-001 before Phase 2.

## Phase 1 — Schema
| ID | Task | Files | Tests | Deps | Owner |
|---|---|---|---|---|---|
| D1.1 | Migration `telephony_core`: `Call` (status/outcome enums, compliance JSON, recording fields, unique `activityId`/`missedCallTaskId`, unique `[provider, providerSessionId]`), `TelephonyCredential`, `TelephonyNumber`, `TelephonyEvent` (unique `providerEventId`), `TelephonySettings`, `PhoneSuppression` | `prisma/schema.prisma`, `prisma/migrations/*_telephony_core` | Migration order, stale models | D0.6 | C |
| D1.2 | `doNotCall`/`doNotCallAt`/`doNotCallReason` on Lead and Contact; index `[tenantId, normalizedPhone]` | schema | Unique/index tests | D1.1 | C |
| D1.3 | ~~Backfill E.164 into `normalizedPhone`~~ **Dropped (2026-10-05):** `normalizedPhone` is written by `normalizePhone(phone)` without a country (VN locals stay `0…`) and lead/contact dedupe compares it, so rewriting it to E.164 would make new imports miss backfilled rows and create duplicates. Instead: E.164 is computed at dial time (D3.1), and inbound matches a caller against every stored form of the number (D6.1). | — | — | — | — |
| D1.4 | Gates: RLS, sanitize coverage (phones, notes, payloads, recording id), soft foreign keys, seed delete order | gate configs | Each gate passes, and fails when the entry is removed | D1.1 | C |

## Phase 2 — Provider adapter + token endpoint
| ID | Task | Files | Tests | Deps | Owner |
|---|---|---|---|---|---|
| D2.1 | Provider interface, Telnyx client, fake provider | `lib/telephony/provider.ts`, `telnyx/client.ts`, `fake.ts` | Contract tests on the fake | D1.1 | C |
| D2.2 | Ed25519 verifier, 300 s skew | `lib/telephony/telnyx/verify.ts` | Valid / tampered / ±301 s / missing header. Mutants: skew, signature check | D2.1 | C |
| D2.3 | Flags mirroring `lib/emailSafety.ts` (enabled, dry-run, demo tenants never dial) | `lib/telephony/flags.ts` | Flag matrix | D2.1 | C |
| D2.4 | HMAC call token bound to callId + user + number + expiry | `lib/telephony/authToken.ts` | Expired / other user / other call / tampered. Mutants: expiry, binding | — | C |
| D2.5 | Token route (session + flag, lazy idempotent credential, `no-store`, rate-limited) | `app/api/telephony/token/route.ts` | 401, flag off, idempotent credential, tenant isolation | D2.1–3 | C |
| D2.6 | Remove the password from the old dialer config route | `app/api/dialer/config/route.ts`, `tests/dialer-config-route.test.ts` | No secret in the response | — | C |
| D2.7 | `Telephony` env group | `lib/env-contract.ts`, `crm.env.example`, `scripts/prod-check-env.ts` | Env contract test | — | C |
| D2.8 | Production env values | VPS env | `prod-check-env` passes | D2.7 | O |

**Done 2026-10-04 (D2.1–D2.7).** Changes from the plan, from the security and code reviews: concurrent
first requests for a rep share one in-process creation (not a database lock — the provider call must
not hold a pooled connection, or the 08:00 first logins would starve the app's pool); `createCredential`
is never retried and a credential is adopted by its exact name (`crm:<tenant>:<user>`) when an earlier
create's answer was lost; an unsaved credential is revoked unless another row holds it; a signing
secret under 32 characters (or with surrounding whitespace) counts as not configured; the deploy gate (`lib/telephony/envCheck.ts`) fails
an enabled dialer with a missing or malformed variable. Every staff role may get a token — the `Role`
enum has no client or viewer role; revisit if one is added.

## Phase 3 — Compliance gate
| ID | Task | Files | Tests | Deps | Owner |
|---|---|---|---|---|---|
| D3.1 | Pure `evaluateCallPermission`, ordered rules, all reasons collected, exception ⇒ `gate_error` | `lib/telephony/compliance.ts` | Table-driven: 07:59:59 / 08:00 / 16:59:59 / 17:00 in VN and US zones; suppression; DNC flag; country; invalid E.164; **repeat call allowed**. Mutants: every comparison and rule short-circuit | D1.2, D2.3 | C |
| D3.2 | Timezone: phone country (single zone) → lead timezone (region zone inside the number's country) → record country (same country as the number) → `tz_unknown` | `lib/telephony/timezone.ts` (reuses `lib/automation/timezone.ts`, `lib/time/inferTimezone.ts`) | Single- and multi-zone countries (US, AU) | D3.1 | C |
| D3.3 | Loader + `POST /api/telephony/calls` (Call row authorized/blocked with snapshot; returns token) | `app/api/telephony/calls/route.ts` | Blocked attempt audited; `canAccessLead` denial; cross-tenant 404 | D3.1, D2.4 | C |

**Done 2026-10-04 (D3.1–D3.3).** Decisions made while building it:
- The number always comes from the record (the lead's phone, or its own contact's), never the browser.
- A national number is read with the record's country (contact, then account), then as `VN`, so a
  Vietnamese "0948…" on a lead whose company is in Singapore is still dialable.
- A record with no dialable number gets 422 and **no** `Call` row (`toE164` must be a valid E.164).
- Dry-run writes the attempt as `blocked` with `dry_run` added to its reasons and `wouldBeAllowed`.
- A lead the rep may not work is answered exactly like a missing one (404, no row, a server log line),
  so the route reveals nothing about leads the rep cannot see; another tenant's or an archived lead is
  the same 404.
- One attempt per rep per 3 s (database check + an in-process guard against parallel requests); repeat
  calls are otherwise unlimited. The token is signed before the row is written.
- The country allow-list is judged on the dialled number, not the record. Premium-rate and
  shared-cost numbers are blocked (`number_type_not_allowed`, libphonenumber full metadata via
  `@telestar/core-identity/phone-type`).
- **Timezone order changed from the plan (security review):** the number's zone first when its country
  has one zone — `lead.timezone` is rep-editable, so trusting it first let a rep move a 21:00 Hanoi call
  into hours by setting the lead to Auckland. `lead.timezone` is used only for multi-zone numbers, and
  only a region/city zone inside that country; the record's country only when it is the number's.
  Spain (+34, Canaries), Portugal (+351, Azores) and New Zealand (+64, Chatham) share one calling code
  across zones, so the gate treats them as multi-zone (code review).

## Phase 4 — Webhooks, worker, reconciliation
| ID | Task | Files | Tests | Deps | Owner |
|---|---|---|---|---|---|
| D4.1 | Webhook route: verify → inbox insert (on conflict do nothing) → `call.initiated` inline (token + hours → connect or hang up, fail-closed) → enqueue the rest → 200 | `app/api/telephony/telnyx/webhook/route.ts` | Bad signature 401; duplicate; out-of-order; invalid token ⇒ hangup; **re-run the pure gate at `call.initiated`** (hours, suppression, DNC — a call authorized at 16:59:59 must not connect at 17:00); **token used twice ⇒ second hangup** (claim the `Call` row `authorized → initiated` with a guarded update: the HMAC token alone is replayable for its 120 s); event id seen twice ⇒ one inbox row (signature only bounds replay to 300 s); 5xx only on insert failure | D2.2, D3.3 | C |
| D4.2 | Proxy matcher exclusion; route-authorization `public` reason | `proxy.ts`, registry | Authorization coverage gate | D4.1 | C |
| D4.3 | `telephony` queue + worker: correlate by session id, forward-only status, finalize duration/cause, write `call_made` once (`call:<id>:final`) | `lib/bullmq/types.ts`, `queues.ts`, `jobOptions.ts`, `workers/telephony.ts`, `workers/index.ts` | Replay ⇒ one Activity. Mutants: status order, idempotency key | D4.1 | C |
| D4.4 | Reconcile cron (5 min): replay unprocessed events, cancel stale `authorized`, finalize stuck calls | `app/api/cron/telephony-reconcile/route.ts` | `CRON_SECRET` required; each repair branch | D4.3 | C |
| D4.5 | Webhook + failover URL set in Telnyx; cron installed | VPS crontab | Live test event | D4.4 + deploy | O |

## Phase 5 — Softphone rewrite
| ID | Task | Files | Tests | Deps | Owner |
|---|---|---|---|---|---|
| D5.1 | Client hook: one client per browser (BroadcastChannel lock), token refresh on 34001, registration status | `components/dialer/useTelnyxClient.ts` | Mocked SDK: refresh, second tab locked | D2.5 | C |
| D5.2 | Softphone state machine; mute/hold/DTMF/device picker; mic-permission and no-phone errors | `components/dialer/Softphone.tsx` | Transition tests | D5.1, D3.3 | C |
| D5.3 | One outcome list; outcome route (own call, final status, 24h); `do_not_call` ⇒ suppression + DNC flag | `lib/telephony/outcomes.ts`, `app/api/telephony/calls/[id]/outcome/route.ts`, `components/LeadDetailPanel.tsx` | Other user 403; non-final 409; >24h rejected; DNC writes both | D4.3 | C |
| D5.4 | `microphone=(self)`; Telnyx RTC in CSP `connect-src` | `next.config.ts`, `lib/security/csp.ts` | Header/CSP tests | — | C |
| D5.5 | Delete `CallDialerModal.tsx`, `/api/dialer/config` and its test | — | Route coverage regenerated | D5.2 | C |
| D5.6 | E2E (mocked SDK): blocked reasons, timezone fix, call → wrap-up → saved, no-phone error | `e2e/leads/dialer.spec.ts` | — | D5.3 | C |

## Phase 6 — Inbound + missed calls
| ID | Task | Files | Tests | Deps | Owner |
|---|---|---|---|---|---|
| D6.1 | Number → tenant; caller → Lead/Contact (match `normalizedPhone` against the caller's E.164, international digits and national `0…` forms) → owner; transfer to owner, then fallback | `lib/telephony/inbound.ts`, worker | Owner answers; fallback answers; a lead stored as `0948…` matches a `+84948…` caller; tenant isolation | D4.3 | C |
| D6.2 | Missed: voicemail, `missed`, one task (dedupe), notification; unknown caller ⇒ stub lead | `lib/telephony/inbound.ts` | Duplicate event ⇒ one task. Mutants: dedupe | D6.1 | C |
| D6.3 | Point the VN number at the Call Control app | Telnyx portal | Live inbound test | D6.2 + deploy | O |

## Phase 7 — Recordings
| ID | Task | Files | Tests | Deps | Owner |
|---|---|---|---|---|---|
| D7.1 | Consent notice; store `recordingProviderId` on `call.recording.saved`; set `recordingPurgeAt` | worker, `lib/telephony/recording.ts` | Event stores the id | D4.3 | C |
| D7.2 | Playback route: `canAccessLead` + (caller or `MANAGER_ROLES`); fresh URL streamed; access audited | `app/api/telephony/calls/[id]/recording/route.ts` | Role matrix (non-caller SDR 403, team lead 200, other tenant 404); audit row. Mutants: role check | D7.1 | C |
| D7.3 | Purge at `recordingPurgeAt` | `workers/telephony.ts` | Day 89 kept, day 90 deleted | D7.1 | C |

## Phase 8 — One call count everywhere
| ID | Task | Files | Tests | Deps | Owner |
|---|---|---|---|---|---|
| D8.1 | `countCalls(scope, range, attempts|connected)` from `Call` + legacy Activity without callId | `lib/telephony/metrics.ts` | Golden fixture, no double count | D4.3 | C |
| D8.2 | Switch every consumer | `app/api/team/leaderboard/route.ts`, `lib/dashboard/myDay.ts`, `app/api/team/campaigns/[id]/route.ts`, `lib/client-reports/metrics.ts`, `lib/contact-intelligence/service.ts`, `app/api/v1/calls/route.ts`, `app/page.tsx` | Same number everywhere for the fixture | D8.1 | C |

## Phase 9 — Operations
| ID | Task | Files | Tests | Deps | Owner |
|---|---|---|---|---|---|
| D9.1 | Health cron via `lib/ops/notifyOps.ts`: balance, failure rate, webhook silence, backlog, concurrency 80% | `app/api/cron/telephony-health/route.ts` | Each threshold boundary; dedupe. Mutants: comparisons | D4.4 | C |
| D9.2 | Settings page (managers, `logAdminAudit`) | `app/settings/telephony/page.tsx`, `app/api/telephony/settings/route.ts` | Non-manager 403; kill switch blocks the next gate call; audit old/new | D3.1 | C |
| D9.3 | Runbook: outage, balance, kill switch, rollback | `docs/dialer/RUNBOOK.md` | — | D9.1 | C |
| D9.4 | Install the health cron; test-fire each alert | VPS | Alerts received | D9.1 + deploy | O |

## Phase 10 — Pilot and rollout
| ID | Task | Deps | Owner |
|---|---|---|---|
| D10.1 | Dry-run on production for 1 manager; check gate logs | D9.4 | O+C |
| D10.2 | 3 SDRs for 1 week; daily review (connect rate, blocks, webhook lag, alerts, CDR match) | D10.1 | O+C |
| D10.3 | Inbound for the pilot SDRs | D6.3, D10.2 | O |
| D10.4 | Floor in batches of 10 | GO #2, GO #3 | O |
| D10.5 | Remove `SIP_*` env; close the runbook | D10.4 | O+C |

**GO/NO-GO #2 (concurrency):** Telnyx confirms ≥40 in writing and the voice-profile limit is set,
before D10.4.
**GO/NO-GO #3 (pilot review):** ≥5 working days with dropped calls < 1%, zero phantom calls, 100% CDR
match, no wrongly allowed calls, acceptable VN answer rate. Rollback = kill switch; manual call logging
stays available.
