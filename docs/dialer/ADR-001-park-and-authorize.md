# ADR-001: Park and authorize outbound calls server-side

## Status
Proposed (2026-10-04). Built (outbound webhook, worker, reconcile; 2026-10-10). **Accepted once the live check
passes** (`TELNYX_SETUP.md` section 9 replaced the Phase 0 spike branch, per the owner decisions of 2026-10-08).

## Amendments, 2026-10-08
- The gate's hours rule is no longer a fixed 08:00-17:00: the owner chose **call any time**, so by default no clock
  rule applies and no timezone is needed (`isAlwaysOpen`). Where a manager narrows the hours, everything below about
  checking hours twice still holds.
- **Vietnam is not dialled through Telnyx** (the rep's own phone, logged in the CRM). The spike plan's Vietnamese
  mobile/landline measurements below are superseded: the live check uses numbers abroad that the team owns.
- No inbound calling, so only the outbound half of this decision is built.
- The kill switch, dry run and enabled flag are manager settings (`settings/telephony`), so "stops dialing immediately"
  below needs no deploy.

## Context
Every rep's browser holds a Telnyx credential through `@telnyx/webrtc`, and a credential can dial any
number its outbound voice profile allows. The owner requires our Do-Not-Call list (`PhoneSuppression`),
the lead/contact `doNotCall` flag and calling hours (originally 08:00–17:00 lead-local; now a manager setting, any time by default) to be enforced — and anything
enforced only in the browser can be skipped from devtools. The current dialer
(`components/CallDialerModal.tsx`) enforces nothing, and a call "happened" only because the rep typed it.
We need proof that every outbound call was checked, and a `Call` row recording what was allowed and why.

## Decision
The credential connection has outbound **call parking** on. `POST /api/telephony/calls` runs
`evaluateCallPermission` (`lib/telephony/compliance.ts`), writes an `authorized` or `blocked` `Call` with
the compliance snapshot, and returns a short-lived HMAC call token (`lib/telephony/authToken.ts`, 120 s)
bound to `{callId, tenantId, userId, toE164, exp}`. The softphone passes the token on `newCall`
(`clientState`, or an `X-` custom header). Telnyx parks the call and sends `call.initiated` to
`app/api/telephony/telnyx/webhook/route.ts`, which verifies the Ed25519 signature, then the token and its
binding (destination and the credential's user), then re-checks hours and the kill switch, and transfers
the call — or hangs up and marks the row `blocked`. A missing or invalid token, or any error, fails closed.

Defense in depth: the outbound voice profile still enforces the country whitelist,
`concurrent_call_limit` and `daily_spend_limit`.

## Alternatives considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Browser-only gate | Simplest, no extra latency | Bypassable; no audit for calls placed outside the UI | Rejected — fails the compliance requirement |
| Server-originated click-to-call (server dials the rep, then bridges to the lead) | Not bypassable; no token through the SDK | Rep answers a call to themselves first; two billed legs; +1–3 s before the lead rings; more complex bridging | **Fallback** |
| No gate | Nothing to build | Breaks the DNC and hours rules | Rejected |
| **Park and authorize** | Not bypassable, fail-closed, one leg, normal "click and it rings", every attempt audited (incl. blocked) | Depends on the SDK carrying the token; ~1 s of park latency; outbound connects depend on the webhook path | **Chosen** |

## Consequences
**Positive:** the gate is enforced server-side for every outbound call; `Call` rows are the single source
of truth for metrics; blocked attempts are kept; the kill switch in `TelephonySettings` stops dialing
immediately.

**Negative:** if the webhook route is unreachable, outbound calls cannot connect — mitigated by the Telnyx
failover URL, the `TelephonyEvent` inbox, the reconcile cron and the webhook-silence alert. The hours
check runs twice, so a call authorized at 16:59:59 can be blocked at 17:00:01 (accepted). The 1.5 s
budget leaves little room for a slow handler, so inline work is limited to primary-key reads.

## Validating spike (Phase 0, throwaway branch, go/no-go) — superseded 2026-10-08 by the live check on production, same pass criteria
1. `newCall` with the token in `clientState`, and separately in an `X-` custom header: confirm it arrives
   on the `call.initiated` payload of a parked call.
2. Hang up a parked call from the webhook and confirm the far end never rings.
3. Measure park → connect over ≥10 calls to numbers abroad that the team owns. ~~≥20 calls to Vietnamese mobile and landline numbers~~ (superseded: Vietnam is not dialled through Telnyx).

Pass: token present on 100% of calls; no parked call ever connects unauthorized; p95 park → connect < 1.5 s.

## Fallback
If the token cannot be carried, or p95 ≥ 1.5 s, switch origination to server-originated click-to-call
behind `lib/telephony/provider.ts`. `compliance.ts`, the `Call` row and snapshot, the webhook inbox and
the state machine stay the same; only the start changes — the server dials after the gate passes, so the
browser never dials the lead directly.
