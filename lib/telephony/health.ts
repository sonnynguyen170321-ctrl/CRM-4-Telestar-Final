import 'server-only';

import { notifyOps, type OpsAlertLevel } from '@/lib/ops/notifyOps';
import { prisma, tenantStorage } from '@/lib/prisma';

import { getTelephonyProvider } from './index';
import type { TelephonyProvider } from './provider';
import { safeError } from './safeError';

/**
 * The dialer's health, as people should hear about it (docs/dialer/TASKS.md D9.1, RUNBOOK.md). The
 * cron (`app/api/cron/telephony-health`, every five minutes) asks five questions about the whole
 * platform; each "no" is a finding, and each finding goes to `notifyOps`, whose per-key cooldown keeps
 * a condition that persists from paging every tick.
 *
 *   balance        provider balance under TELNYX_BALANCE_ALERT_USD (skipped when unset)
 *   failure rate   more than 20% of a team's calls failed over 15 minutes, with at least 10 calls
 *   silence        calls were placed in the last 30 minutes and no webhook arrived
 *   backlog        more than 50 stored events nobody processed (older than the two-minute replay grace)
 *   concurrency    live calls at 80% or more of TELNYX_CONCURRENCY_LIMIT (skipped when unset)
 *
 * Alert text names teams and counts, never a phone number, a call id or a person.
 * Everything is judged at `now`, so a test can place its own data in a window no other suite touches.
 */

export const FAILURE_RATE = 0.2;
export const FAILURE_MIN_CALLS = 10;
export const FAILURE_WINDOW_MS = 15 * 60_000;
export const SILENCE_WINDOW_MS = 30 * 60_000;
export const BACKLOG_LIMIT = 50;
/** An event stored this recently is still on its way through the worker. */
export const BACKLOG_GRACE_MS = 2 * 60_000;
/** Events older than this are the reconcile cron's to abandon, not a backlog. */
export const BACKLOG_LOOKBACK_MS = 24 * 60 * 60_000;
export const CONCURRENCY_RATIO = 0.8;
/** A call "live" for longer than this is a lost hangup, which reconcile finishes. */
const LIVE_CALL_LOOKBACK_MS = 4 * 60 * 60_000;
const LIVE_STATUSES = ['initiated', 'ringing', 'answered'] as const;

export type HealthFinding = { key: string; level: OpsAlertLevel; summary: string; details: string[] };

const asSystem = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);
const positiveNumber = (raw: string | undefined) => {
  const value = Number(raw);
  return raw?.trim() && Number.isFinite(value) && value > 0 ? value : null;
};

async function tenantNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await asSystem(() => prisma.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }));
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function checkBalance(provider: TelephonyProvider | undefined): Promise<HealthFinding[]> {
  const threshold = positiveNumber(process.env.TELNYX_BALANCE_ALERT_USD);
  if (threshold === null) return [];
  try {
    const balance = await (provider ?? getTelephonyProvider()).getBalance();
    if (!(balance.availableCredit < threshold)) return [];
    return [
      {
        key: 'telephony:balance',
        level: 'fail',
        summary: 'Dialer provider balance is low: calls will start failing when it runs out',
        details: [`Available ${balance.availableCredit.toFixed(2)} ${balance.currency}, alert below ${threshold}`, 'Top up the provider account (docs/dialer/RUNBOOK.md, "Low balance")'],
      },
    ];
  } catch (error) {
    console.error('[telephony-health] could not read the provider balance', safeError(error));
    return [
      {
        key: 'telephony:balance-unavailable',
        level: 'warn',
        summary: 'Dialer provider balance could not be read, so a low balance would go unnoticed',
        details: ['The provider did not answer the balance request (docs/dialer/RUNBOOK.md, "Low balance")'],
      },
    ];
  }
}

async function checkFailureRate(now: Date): Promise<HealthFinding[]> {
  const since = new Date(now.getTime() - FAILURE_WINDOW_MS);
  const rows = await asSystem(() =>
    prisma.call.groupBy({
      by: ['tenantId', 'status'],
      where: { initiatedAt: { gte: since, lte: now } },
      _count: { _all: true },
    })
  );
  const perTenant = new Map<string, { total: number; failed: number }>();
  for (const row of rows) {
    const entry = perTenant.get(row.tenantId) ?? { total: 0, failed: 0 };
    entry.total += row._count._all;
    if (row.status === 'failed') entry.failed += row._count._all;
    perTenant.set(row.tenantId, entry);
  }
  const bad = [...perTenant].filter(([, { total, failed }]) => total >= FAILURE_MIN_CALLS && failed / total > FAILURE_RATE);
  const names = await tenantNames(bad.map(([id]) => id));
  return bad.map(([tenantId, { total, failed }]) => ({
    key: `telephony:failure-rate:${tenantId}`,
    level: 'fail' as const,
    summary: `Dialer calls are failing for ${names.get(tenantId) ?? 'a team'}: ${Math.round((failed / total) * 100)}% in the last 15 minutes`,
    details: [`${failed} of ${total} calls failed`, 'Check the provider status and the failed calls (docs/dialer/RUNBOOK.md, "Failing calls")'],
  }));
}

async function checkSilence(now: Date): Promise<HealthFinding[]> {
  const since = new Date(now.getTime() - SILENCE_WINDOW_MS);
  const placed = await asSystem(() =>
    prisma.call.groupBy({ by: ['tenantId'], where: { initiatedAt: { gte: since, lte: now } }, _count: { _all: true } })
  );
  if (placed.length === 0) return [];
  const events = await asSystem(() => prisma.telephonyEvent.count({ where: { receivedAt: { gte: since, lte: now } } }));
  if (events > 0) return [];
  const names = await tenantNames(placed.map((row) => row.tenantId));
  return [
    {
      key: 'telephony:webhook-silence',
      level: 'fail',
      summary: 'Dialer webhooks have stopped: calls were placed but the provider has reported nothing for 30 minutes',
      details: [
        `Teams with calls in that time: ${placed.map((row) => `${names.get(row.tenantId) ?? 'unknown'} (${row._count._all})`).join(', ')}`,
        'Check the webhook URL and signature key at the provider (docs/dialer/RUNBOOK.md, "Webhook silence")',
      ],
    },
  ];
}

async function checkBacklog(now: Date): Promise<HealthFinding[]> {
  const count = await asSystem(() =>
    prisma.telephonyEvent.count({
      where: {
        processedAt: null,
        receivedAt: { lt: new Date(now.getTime() - BACKLOG_GRACE_MS), gte: new Date(now.getTime() - BACKLOG_LOOKBACK_MS) },
      },
    })
  );
  if (count <= BACKLOG_LIMIT) return [];
  return [
    {
      key: 'telephony:backlog',
      level: 'warn',
      summary: 'Dialer events are piling up unprocessed: call records may be late or missing',
      details: [`${count} stored events waiting (alert above ${BACKLOG_LIMIT})`, 'Check the worker and the reconcile cron (docs/dialer/RUNBOOK.md, "Event backlog")'],
    },
  ];
}

async function checkConcurrency(now: Date): Promise<HealthFinding[]> {
  const limit = positiveNumber(process.env.TELNYX_CONCURRENCY_LIMIT);
  if (limit === null) return [];
  const live = await asSystem(() =>
    prisma.call.count({
      where: { status: { in: [...LIVE_STATUSES] }, initiatedAt: { gte: new Date(now.getTime() - LIVE_CALL_LOOKBACK_MS), lte: now } },
    })
  );
  if (live < limit * CONCURRENCY_RATIO) return [];
  return [
    {
      key: 'telephony:concurrency',
      level: 'warn',
      summary: 'Dialer is close to the provider concurrent-call limit: further calls may be refused',
      details: [`${live} of ${limit} concurrent calls in use`, 'Ask the provider to raise the limit (docs/dialer/RUNBOOK.md, "Concurrency")'],
    },
  ];
}

export async function checkTelephonyHealth(options: { now?: Date; provider?: TelephonyProvider } = {}): Promise<HealthFinding[]> {
  if (process.env.TELEPHONY_ENABLED !== 'true') return [];
  const now = options.now ?? new Date();
  const checks: Array<[string, () => Promise<HealthFinding[]>]> = [
    ['balance', () => checkBalance(options.provider)],
    ['failure-rate', () => checkFailureRate(now)],
    ['silence', () => checkSilence(now)],
    ['backlog', () => checkBacklog(now)],
    ['concurrency', () => checkConcurrency(now)],
  ];
  const findings: HealthFinding[] = [];
  for (const [name, run] of checks) {
    try {
      findings.push(...(await run()));
    } catch (error) {
      // One broken question must not hide the answers to the others.
      console.error(`[telephony-health] the ${name} check failed`, safeError(error));
      findings.push({
        key: `telephony:check-error:${name}`,
        level: 'warn',
        summary: `Dialer health check "${name}" could not run`,
        details: ['The check hit an error; see the server log (docs/dialer/RUNBOOK.md)'],
      });
    }
  }
  return findings;
}

/** Run the checks and tell people. `notified` counts the messages a webhook accepted (cooldown skips are not counted). */
export async function runTelephonyHealth(options: { now?: Date; provider?: TelephonyProvider } = {}) {
  const findings = await checkTelephonyHealth(options);
  let notified = 0;
  for (const finding of findings) {
    if (await notifyOps({ key: finding.key, level: finding.level, summary: finding.summary, details: finding.details })) notified += 1;
  }
  return { findings, notified };
}
