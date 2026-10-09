# Telnyx account setup for the CRM dialer

Owner checklist for Phase 0 of the dialer (`docs/dialer/TASKS.md`). Everything here happens in the
Telnyx portal (https://portal.telnyx.com) or by email to Telnyx support. Nothing in this list puts a
secret into chat or into git: the API key, public key and IDs go straight into `/opt/crm/.env.production`
on the VPS.

Tick each box and note the ID it produced. The IDs (not the keys) can go into the PR description.

## What the dialer is for (owner decisions, 2026-10-08)

- **International leads only.** Vietnamese numbers are called from the rep's own phone and logged in
  the CRM (the lead drawer's Call button shows the number, a QR code to dial, and the outcome form).
  The browser dialer never dials Vietnam, so VN stays out of the outbound profile below.
- **No inbound** in this release: a prospect who calls back reaches the rep's phone, not the CRM.
- **Caller ID:** the numbers being ported from Bigin. Until a port completes, one Telnyx number the
  account already has is the default.
- **Recording:** on by default, no spoken notice; both are manager settings in the CRM, changeable
  without a deploy.
- **Calling hours:** none (any time, every day) — a manager setting. Do-not-call, invalid and
  premium-rate numbers stay blocked.
- **Today:** the team calls through Bigin and MicroSIP. Both stay as they are until the CRM dialer is
  live; their SIP credentials are removed at the end (Phase 6), so every international call goes
  through the CRM's checks and records.

## 1. Account limits — the go/no-go item

The account has been in use for months, so check rather than create.

- [ ] **Level 2 verification** shows as complete (Account → Verifications). Without it the account
      is capped at **2** simultaneous calls.
- [ ] **Concurrent-call limit**: find the current value (Account → Account Levels, or ask support).
      The whole team goes live at once, so it must be **40** or more. If lower, email
      support@telnyx.com:
      > "B2B sales development team, ~34 agents placing outbound calls from a browser (WebRTC) to
      > business contacts outside Vietnam. Peak 30–40 concurrent calls. Please raise the account's
      > concurrent-call limit to 40."
- [ ] Keep the reply. The dialer is not switched on for the team until this limit is confirmed.

## 2. Billing

- [ ] **Auto-recharge** on (Billing → Auto Recharge): threshold and amount sized for at least two
      days of the whole team calling, so a weekend cannot drain the balance.
- [ ] Note the threshold. The CRM will also alert below `TELNYX_BALANCE_ALERT_USD` (Phase 5).

## 3. Outbound Voice Profile (Voice → Outbound Voice Profiles → Add)

- Name: `crm-outbound` (new; leave the profile MicroSIP uses untouched).
- [ ] **Whitelisted destinations**: every country the team calls **except Vietnam** (the default is
      only US/CA; a call to an unlisted country is refused). Leaving VN out is a second lock behind
      the CRM's own country rule.
- [ ] **Concurrent call limit**: the account limit from step 1.
- [ ] **Daily spend limit**: on, with a cap that stops a runaway day (e.g. 2× a normal day).
- [ ] **Call recording**: **off** here. The CRM starts recordings itself, so it can follow the
      manager's settings and keep the recording id.
- [ ] Note the profile **ID** → `TELNYX_OUTBOUND_VOICE_PROFILE_ID`.

## 4. Credential Connection for the browser softphone (Voice → SIP Connections → Add → Credentials)

- Name: `crm-webrtc`. **A new connection**, separate from the one MicroSIP logs into — MicroSIP keeps
  working until Phase 6.
- [ ] Outbound → **Outbound Voice Profile**: `crm-outbound`.
- [ ] Outbound → **Call parking**: **enabled**. This is what lets the CRM check every call before it
      is connected (the "park and authorize" design in `ADR-001`).
      **Security-critical:** a rep's browser holds a 24-hour login token, and with parking off it
      could dial any number straight from the SDK, past every check the CRM makes. Verify parking is
      on before `TELEPHONY_ENABLED=true`, and re-check it after any change to this connection.
- [ ] Webhooks → **Webhook URL**: `https://crm.telestar.cloud/api/telephony/telnyx/webhook`
      (the route lands in Phase 1; until then calls will not connect — expected).
- [ ] **Webhook failover URL**: same path for now.
- [ ] **Webhook API version**: v2.
- [ ] Note the connection **ID** → `TELNYX_CREDENTIAL_CONNECTION_ID`.
      Do **not** create SIP usernames by hand — the CRM creates one telephony credential per rep.

## 5. Call Control Application (Voice → Programmable Voice → Applications → Add)

Inbound is not in this release, but the CRM's configuration check expects this ID, and it is where
inbound would attach later. Create it with no number assigned.

- Name: `crm-inbound`
- [ ] Webhook URL and failover: the same `/api/telephony/telnyx/webhook` path, API v2.
- [ ] Outbound Voice Profile: `crm-outbound`.
- [ ] Note the application **ID** → `TELNYX_CALL_CONTROL_APP_ID`.

## 6. Numbers

- [ ] **Port from Bigin** (Numbers → Port In): start the port for the Bigin numbers. Note each
      number's country and the expected completion date. A port-in needs the losing carrier's
      account details and a recent invoice; Telnyx shows the exact list per country.
- [ ] **Default caller ID for now**: pick one number the account already has. Assign it, and each
      ported number as it arrives, to the `crm-webrtc` connection (Numbers → Your Numbers → the
      number → Connection).
- [ ] List each number, its country and its use (default / US caller ID / …). The CRM's Settings →
      Telephony page will take this list (Phase 4); no deploy is needed to add a ported number.

## 7. Keys (straight into the VPS env file, never into chat)

- [ ] **API key**: Account → API Keys → Create → `TELNYX_API_KEY`.
- [ ] **Webhook public key**: Account → Public Key → `TELNYX_PUBLIC_KEY`.
- [ ] A random secret for call tokens: `openssl rand -hex 32` → `TELEPHONY_AUTH_SECRET`.

```bash
# On the VPS, edit /opt/crm/.env.production and add (values from the steps above):
TELNYX_API_KEY=...
TELNYX_PUBLIC_KEY=...
TELNYX_CREDENTIAL_CONNECTION_ID=...
TELNYX_CALL_CONTROL_APP_ID=...
TELNYX_OUTBOUND_VOICE_PROFILE_ID=...
TELEPHONY_AUTH_SECRET=...
TELEPHONY_ENABLED=false        # stays false until Phases 1–2 are deployed and tried
TELEPHONY_DRY_RUN=true         # gate decisions are recorded, no calls are placed
TELNYX_BALANCE_ALERT_USD=50
```

No quotes around the values, no spaces around `=`. Then recreate the containers so they read it:

```bash
cd /opt/crm
DC="docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.hostinger.yml"
$DC up -d --force-recreate web worker
```

`npm run prod:check-env` (or the deploy's own check) reports the Telephony group as configured
without printing any value.

## 8. Questions to put to Telnyx in writing (support ticket)

- [ ] The concurrent-call limit (step 1), and the port-in timeline for the Bigin numbers.
- [ ] Per-minute price to the countries the team calls most.
- [ ] Is the WebRTC SDK's `customHeaders` (an `X-` header on `newCall`) delivered in the
      `call.initiated` webhook of a **parked** outbound call on a credential connection? The docs
      describe it for call-control correlation; the CRM sends its signed call token this way.

Keep the answers in this folder (`TELNYX_ANSWERS.md`).

## 9. The first live check (after Phases 1–2 are deployed)

This replaces the separate spike branch: it runs on production, by one manager, while
`TELEPHONY_DRY_RUN` is still `true` for everyone else.

- [ ] One manager places ~10 test calls to numbers the team owns abroad.
- [ ] Each call's `call.initiated` webhook carries the token (the CRM records it; the agent checks
      the stored events read-only).
- [ ] Park → connect is under 1.5 s at p95.
- [ ] If the token does not arrive, the dialer switches to the server-originated design in
      `ADR-001` before the team is switched on.
