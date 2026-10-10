# Dialer runbook

For whoever is on call for the Telnyx dialer. Decisions behind it: `TASKS.md` (owner decisions,
2026-10-08), design: `ARCHITECTURE.md` and `ADR-001-park-and-authorize.md`, account setup:
`TELNYX_SETUP.md`.

What the dialer is, in one paragraph: reps call **non-Vietnamese** numbers from the browser softphone;
every call is checked by the server before it connects; Vietnamese numbers are never sent through
Telnyx (the rep calls from their own phone and logs it in the CRM, `PhoneCallPanel`). There is no
inbound calling. The team calls any time of day unless a manager narrows the hours.

## 1. Where things are

| What | Where |
|---|---|
| Manager settings, emergency stop, caller ID numbers, softphone logins | CRM, Settings, "Phone & dialer" (`/settings/telephony`). Director and floor manager change everything; a team lead sees it read-only, can press the emergency stop (not lift it) and can revoke the logins of reps in their own report chain |
| Server switches | the VPS env file: `TELEPHONY_ENABLED`, `TELEPHONY_DRY_RUN`, the six Telnyx variables, `TELNYX_BALANCE_ALERT_USD`, optional `TELNYX_CONCURRENCY_LIMIT`, `ALERT_WEBHOOK_URL` |
| What was allowed or refused, and why | the `Call` table (`status`, `compliance`); blocked attempts are kept |
| Raw provider events | `TelephonyEvent` (processed ones are deleted after 30 days) |
| Who changed a setting | Admin, Audit Log, actions `admin.telephony.*` (before and after of what changed) |
| Crons | `telephony-reconcile` and `telephony-health`, every 5 minutes, `CRON_SECRET` (`docs/DEPLOY.md`) |

## 2. Switching the dialer on and off

Calling needs every layer below to say yes. Any "no" stops new calls; the first column is who owns it.

| Layer | Owner | Off means | How to change |
|---|---|---|---|
| `TELEPHONY_ENABLED=true` and all six Telnyx variables | server | nobody can get a softphone token or place a call; the page says "does not allow calling" | edit the env file, recreate `web` and `worker` (`TELNYX_SETUP.md` section 7) |
| `TELEPHONY_DRY_RUN=false` | server | dry run: calls are checked and recorded as `blocked` with reason `dry_run`, none is placed | same |
| "Dialer on for this team" | manager | the team is refused | Phone & dialer, Calling rules |
| "Dry run" (team) | manager | as above, for this team only | same |
| Emergency stop | manager (a team lead may press it, only a director or floor manager lifts it) | everything for this team stops now | the red button at the top of Phone & dialer |
| A rep's softphone login | manager | that rep only | Phone & dialer, Softphone logins, Revoke |

Turn on for real: server flags on and dry run off in the env file, then in the page add at least one
allowed country (nothing is dialable by default), turn "Dialer on" on, turn "Dry run" off, save.
Vietnam cannot be added: the page and the API both refuse it.

Turn off: use the emergency stop first (instant, no deploy), then decide whether the env flags need to change.

### The emergency stop

- Press "Stop all calls now". It records who and when (shown on the page and in the Audit Log as `admin.telephony.kill`).
- Effect: the next softphone token is refused, and any call that is parked at that moment is hung up and
  recorded as `blocked` with reason `kill_switch`. A call already talking is not cut; it ends when the rep hangs up.
- Reps can still log calls made from their own phone. Nothing about the manual `PhoneCallPanel` depends on the dialer.
- Lift it with "Allow calling again" (director or floor manager). Pressing the stop twice keeps the first time and person.

## 3. Dry run

Dry run runs the whole gate and writes the `Call` row, but never connects. Use it to check settings
before real calls: place a test call from the softphone, then look at the `Call` row. Expect
`status = blocked` with `dry_run` among the reasons, and no other reason if the call would have been
allowed (the `compliance` JSON has `wouldBeAllowed`). Any other reason is a rule that would have refused it.

## 4. The live check (first real calls)

Follow `TELNYX_SETUP.md` section 9. In short: one manager, dry run off for that team, about ten calls
to numbers the team owns abroad; each parked call must reach the webhook with its token, park to connect
under 1.5 s at p95. If the token does not arrive, stop and switch to the server-originated design in
ADR-001 before the team is switched on. Afterwards the whole team goes live at once (no pilot batches),
provided Telnyx has confirmed a concurrency limit of at least 40 in writing.

## 5. Alerts

Alerts go through `ALERT_WEBHOOK_URL` (`lib/ops/notifyOps.ts`). The text names a team and counts and never
contains a phone number. Each condition alerts once and stays quiet for 30 minutes (the cooldown is held
in the running server process, so a restart may repeat an alert that is still true). Without
`ALERT_WEBHOOK_URL` the alert only reaches the server log: if nobody is being paged, check that first.

| Alert | Meaning | Do this |
|---|---|---|
| Provider balance is low | Telnyx available credit is under `TELNYX_BALANCE_ALERT_USD`. Calls fail when it reaches zero. | Top up in the Telnyx portal (or fix auto-recharge). The alert clears on its own. |
| Provider balance could not be read | The balance request failed (Telnyx down, key revoked, or network). A low balance would go unnoticed. | Check Telnyx status and that `TELNYX_API_KEY` is still valid; if the whole API is down expect failing calls too. |
| Calls are failing for a team | More than 20% of that team's calls over 15 minutes ended `failed`, with at least 10 calls. | Look at the failed `Call` rows' `hangupCause`: `call_rejected` often means the concurrency limit, `unallocated_number` bad data, a run of the same cause across countries means the provider. If it is the provider or you cannot tell quickly, press the emergency stop and reps fall back to calling from their own phones. |
| Webhooks have stopped | Calls were placed in the last 30 minutes and Telnyx has reported nothing. New calls cannot connect and records will not update. | Check the webhook URL and failover URL in the Telnyx portal, that `TELNYX_PUBLIC_KEY` still matches the portal, and that the web container is up. Calls placed meanwhile are repaired by the reconcile cron once events flow again. Stop the dialer if it will not recover. |
| Events are piling up unprocessed | More than 50 stored events older than 2 minutes are not processed. Calls will show old statuses and Activities will be late. | Check the `worker` container and Redis; restart `worker`. The reconcile cron replays the backlog by itself, 100 events per run. |
| Close to the concurrent-call limit | Live calls are at 80% or more of `TELNYX_CONCURRENCY_LIMIT`. Calls over the limit are refused by Telnyx. | Ask Telnyx to raise the limit, or ask the floor to ease off. Only active if `TELNYX_CONCURRENCY_LIMIT` is set. |
| A health check could not run | The check itself hit an error (database or provider). Treat as unknown, not as healthy. | Read the server log line `[telephony-health]`. |

Test an alert without breaking anything: run the health cron by hand with the scheduler secret
(`curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/telephony-health`) while
`TELNYX_BALANCE_ALERT_USD` is set above the real balance. The response lists the findings. A signed-in
manager is refused (403): the checks look across every team.

## 6. Stuck calls and reconcile

`telephony-reconcile` runs every 5 minutes and is safe to run by hand
(`curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/telephony-reconcile`; a director or
floor manager signed in can also run it, for their own team). It:

- replays stored events nobody processed (older than 2 minutes);
- cancels `authorized` calls older than 3 minutes (the rep closed the tab, so nothing was dialled);
- asks Telnyx about calls still `initiated` or `ringing` after 15 minutes, or `answered` after 4 hours,
  and finishes the ones Telnyx no longer has (cause and duration then stay unknown);
- deletes processed events older than 30 days; unprocessed events are never deleted.

A call that stays "live" in the CRM after all that: the response shows `stillAlive`, meaning Telnyx
still has the leg. Look in the Telnyx portal; a real long call is fine.
A rep whose softphone says it is connecting forever: check their login is not revoked, then reload
the page (one softphone per browser; a second tab says "active in another tab").

## 7. Recordings

Recording is on by default and a spoken notice is off by default (both team settings). The retention
(7 to 730 days, default 90) is set on the page and is read when a recording is saved.
Recordings stay at Telnyx; the CRM stores only the id. Playback by the caller and managers and the
purge job are tracked in `TASKS.md` phase 7. If a recording must go earlier than its date, delete it
in the Telnyx portal and clear `Call.recordingProviderId`.

## 8. Caller ID

Phone & dialer lists the numbers the Telnyx account owns. A call shows, in order: the default number for
the lead's country, any number in that country, the overall default, any number, and otherwise
Telnyx's own default. Adding a number here does not buy or port it (do that in the Telnyx portal first).
The first number added becomes the default for its country and the overall default; removing or switching off a default hands it to the next active number, and removing the last number warns you that calls will show Telnyx's own number. A Vietnamese (+84) number cannot be added: Vietnam is never dialled through Telnyx. A number is unique across the whole deployment, and the database allows one default per country and one overall default per team.

## 9. Softphone logins

A login is created the first time a rep opens the softphone. Writes to numbers and revokes are capped per person per minute. Revoke it when a laptop is lost or someone
leaves: the rep is refused a token at once, and the login is deleted at Telnyx. If the response says
"revoked here, but the provider could not be reached", press the button again later: it retries just the
provider part. A revoked rep stays revoked. To give access back, delete that rep's `TelephonyCredential`
row; a new login is created the next time they open the softphone.

## 10. Rollback

1. Emergency stop (seconds, no deploy).
2. If the dialer must be off for a longer time: set "Dialer on for this team" off, or `TELEPHONY_ENABLED=false` and recreate `web` and `worker`.
3. Reps keep working: the lead drawer's Call button opens the number and a QR code for their own phone, and the outcome form logs the call. Nothing there depends on Telnyx.
4. A bad deploy: `scripts/deploy.sh` rollback as for any release. The migrations the dialer added are additive.

## 11. At the cut-over

When the whole team is live and the first week has no wrong blocks, no phantom calls and a CDR match:

- remove `SIP_*` from the env file (the old MicroSIP credentials) and recreate `web` and `worker`;
- end the MicroSIP use and the Bigin dialling for the team;
- keep this runbook current and record the date in `TASKS.md`.

## 12. Owner steps for the health cron

Add the cron line (`docs/DEPLOY.md` cron list, or `docs/DOCKER_DEPLOY.md`), set `ALERT_WEBHOOK_URL`,
`TELNYX_BALANCE_ALERT_USD` and, once Telnyx confirms the limit, `TELNYX_CONCURRENCY_LIMIT`. Then test-fire
the balance alert as in section 5.
