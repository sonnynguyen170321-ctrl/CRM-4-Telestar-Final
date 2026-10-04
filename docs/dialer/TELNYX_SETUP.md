# Telnyx account setup for the CRM dialer

Owner checklist for Phase 0 of the dialer (`docs/dialer/TASKS.md`). Everything here happens in the
Telnyx portal (https://portal.telnyx.com) or by email to Telnyx support. Nothing in this list puts a
secret into chat or into git: the API key, public key and IDs go straight into `/opt/crm/.env.production`
on the VPS.

Tick each box and note the ID it produced. The IDs (not the keys) can go into the PR description.

## 1. Account limits — the go/no-go item

- [ ] **Level 2 verification** completed (Account → Verifications). Without it the account is capped
      at **2** simultaneous calls.
- [ ] **Email support@telnyx.com** to raise the account's concurrent-call limit. Default after Level 2
      is **10**; the floor needs 30+ at peak. Ask for **40**, and give the use case:
      > "B2B sales development team, ~34 agents placing outbound calls from a browser (WebRTC) to
      > business contacts in Vietnam and abroad, plus inbound callbacks to a local number. Peak 30–40
      > concurrent calls, business hours only."
      Above 100 they ask for more detail; 40 should not need it.
- [ ] Keep the reply. The floor rollout (Phase 10) does not start until this limit is confirmed.

## 2. Billing

- [ ] **Auto-recharge** on (Billing → Auto Recharge): threshold and recharge amount sized for at least
      two days of floor usage, so a weekend cannot drain the balance.
- [ ] Note the threshold. The CRM will also alert below `TELNYX_BALANCE_ALERT_USD` (Phase 9).

## 3. Outbound Voice Profile (Voice → Outbound Voice Profiles → Add)

- Name: `crm-outbound`
- [ ] **Whitelisted destinations**: add **VN** and every country the team calls (the default is only
      US/CA; a call to an unlisted country is refused).
- [ ] **Concurrent call limit**: 40 (same as the account limit once raised).
- [ ] **Daily spend limit**: on, with a cap that stops a runaway day (e.g. 2× a normal day).
- [ ] **Call recording**: leave **off** here. The CRM starts recordings itself (Phase 7), so it can play
      the consent notice first and keep the recording id.
- [ ] Note the profile **ID** → `TELNYX_OUTBOUND_VOICE_PROFILE_ID`.

## 4. Credential Connection for the browser softphone (Voice → SIP Connections → Add → Credentials)

- Name: `crm-webrtc`
- [ ] Outbound → **Outbound Voice Profile**: `crm-outbound`.
- [ ] Outbound → **Call parking**: **enabled**. This is what lets the CRM check every call before it is
      connected (the "park and authorize" design in `ADR-001`).
      **Security-critical:** a rep's browser holds a 24-hour login token, and with parking off it
      could dial any number straight from the SDK, past every check the CRM makes. Verify parking is
      on before `TELEPHONY_ENABLED=true`, and re-check it after any change to this connection.
- [ ] Webhooks → **Webhook URL**: `https://crm.telestar.cloud/api/telephony/telnyx/webhook`
      (the route lands in Phase 4; until then calls will not connect — expected).
- [ ] **Webhook failover URL**: same path for now (a second host can be added later).
- [ ] **Webhook API version**: v2.
- [ ] Note the connection **ID** → `TELNYX_CREDENTIAL_CONNECTION_ID`.
      Do **not** create SIP usernames by hand — the CRM creates one telephony credential per rep.

## 5. Call Control Application for inbound (Voice → Programmable Voice → Applications → Add)

- Name: `crm-inbound`
- [ ] Webhook URL and failover: the same `/api/telephony/telnyx/webhook` path, API v2.
- [ ] Outbound Voice Profile: `crm-outbound` (needed when the CRM transfers a caller).
- [ ] Inbound channel limit: 40.
- [ ] Note the application **ID** → `TELNYX_CALL_CONTROL_APP_ID`.

## 6. Numbers

- [ ] Buy the **Vietnam number(s)** (Numbers → Search & Buy → Vietnam; ~$35/month each) and assign them
      to the `crm-inbound` application. These are the caller ID for Vietnamese calls and the hotline.
- [ ] For each other country the team calls often, buy a local number there (better answer rates).
      **Australia** and **Singapore** need a local address, proof of address (≤3 months), company
      documents and a usage description; approval takes ~72 hours — start early if needed.
- [ ] List each number and its purpose (VN hotline, AU outbound, …) for `TelephonyNumber` seeding.

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
TELEPHONY_ENABLED=false        # stays false until the pilot
TELEPHONY_DRY_RUN=true         # gate decisions are recorded, no calls are placed
TELNYX_BALANCE_ALERT_USD=50
```

## 8. Questions to put to Telnyx in writing (support ticket)

- [ ] Per-minute price for calls to **Vietnamese mobile** and **landline** numbers.
- [ ] Is caller ID delivered when calling Vietnamese numbers from a Telnyx Vietnam number? From a
      foreign number?
- [ ] Does Vietnam's **Voice Brandname** rule (operators block marketing calls over VoIP/SIP without a
      registered brand name, Decree 330/2026) affect Telnyx-terminated calls into Vietnam, and can
      Telnyx register one?
- [ ] Can the WebRTC JS SDK attach `client_state` or a custom SIP header that arrives on the
      `call.initiated` webhook of a parked outbound call? (The Phase 0 spike tests this too.)

Keep the answers in this folder (`TELNYX_ANSWERS.md`); the pilot decision depends on them.
