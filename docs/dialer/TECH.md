# Dialer — technical notes

Companion to `ARCHITECTURE.md`, `SYSTEM_DESIGN.md` and `RUNBOOK.md`. The implementation reference: where each piece
lives, which existing helpers it reuses, and the rules a change to it must keep.

## Module map

| Path | Role |
|---|---|
| `lib/telephony/provider.ts` | Provider interface: `findCredentialByName`, `createCredential`, `revokeCredential`, `mintToken`, `command` (answer, hangup, transfer, record_start), `getRecordingUrl`, `deleteRecording`, `getBalance`, `getCallStatus` |
| `lib/telephony/telnyx/client.ts` | Telnyx REST client (fetch, timeout, retry on 429/5xx honouring `retry-after`, `command_id` on commands) |
| `lib/telephony/telnyx/verify.ts` | Ed25519 webhook verification over `${telnyx-timestamp}|${rawBody}`, 300 s skew window |
| `lib/telephony/fake.ts` | In-memory provider for tests |
| `lib/telephony/flags.ts` | `isTelephonyEnabled(tenantId)`, `effectiveDryRun(tenantId)` — mirrors `lib/emailSafety.ts`; demo tenants never dial |
| `lib/telephony/authToken.ts` | HMAC call token bound to `callId + userId + toE164`, 120 s TTL |
| `lib/telephony/compliance.ts` | `evaluateCallPermission` (pure); the only place that decides whether a call may be placed |
| `lib/telephony/gate.ts` | Loader: reads lead/contact, suppression, credential and settings for the session's tenant, then calls the pure gate |
| `lib/telephony/timezone.ts` | Lead-local time for the calling-hours rule |
| `lib/telephony/outcomes.ts` | The one outcome list, shared by UI and server |
| ~~`lib/telephony/inbound.ts`~~ | Not built: no inbound (owner decision, 2026-10-08) |
| `lib/telephony/callerId.ts` | Caller ID for a call: the country default, any number in the country, the overall default, any number, else the provider default; the tenant's active outbound numbers only |
| `lib/telephony/settingsInput.ts` | Zod rules for what a manager may write: countries (ISO-2, never `VN`), hours (0-1440, start before end), weekdays, "any time", retention 7-730 days, E.164 numbers |
| `lib/telephony/settingsAdmin.ts`, `settingsNumbers.ts`, `settingsAccess.ts` | Read and change a team's settings, numbers and softphone logins; the guard (interactive session, `MANAGER_ROLES`, tenant from the session); audit with before and after |
| `lib/telephony/health.ts` | The five health checks and their delivery through `notifyOps` |
| `lib/telephony/metrics.ts` | `countCalls` — the one call count every dashboard uses |
| `app/api/telephony/token/route.ts` | Mint a 24 h WebRTC token for the signed-in rep |
| `app/api/telephony/calls/route.ts` | Run the gate, write the `Call` row, return the call token |
| `app/api/telephony/calls/[id]/outcome/route.ts` | Wrap-up: outcome + notes after hangup |
| `app/api/telephony/calls/[id]/recording/route.ts` | Stream a recording to the caller or a manager |
| `app/api/telephony/telnyx/webhook/route.ts` | Public, signed webhook receiver → `TelephonyEvent` inbox |
| `workers/telephony.ts` | Applies inbox events to `Call` rows, writes the Activity once |
| `app/api/cron/telephony-reconcile`, `app/api/cron/telephony-health` | Replay / finalize stuck calls; ops alerts (scheduler secret; health refuses a manager session) |
| `app/settings/telephony/page.tsx`, `components/settings/telephony/*` | Phone & dialer settings page (managers) |
| `app/api/telephony/settings/**` | Settings, numbers and softphone-login endpoints behind the page |
| `components/dialer/useTelnyxClient.ts`, `components/dialer/Softphone.tsx` | Browser client and call UI |

## Reused, not rewritten

- Encryption: none needed for credentials (tokens are minted on demand; no password stored). If a secret
  ever has to be stored, `lib/crypto.ts` `encrypt`/`decrypt`.
- Phone numbers: `normalizePhoneIdentifier(raw, defaultCountry)` in `packages/core-identity/src/phone.ts`
  (libphonenumber-js) → E.164 at dial time. Default country: the lead's, else `VN`. **Never rewrite
  `Lead/Contact.normalizedPhone`:** dedupe compares it in the format `normalizePhone(phone)` writes (no
  country, so VN locals stay `0…`); inbound lookup matches every stored form of the caller's number instead.
- Time: `resolveTimezone`, `getLocalTime` (`lib/automation/timezone.ts`); single-zone inference from
  `lib/time/inferTimezone.ts`.
- Access: `canAccessLead`, `getLeadWhereScope`, `MANAGER_ROLES`, `requireManager` (`lib/auth.ts`,
  `lib/authRoles.ts`).
- Ops: `notifyOps` (`lib/ops/notifyOps.ts`), cron auth (`lib/cron/auth.ts`), `logAdminAudit` (`lib/audit.ts`).
- Queues: `lib/bullmq/types.ts` / `queues.ts` / `enqueue.ts` / `jobOptions.ts`, `createAppWorker`,
  registration in `workers/index.ts`.

## Rules every change must keep

1. **The gate is server-side.** No call connects unless `call.initiated` carries a valid call token for an
   `authorized` `Call` row and the calling-hours check still passes. Anything else is hung up (fail-closed).
2. **The browser never writes call history.** `Call` status moves only on verified provider events; the
   Activity (`call_made`, idempotency `call:<id>:final`) is written by the worker. The browser only adds
   the wrap-up outcome and notes to a call that has ended.
3. **Status only moves forward.** A late or repeated event cannot reopen a finished call.
4. **Every webhook is verified on the raw body** before anything is read from it; skew over 300 s is
   rejected; duplicates are dropped on `TelephonyEvent.providerEventId`.
5. **No secrets reach the browser** except the user's own short-lived WebRTC token.
6. **Recording URLs never reach the browser.** Playback streams through our route after an access check;
   each access is audited; recordings are deleted at `recordingPurgeAt` (the retention setting, default 90 days).
7. **Tenant on every query**, stated explicitly, not left to the request-scoped extension alone.
8. **Status updates are guarded in SQL**, not only in code: `UPDATE "Call" … WHERE status IN (<earlier
   states>)`, so a late or out-of-order webhook cannot overwrite a finished call.
9. **Soft links are checked, not trusted:** a `Call.activityId` / `missedCallTaskId` that points at a row
   that no longer exists means "recreate", not "done".
10. **`TelephonyEvent` is global (no tenantId, so no RLS policy)** and is read only by
    `lib/telephony/**`, the webhook route and `workers/telephony.ts` — `tests/telephony-schema.test.ts`
    fails if any other file touches it. Processed events are deleted after 30 days (Phase 4).
11. **Cross-tenant reads run in an explicit operator context** (inbound number → tenant, recording purge):
    under RLS a tenant-scoped read there returns nothing and looks like an empty result.
12. **Deactivating a rep revokes their Telnyx credential at the provider**, not only locally.
13. **`TelephonySettings` is upserted** (no row exists until a manager saves); `fallbackUserIds` are
    re-validated against active users when used.
14. **No 24-hour frequency rule** (owner decision, 2026-10-04). **Call any time** by default (owner decision,
    2026-10-08: hours 00:00-24:00, every day, no timezone needed); a manager may narrow the hours, and then they
    are lead-local and an unknown lead timezone blocks the call. Own Do-Not-Call list and lead/contact `doNotCall`
    always apply.
15. **Vietnam is never in `allowedCountries`** and is refused by the settings API: Vietnamese numbers are called
    from the rep's own phone and logged (`PhoneCallPanel`).
16. **Settings changes are audited** (`admin.telephony.settings`, `.kill`, `.number`, `.credential_revoke`) with the
    non-secret before and after; the environment switches are shown by state only, never a value.

## Browser requirements

- `next.config.ts` `Permissions-Policy` must allow `microphone=(self)` (it was `microphone=()`, which
  blocked every browser dialer).
- `lib/security/csp.ts` `connect-src` must include the Telnyx RTC host (`wss://rtc.telnyx.com`) before the
  CSP moves from report-only to enforced.
- One registered client per user: a BroadcastChannel lock stops a second tab from taking over incoming
  calls (Telnyx gives incoming calls to the newest registration).

## Configuration

Env group `Telephony` in `lib/env-contract.ts` (all-or-none): `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`,
`TELNYX_CREDENTIAL_CONNECTION_ID`, `TELNYX_CALL_CONTROL_APP_ID`, `TELNYX_OUTBOUND_VOICE_PROFILE_ID`,
`TELEPHONY_AUTH_SECRET`. Flags: `TELEPHONY_ENABLED` (on only for `true`), `TELEPHONY_DRY_RUN` (on unless
`false`), `TELNYX_BALANCE_ALERT_USD`, optional `TELNYX_CONCURRENCY_LIMIT` (a positive whole number; the health
cron skips the check when unset). Per-tenant settings (hours, countries, recording and notice, retention,
kill switch) live in `TelephonySettings` and caller IDs in `TelephonyNumber`; both are edited on
`settings/telephony`. (`fallbackUserIds` and `inboundRingSecs` are unused: no inbound.)

Account setup: `docs/dialer/TELNYX_SETUP.md`.
