# V2 Outreach Campaign Launch Parity Contract - 2026-06-19

Status: approved planning contract; implementation is session-gated.

Canonical parent: `docs/V2_FINAL_EXECUTION_PLAN_V10_ENTERPRISE.md`.

Primary reference: Instantly Help, [Quick Start Guide (All-in-One)](https://help.instantly.ai/en/articles/6451970-quick-start-guide-all-in-one), modified 2026-06-18.

## 1. Product outcome

An operator can select real V2 leads, configure one campaign, launch it, and let the dedicated worker deliver scheduled email without manually draining jobs. Replies, bounces, meetings, suppressions, unsubscribes, opens, and clicks update truthful campaign operations and analytics.

The UI calls the object a **Campaign**. The backend continues to use `V2Sequence` plus `V2SequenceEnrollment`; no parallel scheduler or V1 dependency is allowed.

The first milestone is **Campaign Launch**, not Unibox. Full conversation threading, macros, notes, and AI inbox management are deferred until the launch loop passes.

## 2. Instantly quick-start parity target

The launch path must cover the same operator decisions as the reference flow:

1. Connect and verify sending accounts.
2. Configure warmup, health, caps, and optional custom tracking domain.
3. Create a campaign and add eligible leads.
4. Author multi-step variants and personalization.
5. Preview with a real lead and send suppression-gated tests.
6. Configure schedule, timezone behavior, and safety rules.
7. Review blockers and launch.
8. Run automatically through a dedicated worker and IMAP poller.
9. Observe accurate campaign, step, variant, sender, and lead outcomes.

TeleStar keeps its differentiators: `LeadAssignment` is the unit, fit and confidence remain separate, qualification is not workflow status, and account intelligence can rank the lead pool.

## 3. Locked domain contract

### 3.1 Authorization

- Add `outreach.admin`; only `OWNER` and `ADMIN` receive it.
- Sender connection, credential replacement, live-send activation, campaign launch, kill-switch changes, and qualification override require `outreach.admin`.
- Draft authoring may retain the existing authoring role. Non-live enrollment status changes retain `workflow.update`.
- Every action derives `organizationId` from the authenticated session; no client organization ID is trusted.

### 3.2 Campaign lifecycle

- `V2Sequence` remains the campaign aggregate and scheduler source of truth.
- UI lifecycle: Draft, Active, Paused, Archived.
- Launch is idempotent: validate readiness, persist enrollments, assign sticky senders, write audit, then activate.
- Pause prevents new sendable step work. Queued provider work still passes kill-switch, sender, and final suppression gates.
- Resume computes the next valid window and never backfills outside schedule.

### 3.3 Lead eligibility

- Any active, non-deleted `V2LeadAssignment` with a valid primary email may be selected.
- Default order: `QUALIFIED`, `NEEDS_REVIEW`, then other/not-scored; fit score breaks ties.
- Non-`QUALIFIED` launch requires confirmation, reason, actor, timestamp, and audit.
- Override permits outreach only; it never changes immutable qualification or derives workflow status.
- Duplicate selection, relaunch, and retry reuse the unique campaign/lead enrollment.
- Suppressed leads remain visible as blockers but cannot become sendable.

### 3.4 Sender pool and sticky assignment

- A campaign owns an enabled sequence-to-sender pool.
- Enrollment selects a healthy live sender with remaining minute/hour/warmup-adjusted daily capacity.
- The selected sender remains sticky for all follow-ups, preserving threading and IMAP correlation.
- No eligible sender defers the enrollment with an operator-visible reason; no silent drop or mid-thread rotation.

### 3.5 Variants and rendering

- Each email step has one or more weighted variants with stable IDs.
- Assignment is a deterministic hash of organization, campaign, enrollment, and step; retries select the same variant.
- Each message stores step ID and variant ID.
- Rendering uses LiquidJS in strict sandboxed mode with predefined/custom data and `default`; no filesystem, network, dynamic import, or arbitrary code access.
- Spintax is deterministic from enrollment, step, and variant.
- Supported variables initially include email, name parts, title, company, website/domain, phone, location, LinkedIn, project, ICP, and imported custom fields.
- Required unresolved variables block launch. A blank follow-up subject preserves the prior thread subject.

### 3.6 Recipient and schedule snapshots

- A lead outreach profile stores selected valid email, IANA timezone, and custom merge fields without creating a Company-global outreach state.
- Enrollment snapshots recipient, merge data, timezone, and variant inputs at launch.
- Later CRM edits do not silently mutate scheduled content; refresh requires an explicit paused-campaign action.
- Timezone order: lead IANA timezone, campaign fixed timezone, organization timezone, UTC.
- Scheduling uses an IANA/DST-aware library, not the current fixed-offset helper.
- Schedule supports weekdays, local start/end, overnight windows, and fallback timezone.

### 3.7 Delivery and inbound safety

- Manual, test, and sequenced mail all pass synchronous suppression immediately before provider call.
- Live campaigns include RFC-compatible unsubscribe and one-click metadata.
- Unsubscribe is idempotent and writes suppression before returning success.
- Reply, hard bounce, unsubscribe, and meeting halt enrollment according to campaign policy.
- Credentials and OAuth refresh tokens are encrypted, excluded from read models, and never logged.

## 4. Sender onboarding contract

- Google and Microsoft use Authorization Code plus PKCE, one-time tenant-bound state, encrypted refresh tokens, and provider SMTP/IMAP presets.
- Generic SMTP/IMAP remains available and must pass connection tests.
- New/reconnected senders start with `liveSendEnabled = false`.
- Domain readiness exposes SPF and DMARC plus the existing explicit DKIM policy.
- Sender UI shows readable identity, provider/auth mode, warmup, caps, health, CTD, and live gate; never credential envelopes.

## 5. Tracking-domain contract

- Tracking domains are tenant-owned and may serve multiple same-tenant senders.
- Verification requires the configured CNAME and records last check, verified time, failure reason, and status.
- Tracking cannot be enabled before verification.
- Open/click tokens are opaque and server-resolved; they never encode trusted tenant input.
- Click targets are DB-stored and restricted to HTTP(S), preventing open redirects.
- Raw events store message, kind, time, and bot classification. Analytics separately count unique opened/clicked messages.
- Open/click metrics are hidden, not zero-filled, when unavailable.
- Tracking routes honor message/lead soft-delete and reveal no cross-tenant data.

## 6. Dedicated runtime contract

- Production runs a dedicated job worker and dedicated IMAP poller; the UI is not the scheduler.
- Worker ticks due enrollments, drains jobs, retries through the existing engine, and writes heartbeat.
- Poller preserves provider-message correlation and inbound idempotency.
- Stale worker or poller heartbeat blocks live campaign launch.
- `V2_OUTREACH_KILL_SWITCH=1` remains fail-closed. Campaign pause and sender live gates add controls but never bypass it.
- Manual `Run due` may remain an admin diagnostic, not a happy-path dependency.

## 7. Unified campaign UX contract

### 7.1 Routes

- `/v2/outreach/campaigns`: campaign list, status, lead progress, delivery/reply/opportunity totals, warnings, and one primary `New campaign` action.
- `/v2/outreach/campaigns/[campaignId]`: responsive campaign workspace.
- `/v2/outreach/sequences`: compatibility redirect preserving selected campaign context.
- Compose, Senders, Suppression, and Analytics deep-link back to campaign context.

### 7.2 Draft wizard

1. **Setup** - identity and safety rules.
2. **Leads** - LeadAssignment filters, qualification priority, email/suppression state, selection, override reason.
3. **Sequence** - ordered steps, weighted variants, content, delays, variables, defaults, preview.
4. **Schedule** - weekdays, local window, timezone mode, fallback, next-run preview.
5. **Senders** - pool, health, warmup, capacity, live gate, CTD.
6. **Review & Launch** - readiness, blockers, warnings, estimated first batch, test send, sole primary launch action.

Draft edits autosave with visible saving/saved/error feedback. Validation appears at the field and in an accessible launch summary.

### 7.3 Active operations view

- Show enrolled, queued, sent, delivered when known, replied, bounced, suppressed, opened, clicked, opportunities, halted, and failed.
- Break down results by step, variant, and sender.
- Lead table shows current step, next run, sticky sender, latest outcome, and recoverable failure.
- Surface pause/resume and global kill state.
- Provide truthful empty, unavailable, delayed-worker, partial-data, and provider-error states.

### 7.4 Visual and accessibility rules

- Reuse the TeleStar shell, shared cards, semantic tokens, and Lucide icons.
- Use clean professional data-dense SaaS styling; readiness and failures dominate decoration.
- One primary action per view; destructive/live actions require confirmation.
- Keyboard access, visible focus, semantic labels, minimum 44 px targets, WCAG AA contrast.
- Status includes text/icon, never color alone.
- Validate 375, 768, and 1440 px without page-level horizontal scroll.
- Work exceeding 300 ms reserves stable space and announces results through `aria-live`.

## 8. Launch-readiness table

| Condition | Decision |
|---|---|
| No selected valid-email leads | Block |
| Suppressed selected lead | Exclude and block until acknowledged/removed |
| Non-qualified lead without override reason | Block |
| No email step or required body | Block |
| Unresolved required merge variable | Block |
| No healthy live sender with capacity | Block |
| Invalid schedule | Block |
| Worker or IMAP heartbeat stale | Block live launch |
| Tracking enabled with unverified CTD | Block |
| Global kill switch enabled | Block live launch |
| Tracking disabled | Allow; hide open/click |
| Capacity temporarily exhausted | Allow configured campaign; defer affected enrollments |

## 9. Acceptance fixtures

Final seeded acceptance data includes:

1. Org A and Org B with similarly named campaigns, leads, senders, and CTDs.
2. A qualified Vietnamese lead with valid email, `Asia/Ho_Chi_Minh`, diacritics, and custom merge data.
3. A `NEEDS_REVIEW` lead requiring override and a not-scored lead proving priority.
4. Suppressed, invalid-email, deleted, and company-level/no-email leads.
5. Two healthy senders with different caps, one degraded sender, one gated sender.
6. Two email steps, weighted variants, Liquid defaults, custom variables, deterministic spintax.
7. Daytime, overnight, DST-transition, and missing-timezone fallback schedules.
8. Verified/failed CTDs, safe HTTP target, rejected non-HTTP target.
9. Duplicate launch/tick/OAuth callback/unsubscribe and provider retry.
10. Reply, hard bounce, meeting, unsubscribe, open, click, bot-open, stale worker, and kill switch.

Final proof:

```text
select/import lead
  -> configure campaign
  -> preview/test
  -> review and launch
  -> worker sends in lead-local window
  -> IMAP reply correlates and halts
  -> campaign and lead activity show truthful outcomes
```

No final acceptance depends on pressing `Run due`.

## 10. Session-gated implementation map

Each item is a separate reviewed session. Backend sessions are immediately followed by SEE-IT before another macro capability.

1. **Contract/docs** - this contract, V10 pointer, fixtures, session log.
2. **Schema/domain** - permission, sender pool, variants, profiles/snapshots, CTD/events, audit, approved migration, smoke.
3. **SEE-IT campaign shell** - campaign list/detail reads.
4. **Campaign runtime** - eligibility/override, rendering, variants, scheduling, launch/pause/resume, tests.
5. **SEE-IT campaign wizard** - draft wizard and active operations.
6. **Sender runtime** - OAuth, generic tests, encryption, gates, health/caps.
7. **SEE-IT sender onboarding** - connect, verify, warmup/cap, recovery.
8. **CTD runtime** - DNS, open/click, unsubscribe, aggregation, safety tests.
9. **SEE-IT tracking** - CTD UI and honest analytics.
10. **Worker/live cutover** - processes, heartbeat, kill switch, internal round-trip.
11. **Final SEE-IT** - controlled external cohort and cross-tenant verification.

Stop after every session for human review. Do not commit unless explicitly requested.

## 11. Explicitly deferred

- Full Unibox thread storage/UI, macros, notes, custom inbox labels.
- AI inbox automation or automatic AI replies; AI remains advisory.
- Any V1 table, queue, import, or business-runtime reuse.

