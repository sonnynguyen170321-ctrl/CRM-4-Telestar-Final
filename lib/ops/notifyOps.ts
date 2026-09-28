/**
 * The one path in this system that reaches a human.
 *
 * Every detector in this codebase was real and every one of them ended somewhere nobody looks:
 * `console.error` into `docker logs`, a `logger -t crm` line into syslog that nothing reads, a
 * `Notification` row that only appears on the next full page load, or an `EmailHealthAlert` visible
 * on a page a floor manager has to think to open. A repo-wide search for slack / pagerduty / sentry
 * / opsgenie / any alert webhook returned nothing. So when the worker stopped, every page still
 * loaded, every button still returned 200, and the only way to find out was to notice.
 *
 * This module is deliberately small and deliberately dumb: format a line, POST it, never throw.
 *
 * ## Configuration
 *
 * `ALERT_WEBHOOK_URL` — any incoming-webhook endpoint that accepts a JSON body with a `text` field.
 * Slack, Discord (with `/slack` suffix), Telegram via a relay, Mattermost and Google Chat all do.
 * Unset means alerting is off, which is reported once per process rather than silently.
 *
 * `ALERT_ENV_LABEL` — optional prefix so a staging box cannot be mistaken for production.
 *
 * ## Why it never throws
 *
 * An alerter that can fail the thing it is watching is worse than no alerter. Every failure here is
 * caught and logged, and the caller is told nothing — the return value says whether a human was
 * reached, for callers that want to log that, not for control flow.
 */

export type OpsAlertLevel = 'warn' | 'fail';

export interface OpsAlert {
  /** Stable identifier for the condition, used for cooldown. e.g. 'worker-heartbeat'. */
  key: string;
  level: OpsAlertLevel;
  /** One line, in plain words, that says what is wrong. */
  summary: string;
  /** Optional supporting lines: the numbers behind the summary. */
  details?: string[];
}

/**
 * How long the same `key` stays quiet after being sent.
 *
 * Without this, a condition checked every five minutes pages someone every five minutes until it is
 * fixed, and the second message teaches nobody anything the first did not. Per-process and
 * in-memory on purpose: a restart is allowed to re-alert, because a restart may be the incident.
 */
const COOLDOWN_MS = 30 * 60 * 1000;
const lastSentAt = new Map<string, number>();

let missingWebhookLogged = false;

function envLabel(): string {
  const label = process.env.ALERT_ENV_LABEL?.trim();
  return label ? `[${label}] ` : '';
}

/** Exported for tests: clears the cooldown so each case starts from silence. */
export function resetOpsAlertCooldown(): void {
  lastSentAt.clear();
}

export function formatOpsAlert(alert: OpsAlert): string {
  const icon = alert.level === 'fail' ? '🔴' : '🟠';
  const head = `${icon} ${envLabel()}${alert.summary}`;
  if (!alert.details || alert.details.length === 0) return head;
  return [head, ...alert.details.map((d) => `  • ${d}`)].join('\n');
}

/**
 * Send one alert, unless the same key was sent inside the cooldown.
 *
 * Returns `true` only when a webhook actually accepted the message — so a caller can log "nobody was
 * told" honestly instead of assuming delivery, which is the exact mistake this module exists to stop
 * the rest of the system making.
 */
export async function notifyOps(alert: OpsAlert): Promise<boolean> {
  const now = Date.now();
  const previous = lastSentAt.get(alert.key);
  if (previous !== undefined && now - previous < COOLDOWN_MS) return false;

  const text = formatOpsAlert(alert);
  const url = process.env.ALERT_WEBHOOK_URL?.trim();

  if (!url) {
    // Said once per process, not once per alert: a missing webhook is a deployment fact, and
    // repeating it every five minutes would bury the alert text underneath it.
    if (!missingWebhookLogged) {
      console.error(
        '[notifyOps] ALERT_WEBHOOK_URL is not set — operational alerts have nowhere to go. ' +
          'Set it to an incoming-webhook URL to have these reach a person.'
      );
      missingWebhookLogged = true;
    }
    console.error(`[notifyOps] ${text}`);
    return false;
  }

  // Marked as sent before awaiting, so a slow endpoint cannot let a five-minute caller stack up
  // several in-flight posts for one condition.
  lastSentAt.set(alert.key, now);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      // The alert is still written locally, so a failed post degrades to today's behaviour rather
      // than losing the finding altogether.
      console.error(`[notifyOps] webhook returned ${res.status}; alert not delivered: ${text}`);
      // Allowed to retry on the next tick rather than waiting out the cooldown on a failure.
      lastSentAt.delete(alert.key);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[notifyOps] webhook post failed; alert not delivered: ${text}`, err);
    lastSentAt.delete(alert.key);
    return false;
  }
}
