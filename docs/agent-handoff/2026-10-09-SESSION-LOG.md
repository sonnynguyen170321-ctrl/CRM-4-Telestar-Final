---
classification: CURRENT_REFERENCE
note: Session log for 2026-10-09. State below is as of writing — verify against GitHub and production before acting on it.
---

# Session log — 2026-10-09: a bounce must stop every later send

```bash
git fetch origin && git log --oneline -10 origin/main
curl -s https://crm.telestar.cloud/api/health      # .commit = what production runs
```

## The owner's report

Mei's sequence ("Spanco Sdn. Bhd. & Nekko | Meeting Invitation: Computer Vision & AI") sent step 1 to
`zolkiflii@spanco.com.my`; Gmail returned a DSN (`550 5.7.1 XGEMAIL_0011 Command rejected`, a Sophos
gateway refusal); the follow-up still went out and bounced again. "We made sure a bounce stops
sending — why not?" Plan approved: `C:\Users\lenovo\.claude\plans\glowing-crunching-ritchie.md`
(three steps, below).

## Root causes found in code

The send path already refuses a suppressed address or an `emailInvalid` lead. Those are set only when
the inbox sync reads the DSN and matches it to a lead. That link broke in several places:

- **Every adapter read a capped slice per run and the cursor jumped to "now".** Gmail: newest 50 of
  `in:inbox`, no paging. Outlook: newest 50. IMAP: newest 30, and `SEARCH SINCE` is date-only. A
  cold-email mailbox gets its bounces in a burst right after a batch send — exactly when a run
  overflowed — and everything past the cap was never read.
- **IMAP stored the bare UID as the message id**, unique per mailbox but stored as unique across all
  mailboxes: a second mailbox's message with the same UID was taken for already stored and skipped.
- Before #257, a bounce landing in a sender mailbox that was not the lead holder's matched no lead and
  was stored with `leadId` null, never acted on again.
- The apply loops acted on every message read, stored before or not (found in review): re-reads
  re-notified reps and marked a later send bounced.

Which of these hit Spanco needs production data (query in the plan's Step 0); the fixes cover all.

## Branches (pushed; this PC has no `gh` — the owner opens the PRs)

1. `fix/bounce-stop-all-sends` — Step 1, ship first:
   - paging, oldest first, `SYNC_READ_LIMIT` (300) per run, cursor to the last message read
     (`lib/email/inboxBatch.ts`, Gmail/Outlook/IMAP adapters, `workers/sync.ts` `cursorAfter`);
   - send-time lock `findBounceEvidence` / `blockIfBounced` (`lib/email/suppress.ts`) in
     `workers/sequence.ts` and `workers/email.ts`; indexes `[tenantId, bouncedAt]`,
     `[tenantId, isBounce]` (migration `20261009120000_bounce_evidence_indexes`, plain CREATE INDEX);
   - maintenance repair `unapplied-bounces` (newest first, up to 50k bounces per run);
   - tenant-wide fallback match for a bounce; act only on messages stored (or newly placed) this run;
   - IMAP ids `imap:<mailbox>:<uidvalidity>:<uid>`, old bare UID still recognised;
   - a bounce marks the latest send **before** it arrived, with the bounce's time.
   Suppression from bounce evidence is permanent by design (no unsuppress path exists).
2. `fix/bounce-audit-resync` — Step 2, stacked on 1:
   - `scripts/inbox-resync.ts` — re-reads N days per mailbox through the normal sync path without
     moving the live cursor; acts on bounces, and on replies only from the current enrollment;
     resumable with `--from`;
   - `scripts/audit-bounce-coverage.ts` — read-only report per tenant.

Both had independent reviews; every CRITICAL/HIGH finding was fixed (several found real bugs: the
apply-once problem, the audit dating bounces by storage time, the repair marking the wrong send).
DB-backed suites do not run on this PC; CI runs them.

## Deploy and run order (owner)

1. Merge 1, then 2 (2 contains 1). Wait for the Docker Image workflow on the merge SHA.
2. `./scripts/deploy.sh <full-sha>` — the migration only adds two indexes; no RLS reapply for this.
3. Re-read 30 days, dry run then apply:
   ```bash
   DC="docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.hostinger.yml"
   $DC exec -T web npx tsx scripts/inbox-resync.ts --days 30
   $DC exec -T web npx tsx scripts/inbox-resync.ts --days 30 --apply
   ```
4. Apply stored bounces: add `,unapplied-bounces` to the 15-minute maintenance cron `types=` list (or
   call it once by hand with `types=unapplied-bounces`).
5. Audit: `$DC exec -T web npx tsx scripts/audit-bounce-coverage.ts` — "bounced but not suppressed" and
   "enrollments on a bounced address" should be 0; "sends after a bounce (last 7 days)" should stop
   growing.

## Still open

- **Step 3** of the plan (not started): parse the `message/delivery-status` part (status 5.x.x vs
  4.x.x, diagnostic code), match a bounce to the exact send by `In-Reply-To`/`References` →
  `OutboundMessage.rfcMessageId`, more NDR shapes (Exchange "Undeliverable", Sophos/Mimecast/
  Proofpoint, non-English), Gmail query beyond `in:inbox`, Email Health "inbox not read since",
  daily ops alert on sends after a bounce.
- From 2026-10-08: PRs not yet opened/merged — `fix/inbox-sequence-owner-role`,
  `feat/dialer-prework-phone-panel`; research PRs #258–#263 merged but not deployed (needs RLS
  reapply); Telnyx Phase 0 (owner, `docs/dialer/TELNYX_SETUP.md`); Outlook app registration.
