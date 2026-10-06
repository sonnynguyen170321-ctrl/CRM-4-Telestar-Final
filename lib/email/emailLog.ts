import type { Prisma } from '@prisma/client';

/**
 * Email Log — every outbound email the viewer can see, sent or not, and why (owner, 2026-10-06:
 * "a detail view like the Activity tab for sent and not sent, with filters, so I can track it").
 *
 * One query shape for the Email Log page and each sequence's Sends tab. Scope is always the
 * viewer's leads (getLeadWhereScope), so an SDR sees their own, a team lead their pod, and so on.
 */

/** The groups the table filters and counts by, and the OutboundMessage statuses behind each. */
export const EMAIL_LOG_STATUS_GROUPS = {
  sent: ['sent'],
  waiting: ['pending', 'sending'],
  failed: ['failed', 'permanently_failed', 'reconciliation_required'],
  bounced: ['bounced'],
} as const;

export type EmailLogStatusGroup = keyof typeof EMAIL_LOG_STATUS_GROUPS;
export type EmailLogEngagement = 'opened' | 'clicked' | 'replied';

export type EmailLogFilters = {
  status?: EmailLogStatusGroup;
  accountId?: string;
  assignedToId?: string;
  sequenceId?: string;
  step?: number;
  campaignId?: string;
  dateFrom?: Date;
  /** Exclusive: the midnight after the last day asked for. */
  dateTo?: Date;
  engagement?: EmailLogEngagement;
};

const ENGAGEMENTS: readonly EmailLogEngagement[] = ['opened', 'clicked', 'replied'];
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function id(value: string | null): string | undefined {
  return value && ID.test(value) ? value : undefined;
}

function day(value: string | null, plusDays = 0): Date | undefined {
  if (!value || !DAY.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setDate(date.getDate() + plusDays);
  return date;
}

/** Query string → filters. Anything not one of the allowed values is dropped, never trusted. */
export function parseEmailLogFilters(params: URLSearchParams): EmailLogFilters {
  const filters: EmailLogFilters = {};
  const status = params.get('status');
  if (status && status in EMAIL_LOG_STATUS_GROUPS) filters.status = status as EmailLogStatusGroup;
  const accountId = id(params.get('accountId'));
  if (accountId) filters.accountId = accountId;
  const assignedToId = id(params.get('assignedToId'));
  if (assignedToId) filters.assignedToId = assignedToId;
  const sequenceId = id(params.get('sequenceId'));
  if (sequenceId) filters.sequenceId = sequenceId;
  const step = Number(params.get('step'));
  if (Number.isInteger(step) && step >= 1 && step <= 100) filters.step = step;
  const campaignId = id(params.get('campaignId'));
  if (campaignId) filters.campaignId = campaignId;
  const dateFrom = day(params.get('dateFrom'));
  if (dateFrom) filters.dateFrom = dateFrom;
  const dateTo = day(params.get('dateTo'), 1);
  if (dateTo) filters.dateTo = dateTo;
  const engagement = params.get('engagement');
  if (engagement && (ENGAGEMENTS as readonly string[]).includes(engagement)) {
    filters.engagement = engagement as EmailLogEngagement;
  }
  return filters;
}

/** Filters → a where clause that never leaves the viewer's leads. */
export function buildEmailLogWhere(
  leadScope: Prisma.LeadWhereInput,
  filters: EmailLogFilters,
): Prisma.OutboundMessageWhereInput {
  const leadFilter: Prisma.LeadWhereInput[] = [leadScope];
  if (filters.assignedToId) leadFilter.push({ assignedToId: filters.assignedToId });
  if (filters.campaignId) leadFilter.push({ campaignId: filters.campaignId });

  const clauses: Prisma.OutboundMessageWhereInput[] = [
    { lead: { is: leadFilter.length === 1 ? leadScope : { AND: leadFilter } } },
  ];
  if (filters.status) clauses.push({ status: { in: [...EMAIL_LOG_STATUS_GROUPS[filters.status]] } });
  if (filters.accountId) clauses.push({ accountId: filters.accountId });
  if (filters.sequenceId) clauses.push({ sequenceId: filters.sequenceId });
  if (filters.step) clauses.push({ sequenceStepOrder: filters.step });
  if (filters.dateFrom || filters.dateTo) {
    clauses.push({
      createdAt: {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lt: filters.dateTo } : {}),
      },
    });
  }
  if (filters.engagement === 'opened') clauses.push({ openedAt: { not: null } });
  if (filters.engagement === 'clicked') clauses.push({ clickedAt: { not: null } });
  if (filters.engagement === 'replied') clauses.push({ repliedAt: { not: null } });

  return { AND: clauses };
}

/** Which group a stored status falls in, for the per-group counts. */
export function statusGroupOf(status: string): EmailLogStatusGroup | null {
  for (const [group, statuses] of Object.entries(EMAIL_LOG_STATUS_GROUPS)) {
    if ((statuses as readonly string[]).includes(status)) return group as EmailLogStatusGroup;
  }
  return null;
}
