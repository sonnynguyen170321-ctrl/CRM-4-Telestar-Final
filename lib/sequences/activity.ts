import { getLeadWhereScope, type SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * What has happened to one sequence: who changed it, and what the cadence did.
 *
 * The owner asked for "a tab that tracks the sequence's activity — who edited it, what the worker
 * did". Two sources, merged newest first:
 *
 *   - **Edits** — `AuditLog` rows filed against the sequence that name the person who acted: its
 *     creation, and the `admin.sequence.*` entries the sequence and sender routes write. The rows
 *     the Prisma audit extension writes on every update are deliberately left out: that extension
 *     attributes a change to the record's `createdById`, so every edit would read as the creator's.
 *   - **Cadence events** — `Activity` rows carrying the sequence: enrollments, sends, pauses and
 *     their reasons, completions, unenrollments. These name a lead.
 *
 * The lead-naming half is scoped like every other lead read (`getLeadWhereScope`): a director sees
 * the whole cadence, a team lead their team's and campaigns' leads, a rep their own. A sequence
 * shared across teams must not become a way to read another team's prospects.
 */

export const ACTIVITY_LIMIT = 100;

export type SequenceActivityItem = {
  id: string;
  at: Date;
  kind: 'edit' | 'cadence';
  actor: { id: string; name: string } | null;
  summary: string;
  lead?: { id: string; name: string } | null;
};

const EDIT_ACTIONS = ['create_sequence', 'admin.sequence.update', 'admin.sequence.senders', 'admin.sequence.archive'];

const FIELD_LABEL: Record<string, string> = {
  name: 'name',
  description: 'description',
  isActive: 'active',
  trackOpens: 'open tracking',
  trackClicks: 'click tracking',
  steps: 'steps',
};

export function describeEdit(action: string, changedFields: unknown): string {
  const fields =
    changedFields && typeof changedFields === 'object'
      ? Object.keys(changedFields as Record<string, unknown>).filter((key) => !key.startsWith('__'))
      : [];
  switch (action) {
    case 'create_sequence':
      return 'Created the sequence';
    case 'admin.sequence.archive':
      return 'Archived the sequence';
    case 'admin.sequence.senders':
      return 'Changed the sending mailboxes';
    default: {
      const labels = fields.map((key) => FIELD_LABEL[key] ?? key);
      return labels.length ? `Changed ${labels.join(', ')}` : 'Changed the sequence';
    }
  }
}

const personName = (person: { firstName: string | null; lastName: string | null }) =>
  `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() || 'Someone';

export async function getSequenceActivity(input: {
  user: SessionUser;
  tenantId: string;
  sequenceId: string;
  limit?: number;
}): Promise<SequenceActivityItem[] | null> {
  const limit = Math.min(input.limit ?? ACTIVITY_LIMIT, ACTIVITY_LIMIT);
  const sequence = await prisma.sequence.findFirst({
    where: { id: input.sequenceId, tenantId: input.tenantId },
    select: { id: true },
  });
  if (!sequence) return null;

  const leadScope = await getLeadWhereScope(input.user);
  const scoped = Object.keys(leadScope).length > 0;

  const [edits, events] = await Promise.all([
    prisma.auditLog.findMany({
      where: { tenantId: input.tenantId, tableName: 'Sequence', recordId: sequence.id, action: { in: EDIT_ACTIONS } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        changedFields: true,
        createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.activity.findMany({
      where: {
        tenantId: input.tenantId,
        sequenceId: sequence.id,
        // A scoped viewer sees only events on leads they can see; an event with no lead says
        // nothing about a prospect and is dropped with them rather than special-cased.
        ...(scoped ? { lead: leadScope } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        description: true,
        createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true } },
        lead: { select: { id: true, firstName: true, lastName: true, company: true } },
      },
    }),
  ]);

  const items: SequenceActivityItem[] = [
    ...edits.map((row) => ({
      id: `audit:${row.id}`,
      at: row.createdAt,
      kind: 'edit' as const,
      actor: row.user ? { id: row.user.id, name: personName(row.user) } : null,
      summary: describeEdit(row.action, row.changedFields),
    })),
    ...events.map((row) => ({
      id: `activity:${row.id}`,
      at: row.createdAt,
      kind: 'cadence' as const,
      actor: row.user ? { id: row.user.id, name: personName(row.user) } : null,
      summary: row.description ?? row.type.replace(/_/g, ' '),
      lead: row.lead
        ? { id: row.lead.id, name: `${personName(row.lead)}${row.lead.company ? ` · ${row.lead.company}` : ''}` }
        : null,
    })),
  ];

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
