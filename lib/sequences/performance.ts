import type { Prisma } from '@prisma/client';

import { getLocalDayBoundaries } from '@/lib/dates/timezone';
import { prisma } from '@/lib/prisma';

/**
 * One sequence's performance, from the rows that record what actually happened.
 *
 * The owner asked for a sequence dashboard with open, click, bounce and reply rates. The older
 * `getSequenceAnalytics` could not serve it honestly: it counted sends from activity metadata,
 * counted a bounce only when a cadence was unenrolled with reason "bounced" — a reason nothing
 * writes since bounces pause with "hard_bounce" / "soft_bounce" — and counted "active" from the
 * lead's single sequence pointer, which is wrong once a lead runs several sequences.
 *
 * Here every number comes from its own source of truth:
 *   - enrollments: `SequenceEnrollment` by status;
 *   - sends: `OutboundMessage` with a `sentAt` — accepted by the provider, not merely queued, and
 *     not a dry run (`REAL_SEND`);
 *   - opens / clicks: the message's `openedAt` / `clickedAt`, written only by verified, non-machine
 *     tracking hits, and reported as `null` (not 0%) when the sequence does not track them;
 *   - replies / bounces: the message's `repliedAt` / `bouncedAt`.
 *
 * Rates are over messages sent, counted in the database (no row is loaded). Per-step rows use
 * `sequenceStepOrder`. A reply is credited to the message the reply sync matched — the newest one
 * sent to that lead from that mailbox — so a late reply to step 1 can land on step 2: the totals
 * are exact, a step's reply rate is "replies after this step". Messages whose step no longer exists
 * (or never had one) are reported in an `order: null` row, so the steps always add up to the total.
 */

/**
 * A message that was really handed to a provider. The dry-run gate (workers/email.ts) also sets
 * `sentAt`, under a `dry-run-` provider id, so a demo or staging tenant would otherwise report
 * sends nobody received. Written as an explicit OR: `NOT startsWith` alone is false for a NULL id
 * in SQL and would silently drop real sends that carry no provider id.
 */
export const REAL_SEND: Prisma.OutboundMessageWhereInput = {
  OR: [{ providerMessageId: null }, { NOT: { providerMessageId: { startsWith: 'dry-run-' } } }],
};

/** Days in the sends-per-day series. */
export const DAILY_SERIES_DAYS = 30;

/**
 * Sends per calendar day in the viewer's timezone for the last `days` days, oldest first, a zero
 * for a quiet day — so the last bar is the same "today" the cards count.
 *
 * One exact count per day rather than loading the rows: a busy tenant sends far more in a month
 * than is worth pulling into memory, and a capped read would undercount without saying so.
 */
export async function getDailySends(input: {
  tenantId: string;
  sequenceId?: string;
  leadWhere?: Prisma.LeadWhereInput;
  timezone?: string;
  days?: number;
  now?: Date;
}): Promise<Array<{ date: string; count: number }>> {
  const days = input.days ?? DAILY_SERIES_DAYS;
  const now = input.now ?? new Date();
  const timezone = input.timezone || 'UTC';
  // Midnight of each day, oldest first, plus tomorrow's to close the last one.
  const starts = Array.from({ length: days + 1 }, (_, index) =>
    getLocalDayBoundaries(new Date(now.getTime() - (days - 1 - index) * 86_400_000), timezone).start
  );
  const label = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return Promise.all(
    starts.slice(0, days).map(async (start, index) => ({
      date: label.format(start),
      count: await prisma.outboundMessage.count({
        where: {
          AND: [
            REAL_SEND,
            {
              tenantId: input.tenantId,
              ...(input.sequenceId ? { sequenceId: input.sequenceId } : { sequenceId: { not: null } }),
              sentAt: { gte: start, lt: starts[index + 1] },
              ...(input.leadWhere ? { lead: input.leadWhere } : {}),
            },
          ],
        },
      }),
    }))
  );
}

export const PERFORMANCE_WINDOWS = { '7d': 7, '30d': 30, '90d': 90, all: null } as const;
export type PerformanceWindow = keyof typeof PERFORMANCE_WINDOWS;

/**
 * `openTracked`: sends that carried the open pixel — the open rate's denominator. A send without
 * the pixel cannot be seen opening, and counting it made a sequence that turned tracking on half
 * way look half as opened (owner, 2026-10-07: "is the open rate legit?").
 */
type Counts = { sent: number; openTracked: number; opened: number; clicked: number; replied: number; bounced: number };
type CountKey = keyof Counts;

export type RateRow = Counts & {
  openRate: number | null;
  clickRate: number | null;
  replyRate: number | null;
  bounceRate: number | null;
};

export type SequencePerformance = {
  window: PerformanceWindow;
  tracking: { opens: boolean; clicks: boolean };
  enrollments: { total: number; active: number; paused: number; completed: number; unenrolled: number };
  totals: RateRow;
  /** One row per current step, then an `order: null` row for messages from removed or no step. */
  steps: Array<RateRow & { order: number | null; channel: string | null }>;
};

function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

function toRow(counts: Counts, tracking: { opens: boolean; clicks: boolean }): RateRow {
  return {
    ...counts,
    // An estimate either way: Apple Mail Privacy Protection and scanners are filtered out as
    // machines (lib/email/tracking.ts), which also drops real opens made through them.
    openRate: tracking.opens || counts.openTracked > 0 ? rate(counts.opened, counts.openTracked) : null,
    clickRate: tracking.clicks ? rate(counts.clicked, counts.sent) : null,
    replyRate: rate(counts.replied, counts.sent),
    bounceRate: rate(counts.bounced, counts.sent),
  };
}

const empty = (): Counts => ({ sent: 0, openTracked: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 });

/** The timestamp each count requires, beyond having been sent. */
const MARKER: Record<Exclude<CountKey, 'sent' | 'openTracked'>, 'openedAt' | 'clickedAt' | 'repliedAt' | 'bouncedAt'> = {
  opened: 'openedAt',
  clicked: 'clickedAt',
  replied: 'repliedAt',
  bounced: 'bouncedAt',
};

export async function getSequencePerformance(input: {
  tenantId: string;
  sequenceId: string;
  window?: PerformanceWindow;
  now?: Date;
  /** Count only these leads (a viewer's scope). Omitted: every lead in the tenant. */
  leadWhere?: Prisma.LeadWhereInput;
}): Promise<SequencePerformance | null> {
  const window = input.window ?? '30d';
  const days = PERFORMANCE_WINDOWS[window];
  const since = days === null ? null : new Date((input.now ?? new Date()).getTime() - days * 86_400_000);

  const sequence = await prisma.sequence.findFirst({
    where: { id: input.sequenceId, tenantId: input.tenantId },
    select: {
      trackOpens: true,
      trackClicks: true,
      steps: { select: { order: true, channel: true }, orderBy: { order: 'asc' } },
    },
  });
  if (!sequence) return null;
  const tracking = { opens: sequence.trackOpens, clicks: sequence.trackClicks };

  const sentWhere: Prisma.OutboundMessageWhereInput = {
    tenantId: input.tenantId,
    sequenceId: input.sequenceId,
    sentAt: since ? { gte: since } : { not: null },
    ...(input.leadWhere ? { lead: input.leadWhere } : {}),
  };
  const countByStep = (extra: Prisma.OutboundMessageWhereInput) =>
    prisma.outboundMessage.groupBy({
      by: ['sequenceStepOrder'],
      where: { AND: [REAL_SEND, sentWhere, extra] },
      _count: { _all: true },
    });

  const [byStatus, ...grouped] = await Promise.all([
    prisma.sequenceEnrollment.groupBy({
      by: ['status'],
      where: { tenantId: input.tenantId, sequenceId: input.sequenceId, ...(input.leadWhere ? { lead: input.leadWhere } : {}) },
      _count: { _all: true },
    }),
    countByStep({}),
    ...Object.values(MARKER).map((field) => countByStep({ [field]: { not: null } })),
    // Sent with the pixel. A message from before `openTracked` existed (null) is taken to follow
    // the sequence's current setting — the owner's call, 2026-10-07, and the reason the rate is
    // labelled an estimate.
    countByStep(
      tracking.opens ? { OR: [{ openTracked: true }, { openTracked: null }] } : { openTracked: true }
    ),
  ]);

  const statusCount = (status: string) => byStatus.find((row) => row.status === status)?._count._all ?? 0;
  const enrollments = {
    total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
    active: statusCount('active'),
    paused: statusCount('paused'),
    completed: statusCount('completed'),
    unenrolled: statusCount('unenrolled'),
  };

  const currentOrders = new Set(sequence.steps.map((step) => step.order));
  const total = empty();
  const perStep = new Map<number, Counts>();
  const other = empty();
  const keys: CountKey[] = ['sent', ...(Object.keys(MARKER) as CountKey[]), 'openTracked'];
  keys.forEach((key, index) => {
    for (const row of grouped[index]) {
      const order = row.sequenceStepOrder;
      const bucket = order !== null && currentOrders.has(order) ? (perStep.get(order) ?? empty()) : other;
      bucket[key] += row._count._all;
      total[key] += row._count._all;
      if (bucket !== other) perStep.set(order as number, bucket);
    }
  });

  const steps: SequencePerformance['steps'] = sequence.steps.map((step) => ({
    order: step.order,
    channel: step.channel,
    ...toRow(perStep.get(step.order) ?? empty(), tracking),
  }));
  if (other.sent > 0) steps.push({ order: null, channel: null, ...toRow(other, tracking) });

  return { window, tracking, enrollments, totals: toRow(total, tracking), steps };
}
