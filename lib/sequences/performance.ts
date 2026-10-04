import type { Prisma } from '@prisma/client';

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

/** Sends per calendar day (UTC) for the last `days` days, oldest first, a zero for a quiet day. */
export async function getDailySends(input: {
  tenantId: string;
  sequenceId?: string;
  leadWhere?: Prisma.LeadWhereInput;
  days?: number;
  now?: Date;
}): Promise<Array<{ date: string; count: number }>> {
  const days = input.days ?? DAILY_SERIES_DAYS;
  const now = input.now ?? new Date();
  const firstDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  const rows = await prisma.outboundMessage.findMany({
    where: {
      AND: [
        REAL_SEND,
        {
          tenantId: input.tenantId,
          ...(input.sequenceId ? { sequenceId: input.sequenceId } : { sequenceId: { not: null } }),
          sentAt: { gte: firstDay },
          ...(input.leadWhere ? { lead: input.leadWhere } : {}),
        },
      ],
    },
    select: { sentAt: true },
    take: 100_000,
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.sentAt!.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(firstDay.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    return { date, count: counts.get(date) ?? 0 };
  });
}

export const PERFORMANCE_WINDOWS = { '7d': 7, '30d': 30, '90d': 90, all: null } as const;
export type PerformanceWindow = keyof typeof PERFORMANCE_WINDOWS;

type Counts = { sent: number; opened: number; clicked: number; replied: number; bounced: number };
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
    openRate: tracking.opens ? rate(counts.opened, counts.sent) : null,
    clickRate: tracking.clicks ? rate(counts.clicked, counts.sent) : null,
    replyRate: rate(counts.replied, counts.sent),
    bounceRate: rate(counts.bounced, counts.sent),
  };
}

const empty = (): Counts => ({ sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 });

/** The timestamp each count requires, beyond having been sent. */
const MARKER: Record<Exclude<CountKey, 'sent'>, 'openedAt' | 'clickedAt' | 'repliedAt' | 'bouncedAt'> = {
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
      where: { tenantId: input.tenantId, sequenceId: input.sequenceId },
      _count: { _all: true },
    }),
    countByStep({}),
    ...Object.values(MARKER).map((field) => countByStep({ [field]: { not: null } })),
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
  const keys: CountKey[] = ['sent', ...(Object.keys(MARKER) as CountKey[])];
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
