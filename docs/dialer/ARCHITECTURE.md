# Telnyx Dialer — Architecture

Scope: outbound click-to-call and inbound calling for ~34 SDRs (30+ concurrent calls) in
`CRM-4-Telestar-Final`, replacing `components/CallDialerModal.tsx` (sip.js + one SIP password served to
every browser by `app/api/dialer/config/route.ts`). Decision record: `ADR-001-park-and-authorize.md`.

## Components and boundaries

| Component | Location | Responsibility |
|---|---|---|
| Browser softphone | `components/dialer/useTelnyxClient.ts`, `Softphone.tsx` | `@telnyx/webrtc` client; one client per browser (BroadcastChannel lock); requests a call token before dialing; outcome form only after hangup. Audio goes browser ↔ Telnyx, never through the VPS. |
| Token route | `app/api/telephony/token/route.ts` | Lazily creates the user's Telnyx telephony credential (idempotent), mints a 24 h JWT, `Cache-Control: no-store`. No password reaches the browser. |
| Call route (gate) | `POST /api/telephony/calls` | Runs `lib/telephony/compliance.ts`; writes a `Call` (`authorized` or `blocked` + compliance snapshot); returns an HMAC call token (`lib/telephony/authToken.ts`). |
| Compliance service | `lib/telephony/compliance.ts` | Pure `evaluateCallPermission` + loader. Ordered rules: kill switch/dry-run → active credential → `canAccessLead` → valid E.164 → allowed country → `PhoneSuppression` → lead/contact `doNotCall` → 08:00–17:00 lead-local. Exception ⇒ blocked (`gate_error`). |
| Provider adapter | `lib/telephony/provider.ts`, `telnyx/client.ts`, `telnyx/verify.ts`, `fake.ts`, `flags.ts` | Provider-neutral interface; Ed25519 verification (300 s skew); flags mirror `lib/emailSafety.ts` (disabled / dry-run / demo tenant ⇒ no dial). |
| Webhook route | `app/api/telephony/telnyx/webhook/route.ts` | Raw body → verify → `TelephonyEvent` insert (on conflict do nothing) → outbound `call.initiated` inline → everything else enqueued. Excluded in `proxy.ts`, declared public in route authorization. |
| Worker | `workers/telephony.ts` (registered in `workers/index.ts`), queue in `lib/bullmq/{types,queues,jobOptions}.ts` | Correlates events, forward-only status, finalize, Activity write, inbound routing (`lib/telephony/inbound.ts`), recording storage, daily purge. |
| Cron | `app/api/cron/telephony-reconcile`, `app/api/cron/telephony-health` (5 min, `CRON_SECRET`) | Reconcile: replay unprocessed events, cancel stale `authorized`, finalize stuck calls against Telnyx. Health: alerts via `lib/ops/notifyOps.ts`. |
| Postgres | migration `telephony_core` | `Call`, `TelephonyCredential`, `TelephonyNumber`, `TelephonyEvent`, `TelephonySettings`, `PhoneSuppression`, `Lead`/`Contact.doNotCall*`; tenant RLS via `supabase/rls.sql`. |
| Telnyx | external | Credential connection (outbound, call parking on), Call Control app (inbound), outbound voice profile (country whitelist, concurrency and daily spend caps), recordings. |

## Trust boundaries

1. **Browser → API.** Untrusted; session cookie; tenant always from the session. The browser cannot
   mark a call as successful — `PATCH /api/telephony/calls/[id]/outcome` only labels the rep's own call
   once it is final.
2. **Browser → Telnyx.** The JWT is scoped to one user's credential, and a credential alone can dial
   anything — which is why the gate is enforced server-side at park time.
3. **Telnyx → webhook.** Public internet; accepted only with a valid Ed25519 signature
   (`TELNYX_PUBLIC_KEY`) and a timestamp within 300 s, otherwise 401.
4. **Server → Telnyx API.** `TELNYX_API_KEY`, server-only, declared in `lib/env-contract.ts`.
5. **Call token.** HMAC (`TELEPHONY_AUTH_SECRET`) over `{callId, tenantId, userId, toE164, exp}`, 120 s —
   binds what the server authorized to what Telnyx parks.

## Data flow

`Call` rows are the single source of truth; only signed webhooks move their status; only the worker writes
the `Activity` (`call_made`). Recordings stay at Telnyx — we store the id and stream playback through our
route.

## Component diagram

```mermaid
flowchart LR
  subgraph Browser
    SP[Softphone + useTelnyxClient]
  end
  subgraph VPS[Hostinger VPS - docker compose]
    TOK[/api/telephony/token/]
    CALLS[/POST api/telephony/calls/]
    OUT[/PATCH calls/id/outcome/]
    REC[/GET calls/id/recording/]
    WH[/telnyx/webhook/]
    CMP[lib/telephony/compliance.ts]
    ADP[lib/telephony/provider.ts + telnyx/*]
    Q[(Redis - telephony queue)]
    W[workers/telephony.ts]
    CR[cron: reconcile + health]
    PG[(Postgres: Call, TelephonyEvent, Settings, Suppression)]
    OPS[lib/ops/notifyOps.ts]
  end
  TX[Telnyx: WebRTC, Call Control, Recordings, Balance]
  SP --> TOK --> ADP
  SP --> CALLS --> CMP --> PG
  SP --> OUT --> PG
  SP <-->|WebRTC media + JWT| TX
  TX -->|Ed25519 webhooks| WH --> PG
  WH --> Q --> W --> PG
  WH --> ADP
  W --> ADP
  REC --> ADP
  ADP --> TX
  CR --> PG
  CR --> ADP
  CR --> OPS
```

## (a) Outbound happy path — park and authorize

```mermaid
sequenceDiagram
  autonumber
  participant B as Softphone
  participant API as POST /api/telephony/calls
  participant DB as Postgres
  participant T as Telnyx
  participant WH as Webhook route
  participant W as telephony worker
  B->>API: leadId (session cookie)
  API->>DB: load lead, settings, suppression, DNC, credential
  API->>API: evaluateCallPermission - all rules pass
  API->>DB: INSERT Call status=authorized + compliance snapshot
  API-->>B: callId, callToken (HMAC, 120 s), toE164
  B->>T: newCall(toE164, clientState=callToken)
  T->>WH: call.initiated (parked, signed)
  WH->>WH: verify Ed25519 + skew
  WH->>DB: INSERT TelephonyEvent ON CONFLICT DO NOTHING
  WH->>WH: verify token binding + recheck hours and kill switch
  WH->>DB: Call authorized -> initiated, providerSessionId
  WH->>T: transfer to toE164
  WH-->>T: 200
  T->>WH: call.answered, call.bridged, call.hangup
  WH->>W: enqueue jobId=eventId
  W->>DB: answered -> completed, billedDurationSec, hangupCause
  W->>DB: Activity call_made, key call:{id}:final, Call.activityId
  B->>API: PATCH outcome (after hangup only)
```

## (b) Outbound blocked

```mermaid
sequenceDiagram
  autonumber
  participant B as Softphone
  participant API as POST /api/telephony/calls
  participant DB as Postgres
  participant T as Telnyx
  participant WH as Webhook route
  B->>API: leadId
  alt gate fails before dialing
    API->>DB: INSERT Call status=blocked + reasons (audited)
    API-->>B: 200 blocked [dnc, outside_hours, tz_unknown...]
    B->>B: show reasons + inline fix, no dial
  else recheck fails at park (token bad or expired, hours crossed, kill switch)
    API-->>B: callToken
    B->>T: newCall(clientState=callToken)
    T->>WH: call.initiated (parked)
    WH->>T: hangup (fail-closed)
    WH->>DB: Call -> blocked, reason recorded
  end
```

## (c) Inbound to the lead's owner

```mermaid
sequenceDiagram
  autonumber
  participant C as Caller
  participant T as Telnyx Call Control
  participant WH as Webhook route
  participant W as telephony worker
  participant DB as Postgres
  participant O as Owner softphone
  C->>T: dials a TelephonyNumber
  T->>WH: call.initiated (inbound)
  WH->>W: enqueue (high priority)
  W->>DB: number -> tenant; normalizedPhone -> Lead, then Contact -> owner
  W->>DB: INSERT Call inbound status=initiated
  W->>T: answer + transfer to owner SIP (inboundRingSecs=20)
  W->>DB: status=ringing
  T->>O: incoming call (WebRTC)
  O->>T: accept
  T->>WH: call.bridged, later call.hangup
  W->>DB: answered -> completed, Activity once
```

## (d) Inbound missed → fallback → missed-call task

```mermaid
sequenceDiagram
  autonumber
  participant T as Telnyx
  participant W as telephony worker
  participant DB as Postgres
  participant F as Fallback users
  T->>W: transfer to owner timed out
  loop each id in TelephonySettings.fallbackUserIds
    W->>T: transfer to fallback SIP (20 s)
    T->>F: ring
  end
  W->>T: voicemail record (recording on)
  T->>W: call.hangup
  W->>DB: Call status=missed
  alt caller unknown
    W->>DB: find or create stub Lead (name=number, source=inbound_call)
  end
  W->>DB: tx - create Task "Missed call from ..." + set Call.missedCallTaskId (unique)
  W->>DB: notification to owner or first fallback
```

## (e) Recording saved → playback → purge

```mermaid
sequenceDiagram
  autonumber
  participant T as Telnyx
  participant W as telephony worker
  participant DB as Postgres
  participant U as Caller or manager
  participant R as GET calls/id/recording
  T->>W: call.recording.saved (via webhook inbox)
  W->>DB: recordingProviderId, recordingPurgeAt = saved + 90 d
  U->>R: play
  R->>DB: canAccessLead + (caller or MANAGER_ROLES)
  R->>DB: logAdminAudit
  R->>T: GET recording (fresh URL, 10 min TTL)
  R-->>U: stream bytes (URL never sent to the browser)
  W->>DB: daily purge: recordingPurgeAt < now
  W->>T: DELETE recording (404 counts as done)
  W->>DB: clear recordingProviderId
```

Assumptions the Phase 0 spike must confirm: the token arrives on `call.initiated` (the SDK exposes
`clientState` and `X-` custom headers on `newCall`); `ringing` is inferred from the transfer leg (Telnyx
has no explicit ringing event); inbound `call.initiated` through the queue is fast enough to answer — if
not, it moves inline like outbound.
