# V2 Outreach LIVE Build Plan (O-LIVE) — finish to 100% functional execution

Status: build plan for the gated O-LIVE phase. The O-pillar **logic** (O0-O9) is done + smoke-tested; what remains
is wiring real **SMTP send + IMAP inbound** transports, the **inbound APPLY runtime**, **sender management**, and
the **outreach UI**, then flipping `liveSendEnabled` per sender. Build per §6b (one session/one change-kind, commit
each). Every security invariant from `V2_OUTREACH_PILLAR_DESIGN.md` carries over — nothing here weakens the gate,
encryption, or correlation trust.

## What already exists (don't rebuild)
- O2 suppression gate (`assertNotSuppressed` → only `GatePassToken` minter); `executeSend` is the only path to a provider.
- O3 `ProviderInterface` + `SandboxProvider` + **`SmtpAdapter` with a `transportFactory` hook** (inert until given a transport) + `setOutreachProvider()` to swap the live provider in; pure sender-pool selector + warmup.
- B1 `credentials/credentialLoader.ts`: `loadSmtpConnectionConfig` / `loadImapConnectionConfig` decrypt sender creds at use (AES-256-GCM, fail-closed).
- O4 EMAIL_SEND handler (send state machine B2, Link A activity, sync-bounce→suppression) + O5 SEQUENCE_STEP_EXECUTE + O5s drain route/worker + warmup tick + IMAP UID watermark.
- O7 **pure** logic: `parseDsn`, `correlateInbound`, `decideInboundAction` (trust-by-correlation, B3/B14) — but NO runtime that consumes them yet.
- O8 report read-model; O9 `canLiveSend` guards + kill switch.

## Decisions the user must make before building (provide these)
1. **Libraries** (recommended): `nodemailer` (SMTP send) + `imapflow` (IMAP) + `mailparser` (parse inbound/DSN). These are the standard, well-maintained choices. Approve adding them (`npm i nodemailer imapflow mailparser` + `@types/nodemailer`).
2. **Master key**: set `V2_OUTREACH_CREDENTIAL_KEY` (32-byte base64 — `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Without it the credential loader fails closed (no send).
3. **Sender accounts + domains**: which RELAY (e.g. SES-SMTP/Postmark-SMTP on your domain) and which MAILBOXes (Gmail app-password / Workspace); each needs SMTP host/port + IMAP host/port + creds, a return-path mailbox, and (for RELAY) SPF/DKIM/DMARC on the domain you control (Workspace MAILBOX: custom-domain DKIM). Provide these per org.
4. **Worker**: set `V2_WORKER_SECRET` and run `npm run v2:worker` (drains EMAIL_SEND/SEQUENCE) + (OL3) the IMAP poller, on a cron/box.

## Build sessions

### OL1 — SMTP transport behind the adapter  [runtime · deps]
- `npm i nodemailer @types/nodemailer`.
- `lib/v2/outreach/providers/smtpTransport.ts`: build a nodemailer transport from `loadSmtpConnectionConfig(sender)` (decrypted creds, TLS, **connection pool** per sender for throughput). Export a `transportFactory(sender)`.
- Wire it: when scoring a send for a sender, construct `new SmtpAdapter({ liveSendEnabled: sender.liveSendEnabled, transportFactory: () => buildTransport(sender) })` and `setOutreachProvider(...)` per send (or pass the sender's adapter into `executeSend`). Keep the gate in front (B5) — unchanged.
- Verify: `check-v2-live-send-guards` still green; a controlled send to a **verified internal address** behind `liveSendEnabled` + `canLiveSend` passes; secrets never logged.

### OL2 — Inbound APPLY runtime (closes Link B in runtime)  [runtime + security]
- `lib/v2/outreach/inbound/applyInboundEvent.ts`: given a fetched inbound message (headers+body) + the polled sender's org, run `correlateInbound` + `decideInboundAction` (pure, exists), then in a tenant-scoped transaction:
  - insert `V2InboundMailEvent` idempotently (unique `(senderAccountId, mailboxUid)`) — replay-safe;
  - `decideInboundAction.action === "ignore"` → store as UNCORRELATED, do nothing else (forged/spoofed mail, B3);
  - hard bounce → `V2SuppressionEntry` (BOUNCE) + halt the enrollment + `outreach.bounced` activity (Link A);
  - reply → `outreach.replied` activity + halt enrollment + optional workflowStatus → RESPONDED;
  - unsubscribe → `V2SuppressionEntry` (UNSUBSCRIBE) + halt; soft bounce → no suppression (retry policy).
- Reuse the shared identity/lead linkage; never create a global company effect (Invariant 2).
- Verify: extend `check-v2-imap-inbound` + a seeded-DB integration smoke (reply, hard/soft bounce, forged-uncorrelated ignored, unsubscribe) asserting the DB effects + idempotency.

### OL3 — IMAP poller  [infra · deps]
- `npm i imapflow mailparser`.
- `scripts/v2-imap-poller.mjs` (+ `package.json` `v2:imap`): for every active sender's mailbox + each relay return-path, connect IMAP (TLS, creds via `loadImapConnectionConfig`), fetch UIDs above the stored high-water mark (`nextUidsToFetch`, exists), parse each with mailparser, hand to OL2 `applyInboundEvent`, advance the watermark (`advanceWatermark`). Bounded, idempotent (no reprocessing).
- Document the cron/runner (alongside `v2:worker`).
- Verify: poll a seeded mailbox twice → each message ingested once; un-correlatable ignored.

### OL4 — Sender management (add sender + verify domain)  [runtime + UI]
- `lib/v2/outreach/senders/*`: create/update a `V2SenderAccount` — encrypt creds with `encryptSenderAuth` (B1) before store (never plaintext); set kind/caps/warmup seed; `liveSendEnabled=false` until verified.
- Domain readiness check: RELAY needs SPF+DKIM+DMARC (DNS lookup or manual attestation); Workspace MAILBOX needs custom-domain DKIM. Surface status; only a verified sender can be enabled (OL7).
- UI: `/v2/outreach/senders` (add sender form + health/warmup/cap table) — gated `outreach.admin`.
- Verify: a sender's creds round-trip via the loader; no plaintext column; readiness reflected.

### OL5 — Outreach UI (now buildable — backend is live)  [UI · per §6b]
Design pack §6.1-6.3 surfaces, each binding the live backend + showing safety:
- `/v2/outreach` Hub — **Compose** (pick LeadAssignment → verified contact → suppression-gate + sender-health checklist **before** the send control → send via EMAIL_SEND) + **Monitor** table (V2OutreachMessage/Activity).
- `/v2/outreach/sequences/[id]` — sequence builder (steps + send window + safety rules: stop-on-reply/bounce/meeting); enroll via the sticky sender.
- `/v2/outreach/suppression` + `/v2/outreach/senders` — suppression list (add/import) + sender accounts (OL4).
- Primitives to add (§4e): `SuppressionGateCard`, `SenderHealthCard`, `SequenceCanvasNode`. **No send control renders before the suppression-gate + sender-health checks pass** (Invariant 10). Wire the LeadDrawer's gated "Start outreach" button to the Compose flow.
- Reports: `/v2/reports` already binds `buildOutreachReport`; it goes live as sends happen.

### OL6 — Integration smoke (seeded DB) for the raw-SQL handlers  [tests]
- `scripts/check-v2-outreach-integration.mjs`: seed a sender + lead + sequence in a test schema, run EMAIL_SEND (sandbox provider) + SEQUENCE_STEP_EXECUTE end-to-end, assert the message state machine, Link A activity, idempotency, and the inbound apply effects. Covers the raw-SQL paths the pure smokes can't.

### OL7 — O9 live cutover (gated, controlled)  [runtime + ops]
- Per sender, after domain verification + a minimum warmup stage, flip `liveSendEnabled=true` (admin action); `canLiveSend` (exists) enforces kill switch + per-kind SPF/DKIM/DMARC + caps + List-Unsubscribe at send time.
- First live test to a **verified internal address only**; watch bounce/complaint → warmup rollback (O5s tick).
- The kill switch (`V2_OUTREACH_KILL_SWITCH=1`) halts all live sends instantly.

## Build order (fast path to a working live send + inbound)
```txt
OL1 SMTP transport  ->  OL4 sender mgmt (add a verified sender)  ->  OL7 enable one sender + live test (internal)
OL2 inbound apply   ->  OL3 IMAP poller  ->  full reply/bounce loop closes
OL5 outreach UI (compose first) in parallel once OL1+OL4 land
OL6 integration smoke alongside OL1/OL2
```

## Definition of "100% functional execution"
A verified sender sends a real email (gate-checked, capped, List-Unsubscribe, Message-ID stored) → the SDR sees it on the lead timeline → a reply/bounce arrives via IMAP, is correlated to our Message-ID, and updates suppression/workflow/timeline → sequences advance unattended via the worker → reports reflect it → the kill switch can halt everything. All within the existing gate + encryption + correlation invariants.
