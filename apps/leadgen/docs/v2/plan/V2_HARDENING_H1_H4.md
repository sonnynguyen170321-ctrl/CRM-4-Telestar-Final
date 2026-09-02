# V2 Hardening — H1 Permissions · H2 Scale · H3 Security · H4 Retention

Status: hardening reference for the R pillar's "close the OS" gates. Docs/policy; binds the permission checks,
scale targets, security invariants, and retention rules the runtime must satisfy. Where this disagrees with the
repo, the repo wins.

## H1 — Permission matrix

Every V2 route/action gates on a permission resolved from the authenticated session's role (never a client
param — Invariant 5). Permissions used in the codebase (grep `requirePermission`):

| Permission | OWNER | ADMIN | MANAGER | SDR | Guards |
|---|---|---|---|---|---|
| `product_tree.write` (ICP authoring, accounts/projects/offers) | ✅ | ✅ | ✅ | ❌ | ICP clone/upgrade/publish (SC5), product tree |
| `ingestion.apply` (upload + run pipeline) | ✅ | ✅ | ✅ | ✅ | `/v2/ingestion`, run-until-idle |
| `crm.read` (leads, companies, contacts, export, timeline) | ✅ | ✅ | ✅ | ✅ | `/v2/leads`, export download |
| `crm.write` / workflow update | ✅ | ✅ | ✅ | ✅ | lead workflowStatus update |
| `manager_review.decide` | ✅ | ✅ | ✅ | ❌ | `/v2/reviews` resolution |
| `feedback.write` | ✅ | ✅ | ✅ | ✅ | `/v2/feedback` capture |
| `outreach.send` | ✅ | ✅ | ✅ | ✅ | manual send (O4), enroll (O5) |
| `outreach.admin` (senders, suppression, live cutover) | ✅ | ✅ | ❌ | ❌ | sender accounts, O9 live flag, kill switch |
| `reports.read` | ✅ | ✅ | ✅ | ✅ | `/v2/reports`, `/v2/home` |
| worker secret (no session) | — | — | — | — | `/v2/outreach/drain` (V2_WORKER_SECRET only) |

Rules: a missing/invalid permission → 401/403; the worker drain route is the only un-sessioned endpoint and is
gated solely by `V2_WORKER_SECRET`. New surfaces add their permission row here. Add a guard smoke that every
`app/v2/**/route.ts` calls `requirePermission` (or the worker-secret gate) before mutating.

## H2 — Scale targets + tests

- **Sends:** 100k/month (~3.3k/day with bursts) across the sender pool — RELAY carries bulk, MAILBOXes warm.
  Per-sender warmup-adjusted caps + atomic `V2SenderDailySend` counter (B6) keep caps correct under bounded
  worker concurrency. Test: seed N senders × caps, enqueue M sends, run the worker, assert no sender exceeds its
  effective cap and throughput sustains the target.
- **IMAP multi-mailbox:** the poller tracks a per-mailbox UID high-water mark (no reprocessing) and polls every
  mailbox + each relay return-path. Test: seed inbound UIDs, poll twice, assert each ingested once (watermark
  smoke — `check-v2-warmup` covers the watermark logic).
- **Ingestion:** large CSV → pipeline jobs drained by the run control / worker; idempotent by content hash. Test:
  re-upload the same file, assert zero duplicate leads/assessments (existing idempotency guards).
- The job runtime is the throughput backbone (`claimNextJob`/`processJob` with locking, retry/backoff, stale
  reclaim). The O5s worker drives it unattended.

## H3 — Security pass (invariants → where enforced)

| Invariant / risk | Enforcement |
|---|---|
| Secrets encrypted at rest, never logged (Inv 9) | AES-256-GCM credential envelopes (O3/B1); loaders never log; readiness reports booleans only (R7) |
| Suppression gate before any send (Inv 10) | `assertNotSuppressed` mints the only `GatePassToken`; `executeSend` is the only path to a provider (O2/O3/B5) |
| Inbound trust (no signed webhooks) | Correlation to a high-entropy outbound Message-ID we sent; un-correlatable mail ignored (O7/B3/B14) |
| DSN / suppression poisoning | Forged DSN naming an unknown Message-ID cannot suppress an address (O7 fixtures) |
| Tenant isolation (Inv 5) | Every query/insert scoped by `organizationId` from the session; cross-tenant ids rejected |
| Exactly-once send | Send state machine never re-sends a message with a providerMessageId (O4/B2) |
| Legal opt-out | `List-Unsubscribe` on every send + UNSUBSCRIBE suppression (O4/O7/B4) |
| Live-send guardrails | Per-kind SPF/DKIM/DMARC + warmup + caps + kill switch (O9) |
| No fabricated metrics | Open/click hidden under SMTP/IMAP (O8/B15); no `UNCERTAIN` anywhere (Inv 7) |

Open security follow-ups: rate-limit the worker drain endpoint; rotate `V2_OUTREACH_CREDENTIAL_KEY` (keyVersion
field supports it); audit-log live-send enablement + kill-switch toggles.

## H4 — Data retention + PII

- **Soft-delete everywhere** (Inv 8): every read filters `deletedAt IS NULL`; core records are never hard-deleted
  in normal flows.
- **Message bodies / inbound raw (PII):** stored for threading + audit, soft-deletable, redacted in logs; not
  surfaced in list read-models (only metadata). Retention: purge soft-deleted bodies after the org's retention
  window (default 13 months); keep the audit/event metadata.
- **Research snapshots / intelligence:** deterministic, refreshable; retain latest + a bounded history; stale
  snapshots are recompute candidates, not kept forever.
- **Suppression entries:** retained (compliance — proof of opt-out); UNSUBSCRIBE/BOUNCE never silently expire.
- **Audit events:** append-only; long retention (governance).
- **Right-to-erasure:** an erasure request soft-deletes the contact + redacts bodies/inbound while preserving the
  suppression entry (so the address stays opted-out) and the audit trail.

## Exit

H1-H4 are policy + enforcement-pointers, not new runtime. The runtime that enforces them lives across SC/T/M/O
(cited per row). New phases extend the matrix (H1), the security table (H3), and the retention list (H4), and add
the scale guard (H2) when the worker/IMAP transports are wired (O-LIVE).
