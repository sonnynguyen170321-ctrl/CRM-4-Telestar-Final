# PRD — Telnyx Dialer (Outbound; inbound dropped)

> **Revised 2026-10-08 (owner decisions, `TASKS.md`).** This document keeps its original text; where a
> later decision replaced it, the old text is struck through or marked *Superseded* with the new rule
> beside it. In force today:
> - **Outbound only, no inbound.** G4, US5 and US6 are not built.
> - **Vietnam is never dialled through Telnyx.** Vietnamese numbers are called from the rep's own phone and logged in the CRM (`components/dialer/PhoneCallPanel.tsx`). The softphone serves other countries; `allowedCountries` never holds `VN`.
> - **Call any time** by default: hours 00:00-24:00 every day. A manager can still narrow hours and weekdays; the 08:00-17:00 rule below is now only an option, not the default.
> - **Recording on, no spoken notice by default**; the notice is a manager toggle. Retention is a manager setting (default 90 days).
> - **Whole team at once**, no pilot batches: one manager's live check on production, then everyone (stages 2 to 4 of section 8 are replaced).
> - Telnyx stays the provider (the Plivo option was dropped).

## 1. Problem
~34 SDRs place 30+ concurrent calls to Vietnam and international numbers. The current dialer
(`components/CallDialerModal.tsx`, sip.js) cannot work in production and is unsafe: `next.config.ts`
blocks the microphone, one SIP password is served to every browser (`/api/dialer/config`), numbers are
dialed as raw digits (no E.164), it hangs when a lead has no phone, the outcome form shows while still
dialing, and a "call" exists only because the rep typed it (no provider id, recording or duration field).
Call counts disagree across the leaderboard, My Day, client reports and contact intelligence.

## 2. Goals
- G1 Click-to-call from the lead drawer works all day with no shared secret in the browser.
- G2 Server-side, non-bypassable compliance gate (own DNC list, country, number type, and hours when a manager has narrowed them).
- G3 Every call record is created and advanced only by signed Telnyx webhooks.
- ~~G4 Inbound hotline rings the lead owner, then a fallback chain; a missed call never goes unseen.~~ *Superseded 2026-10-08: no inbound.*
- G5 Calls are recorded, kept 90 days, playable only by the caller and managers.
- G6 One call count across every surface.
- G7 Managers can stop, pause or tune dialing without a deploy.

## 3. Non-goals
- Predictive/auto-dialer or power-dial queues.
- Importing the national Do-Not-Call registry (own list + lead DNC flag only, for now).
- Any per-24h frequency cap (owner decision).
- Call transcription or AI call scoring.
- A Vietnam-licensed trunk in this release (the provider seam only makes it possible later).

## 4. Personas
| Persona | Needs |
|---|---|
| SDR | Dial fast, see clearly why a call is blocked, take inbound calls from own leads, log the outcome once |
| Team lead | Listen to team recordings, see team connect rate, be in the fallback chain |
| Floor manager | Kill switch, calling hours, countries, fallback chain, live health |
| Director | One trusted call count across dashboards and client reports |
| Ops/Owner | Telnyx account, balance, concurrency, backups, alerts, rollout decisions |

## 5. User stories and acceptance criteria

**US1 Click-to-call from the lead drawer (SDR)**
- AC1 Call → `POST /api/telephony/calls`; a blocked attempt is stored as a `Call` (`status=blocked`) with a compliance snapshot.
- AC2 When blocked, the softphone lists every reason in plain language (outside the calling hours, when narrowed; on our DNC list, lead flagged DNC, country not allowed, invalid number, no phone, no microphone permission, dialer disabled, gate error).
- AC3 `tz_unknown` shows an inline "Set lead timezone" control; after saving, the gate re-runs without closing the drawer.
- AC4 A lead with no phone shows an immediate error and never sits on "connecting".
- AC5 A repeat call to the same number within 24h is allowed.

**US2 In-call controls (SDR)**
- AC1 Mute, hold, DTMF keypad, audio device picker, live call timer.
- AC2 Registration indicator (registered / reconnecting / offline); token refresh with no visible gap.
- AC3 Opening the dialer in a second tab shows "dialer active in another tab".

**US3 Wrap-up only after hangup (SDR)**
- AC1 The outcome form appears only in `wrap_up`, after hangup.
- AC2 Outcomes come from one list (`lib/telephony/outcomes.ts`); Gatekeeper is its own outcome.
- AC3 `PATCH /api/telephony/calls/[id]/outcome` accepts only the rep's own call, in a final status, within 24h.
- AC4 Duration and status come from the provider, never from the form.

**US4 Do-not-call outcome (SDR)**
- AC1 `do_not_call` adds a `PhoneSuppression` row and sets `lead.doNotCall` (+ time, reason).
- AC2 Any later attempt to that number by anyone in the tenant is blocked.

**US5 Inbound hotline (SDR, team lead)** — *Superseded 2026-10-08: not built (no inbound).*
- AC1 Caller matched by `[tenantId, normalizedPhone]` (Lead, then Contact); the owner's softphone rings for `inboundRingSecs` (default 20).
- AC2 No answer → `fallbackUserIds` in order.
- AC3 Inbound skips hours and DNC rules.

**US6 Missed-call task (SDR)** — *Superseded 2026-10-08: not built (no inbound).*
- AC1 No answer anywhere → voicemail (recording on) → `status=missed` → a "Missed call from …" Task to the owner (or first fallback) + notification.
- AC2 Exactly one task per call (`missedCallTaskId` unique).
- AC3 Unknown caller → stub Lead (number as name, `source=inbound_call`) + the task.

**US7 Recording playback (SDR, managers)**
- AC1 A consent notice plays at call start. *Revised 2026-10-08: only when the manager turns "recording notice" on; off by default.*
- AC2 `GET /api/telephony/calls/[id]/recording` requires `canAccessLead` and (caller or `MANAGER_ROLES`); anyone else gets 403.
- AC3 Each play fetches a fresh Telnyx URL; every access is written with `logAdminAudit`.
- AC4 After 90 days (`recordingPurgeAt`) the recording is deleted at Telnyx and the UI says "expired".

**US8 Manager settings (floor manager, director)**
- AC1 `settings/telephony` (built, PR F): kill switch, dry-run, any-time toggle and hours/weekdays (default 00:00-24:00 every day), allowed countries (never Vietnam), recording on/off, recording notice, retention days (7 to 730, default 90), caller ID numbers with per-country and overall defaults, softphone logins with revoke, and the server switches shown read-only. ~~Inbound ring seconds and fallback chain~~ *superseded: no inbound.*
- AC2 The kill switch blocks new calls from the next gate evaluation, no deploy.
- AC3 Every change is audited with old and new values.

**US9 Ops alerts (Owner)**
- AC1 5-minute health check via `notifyOps` (built, PR F): balance below `TELNYX_BALANCE_ALERT_USD`; failure rate >20% in 15 min (≥10 calls); no webhooks for 30 min while calls were placed (replaces "during working hours": the team calls any time); event backlog >50; concurrency ≥80% of `TELNYX_CONCURRENCY_LIMIT` when set.
- AC2 Alerts are de-duplicated and link to `docs/dialer/RUNBOOK.md`.

**US10 Consistent dashboards (Director)**
- AC1 Leaderboard, My Day, campaign stats, client reports, contact intelligence, the public calls API and Home all use `countCalls(scope, range, attempts|connected)`.
- AC2 Legacy manual Activity rows without a callId count once; nothing counts twice.

## 6. Success metrics
| Metric | Target |
|---|---|
| Connect rate (answered ÷ authorized), VN mobile | Baseline in pilot week 1; no drop >10% at floor rollout |
| Dropped calls (`failed` after `answered`) | < 1% |
| Wrong blocks (pilot review) | < 0.5% of attempts; zero wrongly allowed calls |
| Webhook lag p95 | < 2 s; park→connect < 1.5 s |
| Phantom calls (Activity without a confirmed Call) | 0 |
| CRM calls vs Telnyx CDRs, daily | 100% match |

## 7. Compliance requirements
- **Decrees 91/2020 and 330/2026 (Vietnam):** outbound marketing calls only 08:00–17:00 lead-local. *Revised 2026-10-08: Vietnamese numbers are not called through the dialer at all (own phone, logged), so this no longer binds the gate by default; the calling-hours machinery stays for any manager who narrows the hours, and then also applies again when `call.initiated` arrives and an unknown timezone blocks the call.*
- **Own Do-Not-Call list:** `PhoneSuppression` + lead/contact `doNotCall`, checked before every outbound call; the `do_not_call` outcome adds to it. Calling a number on the national list is fined 160–180 million VND for organisations; importing that list is a later decision.
- **Voice Brandname risk** *(superseded 2026-10-08: Vietnam is not dialled through Telnyx)*: Vietnamese operators may block marketing calls over VoIP without a registered brand name. Telnyx's written answer is required before the pilot; the pilot answer rate is the signal; fallback is a Vietnam trunk behind the same provider interface.
- **Recordings are personal data:** optional consent notice (off by default), purge at the retention setting (default 90 days), role-limited and audited access, recordings stay at Telnyx.
- **Secrets:** `TELNYX_API_KEY` and `TELEPHONY_AUTH_SECRET` stay server-side; browsers get short-lived per-user tokens; webhooks are Ed25519-verified with a 300 s skew limit.

## 8. Release criteria
| Stage | Criteria |
|---|---|
| 0 Pre-build | Backup verified by a restore drill; Telnyx Level 2; spike: token reaches `call.initiated`, park→connect < 1.5 s |
| 1 Dry-run, 1 manager | Gate decisions logged, no calls placed; zero 5xx from the webhook route; alerts fire on a test trigger |
| ~~2 Pilot, 3 SDRs, 1 week~~ | *Superseded 2026-10-08: replaced by one manager's live check on production (`TELNYX_SETUP.md` section 9), then the whole team.* |
| ~~3 Pilot inbound~~ | *Superseded: no inbound.* |
| 4 Whole team at once | Concurrency ≥40 confirmed in writing; dropped calls < 1% in the first week; 100% CDR match; kill switch rehearsed (`RUNBOOK.md`) |
| 5 Cleanup | `SIP_*` env removed; `/api/dialer/config` gone; runbook signed off |

## 9. Open risks
- Concurrency raise not granted before the floor rollout (blocks stage 4).
- ~~Vietnamese caller-ID / brandname rejection lowers the answer rate.~~ *Superseded: Vietnam is called from the rep's own phone.*
- The SDK's `clientState` does not reach `call.initiated` on a parked call → server-originated click-to-call (more latency).
- Webhook outage → failover URL, inbox table, reconcile cron.
- Balance runs out mid-shift → auto-recharge, alert, daily spend cap.
- Imported leads without a timezone cause many `tz_unknown` blocks → inline fix + backfill.
