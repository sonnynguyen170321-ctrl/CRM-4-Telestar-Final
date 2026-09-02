# V2 Outreach Pillar — Design + Blindspot Pass (O0)

Status: design/docs only. Tightens the master plan's O1-O9 specs by locking the **blindspots** the per-session
specs leave implicit. Binds O1 (schema) through O9 (live cutover). Where this disagrees with the repo, the repo
wins — re-verify before coding.

Governing authority: AGENTS.md Invariants (esp. **9** secrets, **10** suppression-before-send, **5** tenant, **6**
idempotency, **8** soft-delete, **11** Unicode); master plan §4 Link B/D + §4d job-chaining + §6 O1-O9 + T1
timeline contract §3. Transport is **SMTP (send) + IMAP (inbound)** — no provider webhooks (locked).

## 0. Why this pass exists

The O-spec is detailed but leaves load-bearing mechanisms as adjectives ("encrypted creds", "idempotent send",
"correlate to a real Message-ID"). Each adjective hides a way to ship something that looks safe and isn't:
plaintext-ish secrets, double-sends on crash, suppression poisoning, illegal cold mail. This doc turns each into
a concrete, testable decision so O1's schema and O2-O9's runtime are built right the first time.

## 1. Blindspots and their locked decisions

### B1. Credential encryption — HOW, not just "encrypted" (Invariant 9)

Decision: **envelope encryption at the app layer**, AES-256-GCM. A master key comes from env
(`V2_OUTREACH_CREDENTIAL_KEY`, 32-byte base64; never logged, never in the repo). Each secret (SMTP pass, IMAP
pass, OAuth refresh token) is encrypted with a fresh random 12-byte IV; we store `{ciphertext, iv, authTag,
keyVersion}` as columns/JSON on `V2SenderAccount` — **never plaintext, never a bare "reference" to an undefined
vault**. Decrypt only at use (O3 loader), in memory, never logged, never returned by any read model. `keyVersion`
allows key rotation. If `V2_OUTREACH_CREDENTIAL_KEY` is absent, the credential loader fails closed (no send).

Schema impact (O1): `V2SenderAccount` stores `smtpAuthEnc Json`, `imapAuthEnc Json?` (the `{ciphertext,iv,authTag,
keyVersion}` envelope), NOT `smtpPassword`. A smoke asserts no plaintext-secret column names exist and the loader
never logs.

### B2. Exactly-once send across the non-transactional provider boundary (Invariant 6)

The SMTP call is not transactional with the DB. Crash after send / before commit ⇒ a naive retry double-sends.

Decision: a **send state machine** on `V2OutreachMessage` with a pre-send claim:
`QUEUED → SENDING → SENT | FAILED | BOUNCED`. The worker, in one transaction, flips `QUEUED→SENDING` and stamps a
`sendAttemptToken` + `sendingAt` **before** the SMTP call. On `EMAIL_SEND` retry: if the message is already `SENT`,
no-op; if `SENDING` and `sendingAt` is recent, treat as in-flight (do not re-send) and reconcile via IMAP/Message-ID
later; if `SENDING` and stale (worker died), allow a single controlled retry **only** when no outbound Message-ID
was recorded. The outbound `providerMessageId` (Message-ID) is generated **before** the SMTP call and persisted on
the `SENDING` transition, so a retry can detect "already handed to SMTP". This is the exactly-once contract; "the
job is idempotent" alone is insufficient.

Schema impact (O1): `V2OutreachMessage.status`, `sendAttemptToken`, `sendingAt`, `sentAt`, `providerMessageId`
(unique, generated pre-send), `idempotencyKey` (unique per org).

### B3. DSN / suppression poisoning (security)

Risk: an attacker emails a forged bounce DSN (or a "reply") to our IMAP return-path to suppress an arbitrary
address (e.g. a competitor) or to mark a lead replied.

Decision: **trust = correlation to an unguessable Message-ID we actually sent.** Outbound `Message-ID`s are
**high-entropy** (`<token@sendingDomain>`, token = 128-bit random), stored on `V2OutreachMessage`. Inbound is acted
on only if its `In-Reply-To`/`References` (reply) or DSN original-`Message-ID` (bounce) matches a stored Message-ID
**for a sender account in this org**, AND it arrived in **our** return-path mailbox for that sender. Un-correlatable
inbound is ignored and logged (the IMAP equivalent of rejecting an unsigned webhook). Suppression created from a
bounce is **auditable and reversible** (soft-delete + reason + source), so a rare false positive can be lifted.

### B4. Legal compliance — unsubscribe + identification (CAN-SPAM / RFC 8058 / GDPR)

Blindspot: cold outreach legally requires a working opt-out and sender identification. None of O1-O9 mentioned it.

Decision: every send sets a **`List-Unsubscribe`** header (mailto + optional one-click URL per RFC 8058) and the
body template must support a physical-address + unsubscribe footer. An unsubscribe (reply "unsubscribe", mailto, or
URL hit) creates a `V2SuppressionEntry` (`suppressionType = UNSUBSCRIBE`) feeding the same gate. O4/O5 templates
carry the unsubscribe token; O7 recognizes unsubscribe replies. This is a hard gate for O9 live cutover.

### B5. The suppression gate must be architecturally un-bypassable (Invariant 10)

Decision: the only path to the SMTP adapter is a single `sendExecutor` that calls `assertNotSuppressed`
**synchronously immediately before** `provider.send()`. The `ProviderInterface.send()` is not exported/callable
outside the executor (module-private or requires a `GatePassToken` the executor alone mints). O2 ships a test that
**fails if any send path reaches the provider without the gate** (static + behavioral). No flag, fast path, or
"resend" bypasses it.

### B6. Per-sender caps under concurrency (100k/mo, bounded workers)

Risk: two worker loops both pick sends for the same sender and blow its warmup-adjusted daily cap.

Decision: an **atomic per-sender-per-day counter**. The send claim increments `V2SenderDailySend(senderAccountId,
sendDate)` count in the same transaction that flips the message to `SENDING`, and rejects if `count >=
effectiveDailyCap` (`min(currentDailyCap, targetDailyCap)`). `lastSendAt` + min-interval throttle spread. This makes
caps correct even with multiple workers. (O3 selector + O5s worker.)

### B7. Timeline Link A compliance — exact field names (T1 contract §3)

Decision (binds O1): `V2OutreachActivity` literally exposes the four union fields **`leadAssignmentId`,
`occurredAt`, `eventKind`, `channel`** (+ `actorUserId?`, `metadataJson`). `eventKind` is namespaced `outreach.*`
(`outreach.sent|delivered|replied|bounced|opened?`). `queryLeadTimeline` (T4) already reserves the outreach slot;
O4 fills it. Outreach attaches to `leadAssignmentId`/`contactId`, **never a global company** (Invariant 2).

### B8. Send-window + timezone (deliverability + UX)

Decision: `runAt` is UTC; a sequence step also carries an optional **send window** (business hours in tenant tz).
The worker defers a step whose computed local time is outside the window to the next window open. Never send at
3am local. (O5/O5s; tenant tz from org settings — same dependency T1 §4 flagged.)

### B9. Bounce/complaint → rolling sender health → warmup rollback

Decision: `V2SenderAccount.bounceRate`/`complaintRate` are **rolling-window** rates (last N sends / last 7 days),
not lifetime. O7 updates them on each inbound bounce/complaint; O5s's daily warmup tick reads them and **pauses or
rolls back** a mailbox over threshold (e.g. bounce > 3% or complaint > 0.1%). Degraded mailboxes are excluded from
the pool (O3 selector).

### B10. Message-body PII + retention (Invariant 8 + privacy)

Decision: store outbound/inbound bodies (needed for threading + audit) but **soft-deletable** with a retention
policy; redact in logs; no body in list read models (only metadata). Inbound raw is correlated then minimized.
Bodies are tenant-scoped like everything else.

### B11. The drainer for EMAIL_SEND / SEQUENCE_STEP_EXECUTE (§4d — every enqueue names its drainer)

Reality: these jobs are **not** ingestion-scoped and there is no ingestion page to auto-drain them. Per §4d they
will silently stall unless something drains them.

Decision: **O4 manual send** drains its own `EMAIL_SEND` synchronously in the request (or a small outreach
run-control), so manual send works before the worker exists. **O5 sequences REQUIRE O5s** (the background worker)
— sequences are not usable without it. Therefore **O5s lands with/just after O5**, and the §4d/§S1c linkage guard
is extended to assert EMAIL_SEND/SEQUENCE_STEP_EXECUTE have a drainer.

### B12. Sender stickiness + failure handoff

Decision: `V2SequenceEnrollment.senderAccountId` binds one enrollment to one sender so all steps + the reply thread
use the same IMAP mailbox (O7 correlation/threading stays coherent). If that sender goes unhealthy mid-sequence,
**hand off explicitly**: pause, reassign sender, and start a **new thread** (a new Message-ID — you cannot continue
the old thread from a different mailbox). Never silently split a thread across mailboxes.

### B13. Deterministic message identity before enqueue

Decision: `V2OutreachMessage.idempotencyKey` is computed **before** enqueue (manual: `org+leadAssignment+
sendRequestId`; sequence: `org+enrollment+stepId`), so `EMAIL_SEND` is idempotent and a retry maps to the same
message row. The `providerMessageId` (Message-ID) is minted at the `SENDING` transition (B2).

### B14. Tenant isolation of inbound (cross-org Message-ID safety)

Decision: Message-IDs are globally unique (128-bit token), and inbound correlation resolves the org from the
**sender account that owns the polled mailbox**, then matches Message-IDs **within that org only**. No inbound event
can cross tenants.

### B15. Open/click honesty (no fabricated metrics)

Decision: open/click are **not available** over SMTP/IMAP without a tracking pixel / link rewrite. O8 **hides**
those widgets (or a separate explicit tracking session adds them). Never show fake open rates. The mock's open/click
panels are deferred, not faked.

## 2. O1 schema (what this design adds beyond the master plan's O1 list)

Models (all tenant-scoped, soft-delete where applicable, repo child-table pattern = plain String FKs + indexes):

- **`V2SenderAccount`** — `kind` (RELAY|MAILBOX), domain/fromAddress, SMTP host/port + `smtpAuthEnc`, IMAP host/port +
  `imapAuthEnc?` (B1), return-path mailbox, rate caps (perMin/Hour/Day), warmup (`warmupStage`, `currentDailyCap`,
  `targetDailyCap`, `warmupStartedAt`), rolling health (`bounceRate`, `complaintRate`, window counters), `status`
  (ACTIVE|PAUSED|DEGRADED|DISABLED), `lastSendAt`, `liveSendEnabled` (default false, O9).
- **`V2SenderDailySend`** — `(senderAccountId, sendDate)` unique, `count` — atomic per-sender-per-day cap (B6).
- **`V2Sequence`** / **`V2SequenceStep`** — steps carry `kind` (email/wait/branch/...), `runAtOffset`/delay, optional
  send window, template ref, ordinal.
- **`V2SequenceEnrollment`** — `(org, sequenceId, leadAssignmentId)` unique (idempotent), `senderAccountId` (sticky,
  B12), `status`, `currentStepOrdinal`, halt reason.
- **`V2OutreachMessage`** — `leadAssignmentId`, `contactId`, `senderAccountId`, `enrollmentId?`, `idempotencyKey`
  (unique, B13), `providerMessageId` (unique, high-entropy, B3), `inReplyToId?`, send state (`status`,
  `sendAttemptToken`, `sendingAt`, `sentAt`) (B2), subject, `bodyRef`/body (B10), `listUnsubscribeToken` (B4).
- **`V2OutreachActivity`** — Link A union fields `leadAssignmentId`, `occurredAt`, `eventKind` (`outreach.*`),
  `channel`, `actorUserId?`, `messageId?`, `metadataJson` (B7).
- **`V2InboundMailEvent`** — `senderAccountId`, `mailboxUid`, `messageId`, `(senderAccountId, mailboxUid)` unique +
  `(org, messageId)` (idempotent, B3/B14), `eventKind` (reply|bounce_dsn|complaint|unsubscribe), `correlatedMessageId?`,
  `dsnStatus?`, `rawHeadersRef?`.

No send behavior, no provider call, no handler in O1 (schema only). Migration is **additive**; uses the
non-destructive path (the repo has pre-existing migration-history drift — generate the table SQL via `migrate diff`,
apply with `db execute`, `migrate resolve --applied`, do NOT `migrate dev` which wants a reset).

## 3. Session order (tightened)

```txt
O0  this design/blindspot doc                                  [docs]      <- DONE (this file)
O1  outreach schema migration (B1,B2,B3,B7,B12,B13,B14 fields) [schema]    <- approved, foundation
O2  suppression gate (un-bypassable, B5) + UNSUBSCRIBE type    [runtime]
O3  provider interface + sandbox + SMTP adapter + cred loader (B1) + sender-pool selector + warmup + atomic caps (B6,B9)  [runtime]
O4  manual send: gate → SMTP → message(state machine B2) → outreach activity(B7) → timeline; drains own job (B11)  [runtime+UI · SEE-IT]
O5  sequences (sticky sender B12, idempotent enrollment) — REQUIRES O5s   [runtime+UI]
O5s background worker + IMAP poller (Link D); extends §4d guard for send jobs (B11); warmup tick (B9); send window (B8)  [infra]
O6  call / linkedin activities → timeline (shared resolver)   [runtime/UI]
O7  IMAP inbound: correlation trust (B3,B14), DSN parse, bounce→suppression, reply→timeline, unsubscribe (B4)  [runtime+security]
O8  outreach reporting (per-sender health/volume; open/click hidden, B15)  [read-model+UI]
O9  live cutover: per-kind SPF/DKIM/DMARC, warmup-gated pool, caps, kill switch, List-Unsubscribe enforced (B4)  [runtime+ops · gated]
```

UI for the Outreach Hub / Sequence Builder / Suppression / Senders pages (design pack §6) is **gated behind these
backend phases** (§4e/§5): no "send" UI before O2's gate exists; the sequence builder needs O5; sender health cards
need O3/O9. Build outreach UI alongside its backing phase, never ahead of it.

## 4. Exit criteria for O0 (this doc)

- Every blindspot (B1-B15) has a concrete, testable decision that binds a downstream session. ✅
- O1 schema field list reflects the decisions (creds envelope, send state machine, high-entropy Message-ID,
  Link A fields, atomic cap table, sticky sender, idempotency keys, inbound correlation). ✅
- Security/legal gates named: un-bypassable suppression (B5), DSN anti-spoof (B3/B14), unsubscribe/compliance
  (B4), no-fabricated-metrics (B15), secrets-never-logged (B1). ✅

Approve, then O1 builds the schema exactly per §2.
