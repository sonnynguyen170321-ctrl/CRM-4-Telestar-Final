# V2 Outreach — Deferred Backlog + Next Session

Status: 2026-06-20. Campaign Launch (S2–S5b) + Sender verify/OAuth (S6a–d core) + security hardening are committed (`3a5a69c`, on `origin/feature/shared-types`).

---

## HELD — S6d-final: XOAUTH2 transport hookup (do later)

The XOAUTH2 *minting core* is done + tested (`mintAccessToken`, `parseAccessTokenResponse`, `buildXoauth2Auth` in `lib/v2/outreach/oauth/`). The remaining live hookup is **held** (needs real OAuth app creds to verify; not safe to land untested):

- Branch the SMTP transport (`lib/v2/outreach/providers/smtpTransport.ts`) and the IMAP poller on `authMode === 'OAUTH'`: decrypt `oauthRefreshEnc` → `mintAccessToken(provider, refresh)` → build transport with `{ type: 'OAuth2', user, accessToken }` (nodemailer) / `{ user, accessToken }` (imapflow). Cache the access token until ~expiry; **refresh-on-401** retry once.
- Make S6b "Test connection" OAuth-aware: for OAUTH senders, mint + do an XOAUTH2 login instead of password verify.
- Env required to verify end-to-end: `APP_URL`, `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `MICROSOFT_OAUTH_CLIENT_ID/SECRET`, `V2_OUTREACH_CREDENTIAL_KEY`, `V2_WORKER_SECRET`. Register the exact `…/oauth/<provider>/callback` redirect URI in each provider's OAuth app.

Also deferred (security): shared-store (Redis) rate limiter for multi-instance (proxy.ts limiter is per-instance); `V2_OUTREACH_CREDENTIAL_KEY` rotation procedure (envelope `keyVersion` already supports it).

---

## NEXT SESSION (queued)

### A. SEE-IT senders — connect flow + readiness + warmup/cap controls
- Surface the OAuth connect flow result clearly (already have Connect buttons + `oauth-*` notices); add a per-sender **readiness panel**: domain auth (SPF/DMARC/DKIM, exists) + connection-verify state (exists) + warmup stage + caps + live gate, as one at-a-glance status.
- **Warmup controls**: per-sender enable/pause warmup toggle + stage display (data: `warmupStage`, `warmupStartedAt`). Bulk enable/pause (Instantly parity).
- **Cap controls**: edit `dailyCapTarget` + rate limits; show `dailyCapCurrent`/health (bounce/complaint) — gated `outreach.admin`.
- Browser SEE-IT 375/768/1440 (human item — no automation here).

### B. CTD runtime — DNS verification, pixel, click redirect, unsubscribe, analytics
- **Tracking domain**: store domain + CNAME target + verification state + sender association (contract §5). DNS verify (lookup CNAME, record last-check/verified/failure). Tracking cannot enable before verified.
- **Open pixel**: opaque server-resolved token → 1×1; record raw open event + bot-filter indicator.
- **Click redirect**: opaque token → DB-stored target, **HTTP(S) only** (no open redirect) → record click.
- **Unsubscribe**: idempotent endpoint; writes suppression BEFORE returning success (RFC 8058 one-click; mandatory on live campaigns).
- **Analytics aggregation**: count UNIQUE message opens/clicks (not raw); hide open/click when CTD unverified (no fake metrics — V9 guardrail). Per-campaign/step/variant/sender on real events.
- Schema (approval-gated): tracking domain + tracking-event tables (some may already exist from the campaign-contract migration — audit `V2OutreachTrackingDomain`/event before adding).

Guardrails carry: tenant isolation + soft-delete on every query; suppression last synchronous gate; secrets encrypted/never logged; outreach.admin for live/admin actions; no fake metrics.

---

## CTD progress (2026-06-20)

DONE: `lib/v2/outreach/tracking/verifyTrackingDomain.ts` — `verifyTrackingDomainCname(hostname, cnameTarget, resolver?)` (injectable resolver; NO_CNAME / CNAME_MISMATCH / DNS_LOOKUP_FAILED) + smoke `check-v2-tracking-domain.mjs`. Schema already present (`V2TrackingDomain`, `V2OutreachTrackingLink`, `V2OutreachTrackingEvent`) — no migration needed.

REMAINING CTD (next):
- Tracking-domain UI on `/v2/outreach/senders` (or a CTD tab): add domain + show CNAME instructions + "Verify" action calling `verifyTrackingDomainCname` → set `V2TrackingDomain.status`/`verifiedAt`/`failureReason`/`lastCheckedAt`. Gated outreach.admin. Tracking cannot enable before VERIFIED.
- Open pixel route `/v2/outreach/track/o/[token]` → record `V2OutreachTrackingEvent(OPEN)` + bot-classify + return 1×1 gif. Needs a per-message open token (mint at send; store on message or a tracking link).
- Click redirect `/v2/outreach/track/c/[token]` → look up `V2OutreachTrackingLink.targetUrl` (DB-stored, HTTP(S) only — no open redirect) → record CLICK → 302.
- Unsubscribe `/v2/outreach/track/u/[token]` → idempotent; write `V2SuppressionEntry` BEFORE returning success (RFC 8058 one-click).
- Analytics: count UNIQUE opened/clicked messages (not raw events); hide open/click when no verified CTD (no fake metrics). Per campaign/step/variant/sender.
- Link rewriting at send: wrap links in click-redirect tokens + inject the open pixel — only when the sender's CTD is verified.
