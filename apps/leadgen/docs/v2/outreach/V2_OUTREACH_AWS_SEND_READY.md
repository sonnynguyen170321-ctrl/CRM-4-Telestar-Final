# V2 Outreach AWS Send-Ready Runbook

This runbook is the production cutover checklist for `/v2/outreach` when the app is deployed on AWS and the sender DNS is handled by SES, Hostinger, Google Workspace, Microsoft 365, or another SMTP mailbox/provider.

## Runtime Shape

Run outreach as three deployable processes that share the same database and environment secrets:

1. Web app: Next.js app serving `/v2/outreach`, tracking routes, sender admin, reports, inbox, and the secret-gated worker HTTP routes.
2. Job worker: `npm run v2:worker`, normally a separate ECS/App Runner/service process. It POSTs `/v2/outreach/drain` on an interval, advances due enrollments, and drains `SEQUENCE_STEP_EXECUTE` then `EMAIL_SEND` jobs.
3. IMAP poller: `npm run v2:imap`, normally a separate service or scheduled long-running process. It POSTs `/v2/outreach/imap-poll` and applies replies, hard bounces, unsubscribes, and related timeline events.

Do not rely on an open browser tab for campaign delivery. Do not run bulk outreach inside a serverless request timeout. Keep the worker and IMAP poller supervised by the platform (ECS service, App Runner service, systemd, PM2, or equivalent) and restart on failure.

## Required Environment

Set these on the web app, worker, and IMAP poller unless noted.

| Env | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Shared Postgres connection. |
| `APP_URL` | yes | Canonical HTTPS app URL used for OAuth callbacks and tracking links. |
| `APP_BASE_URL` | yes | Same canonical HTTPS app URL for code paths that read the older name. |
| `NEXT_PUBLIC_APP_URL` | yes, web | Public HTTPS app URL for client-visible links. |
| `V2_OUTREACH_CREDENTIAL_KEY` | yes | 32-byte base64 master key for SMTP/IMAP credential envelopes. Missing key fails closed. |
| `V2_WORKER_SECRET` | yes | Shared secret for `/v2/outreach/drain`, `/v2/outreach/imap-poll`, and runtime health. |
| `V2_WORKER_APP_URL` | yes for worker/poller | Base URL the daemon POSTs. In AWS this should be the web app HTTPS URL or an internal service URL. Falls back to `APP_URL`, `NEXT_PUBLIC_APP_URL`, then `APP_BASE_URL`. |
| `V2_WORKER_INTERVAL_MS` | yes for worker | Drain interval. Start with `15000`. Use `0` only for one-shot smoke runs. |
| `V2_IMAP_POLL_INTERVAL_MS` | yes for poller | IMAP poll interval. Start with `60000`. Use `0` only for one-shot smoke runs. |
| `V2_TRACKING_HOST` | if tracking enabled | CNAME target users point tracking subdomains at. Example: `track-app.example.com`. |
| `V2_TRACKING_SECRET` | if tracking enabled | HMAC secret for open/click tracking tokens. If absent, code falls back to credential key, but production should set a dedicated value. |
| `V2_OUTREACH_KILL_SWITCH` | yes | Leave empty/off for live sending. Set `1` to halt live sends immediately. |

Generate `V2_OUTREACH_CREDENTIAL_KEY` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Store secrets in AWS Secrets Manager or SSM Parameter Store. Never expose SMTP/IMAP passwords in client-side config.

## SES Sender Setup

For Amazon SES SMTP:

1. Choose one SES Region and use that Region's SMTP endpoint, for example `email-smtp.us-east-1.amazonaws.com`.
2. Use port `587` with STARTTLS (`smtpSecure=false`) or port `465` with implicit TLS (`smtpSecure=true`).
3. Create SES SMTP credentials for that Region. These are not the same as normal IAM access keys.
4. Verify the sending domain or address in SES.
5. Publish SES DKIM records for the identity.
6. If using custom MAIL FROM, publish the required MX record and SPF TXT record for that MAIL FROM domain.
7. Request SES production access before sending to unverified recipients.
8. Add DMARC for the sending domain. Use a conservative policy while warming up.

In `/v2/outreach/senders`, add SMTP settings from SES:

| Field | SES value |
| --- | --- |
| Host | `email-smtp.<region>.amazonaws.com` |
| Port | `587` |
| Secure | `STARTTLS` / `false` |
| Username | SES SMTP username |
| Password | SES SMTP password |

Then verify the sender connection, set cap/warmup, and only then flip live.

## Hostinger / Workspace / Other SMTP

For Hostinger or any mailbox provider:

1. Use the provider's SMTP host, port, secure mode, username, and app password/mailbox password.
2. Publish SPF for the sending service.
3. Publish DKIM from the provider.
4. Publish DMARC for the sending domain.
5. Configure IMAP host/port/secure settings if replies and bounces should sync back to the inbox/timeline.
6. Respect provider limits with per-sender daily caps and warmup.

## Tracking Domain

Tracking is optional. If enabled:

1. Set `V2_TRACKING_HOST` to the infrastructure hostname that serves this app's tracking routes.
2. In `/v2/outreach/senders`, add a tracking subdomain such as `go.example.com`.
3. Publish CNAME from that subdomain to `V2_TRACKING_HOST`.
4. Verify the tracking domain in the sender UI.
5. Assign a verified tracking domain to the live sender.

Tracking is only applied when the assigned tracking domain is verified. If tracking is not configured, sends still work; analytics simply will not show open/click events.

## Cutover SEE-IT

Use a consented internal/test recipient, never an external prospect, for the first live test.

1. Confirm `/v2/settings` shows outreach credential key, worker secret, at least one sender, and live-send readiness.
2. Add a sender with SMTP/app-password credentials.
3. Verify SMTP connection.
4. Configure IMAP if replies/bounces should sync.
5. Set sender cap and warmup.
6. Ensure `V2_OUTREACH_KILL_SWITCH` is empty/off.
7. Flip the sender live.
8. Create or reuse a campaign with an email step, schedule, timezone, and one selected internal test lead.
9. Launch the campaign.
10. Start `npm run v2:worker` and keep it running.
11. Start `npm run v2:imap` and keep it running when IMAP is configured.
12. Confirm timeline/reports show `outreach.sent` and the provider receives the message.
13. Reply from the test mailbox and confirm inbox/timeline outcome updates after the IMAP poller runs.

## Safety Gates To Keep

- Suppression remains the final synchronous gate before SMTP provider send.
- New senders start `liveSendEnabled=false`.
- Live toggle requires sender verification and the credential key.
- `V2_OUTREACH_KILL_SWITCH=1` stops live sends.
- Worker and IMAP routes require `V2_WORKER_SECRET`.
- SMTP/IMAP credentials are encrypted at rest and decrypted only in memory.
- Use one verified sender and one internal test lead before enabling broader campaigns.