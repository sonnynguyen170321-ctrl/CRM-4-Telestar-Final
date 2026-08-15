import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import { getLeadgenMetrics } from '@/lib/leadgen/metrics';
import { resolveScope } from './shared';
import { group, pct, type ExceptionItem, type RoleSurface } from './types';

/**
 * The Leadgen Manager surface — supply quality, not supply volume (Phase 9).
 *
 * Sourcing a thousand contacts is not the achievement; sourcing a thousand *contactable, in-ICP,
 * non-duplicate* contacts is. So the exceptions here are all forms of "this supply will cost an
 * SDR time": duplicates, unreachable addresses, missing required fields, and sources whose leads
 * look fine on arrival and then go nowhere.
 *
 * `getLeadgenMetrics` owns the pool numbers. This surface reads them and adds the one join that
 * module does not make — supply quality against what the SDR floor later did with it.
 */
export async function buildLeadgenManagerSurface(user: SessionUser): Promise<RoleSurface> {
  const scope = await resolveScope(user);
  const [metrics, rejections, requiredFieldGaps, sourceBehaviour] = await Promise.all([
    getLeadgenMetrics(scope.tenantId),
    prisma.leadPoolItem.groupBy({
      by: ['disqualifiedReason'],
      where: { tenantId: scope.tenantId, status: 'disqualified', disqualifiedReason: { not: null } },
      _count: { _all: true },
    }),
    // Contactability, at the point it can still be fixed: qualified items missing what an SDR
    // needs to work them.
    prisma.leadPoolItem.findMany({
      where: {
        tenantId: scope.tenantId,
        qualification: 'qualified',
        OR: [{ email: null }, { title: null }],
      },
      select: { id: true, firstName: true, lastName: true, title: true, email: true, sourceName: true, sourceType: true },
      take: 200,
    }),
    loadSourceBehaviour(scope.tenantId),
  ]);

  const rejectionItems: ExceptionItem[] = rejections
    .sort((a, b) => b._count._all - a._count._all)
    .map((r) => ({
      id: `rejection-${r.disqualifiedReason}`,
      primary: (r.disqualifiedReason ?? 'unspecified').replace(/_/g, ' '),
      secondary: `${r._count._all} sourced contact${r._count._all === 1 ? '' : 's'} rejected for this reason.`,
      meta: 'Fix at the source, not in the CRM',
      ageHours: r._count._all,
    }));

  const missingData: ExceptionItem[] = requiredFieldGaps.map((item) => {
    const missing = [
      !item.email ? 'email' : null,
      !item.title ? 'job title' : null,
    ].filter(Boolean);
    return {
      id: `gap-${item.id}`,
      primary: `${item.firstName ?? ''} ${item.lastName ?? ''}`.trim() || 'Unnamed contact',
      secondary: `Qualified but missing ${missing.join(', ')}.`,
      meta: item.sourceName ?? item.sourceType,
      ageHours: missing.length,
    };
  });

  const sourceItems: ExceptionItem[] = sourceBehaviour
    .filter((s) => s.delivered >= 10 && s.replyRate < 0.02)
    .map((s) => ({
      id: `source-${s.source}`,
      primary: s.source,
      secondary: `${s.delivered} contacts delivered, ${s.replies} replies. Qualification passed; the market did not.`,
      meta: `${pct(s.replies, s.delivered)} reply rate`,
      ageHours: s.delivered,
    }));

  const duplicateItems: ExceptionItem[] =
    metrics.duplicateRate >= 5
      ? [{
          id: 'duplicate-rate',
          primary: `${metrics.duplicateRate}% of the pool is duplicate`,
          secondary: 'Every duplicate is an SDR contacting someone a colleague already did.',
          meta: `${metrics.totalPool} contacts in the pool`,
          ageHours: metrics.duplicateRate,
        }]
      : [];

  const shortfalls: ExceptionItem[] = metrics.requirementProgress
    .filter((r) => r.status !== 'fulfilled' && r.delivered < r.required)
    .map((r) => ({
      id: `requirement-${r.campaignId}`,
      primary: r.campaignName,
      secondary: `${r.delivered} of ${r.required} contacts delivered.`,
      meta: `${r.required - r.delivered} short`,
      ageHours: r.required - r.delivered,
    }));

  return {
    key: 'leadgen_manager',
    title: 'Supply quality',
    focus: 'Whether what leadgen delivers is worth an SDR’s time — not how much of it there is.',
    scope: 'organisation',
    metrics: [
      { key: 'qualified_week', label: 'Qualified this week', value: String(metrics.qualifiedWeek), raw: metrics.qualifiedWeek, tone: 'neutral' },
      { key: 'duplicate_rate', label: 'Duplicate rate', value: `${metrics.duplicateRate}%`, raw: metrics.duplicateRate, tone: metrics.duplicateRate >= 5 ? 'risk' : 'neutral' },
      { key: 'contactable', label: 'Contactable', value: `${metrics.emailValidRate}%`, raw: metrics.emailValidRate, tone: metrics.emailValidRate < 85 ? 'risk' : 'ai', hint: 'Valid email on a qualified contact' },
      { key: 'missing_data', label: 'Missing required data', value: String(requiredFieldGaps.length), raw: requiredFieldGaps.length, tone: 'attention' },
      { key: 'rejected_week', label: 'Rejected this week', value: String(metrics.disqualifiedWeek), raw: metrics.disqualifiedWeek, tone: 'waiting' },
    ],
    groups: [
      group(
        'requirements', 'Campaigns short of contacts',
        'Campaigns whose agreed contact count has not been delivered.',
        'critical', 'Every campaign has the contacts it asked for.', shortfalls
      ),
      group(
        'missing_data', 'Qualified but not workable',
        'Contacts that passed qualification without what an SDR needs to reach them.',
        'critical', 'Every qualified contact is workable.', missingData
      ),
      group(
        'duplicates', 'Duplicate supply',
        'Duplicates cost an SDR the same time as a real contact and cost the prospect their patience.',
        'warning', 'Duplicate rate is inside the acceptable range.', duplicateItems
      ),
      group(
        'source_behaviour', 'Sources that qualify well and perform badly',
        'Contacts that passed qualification and then produced almost no replies. Qualification criteria, not rep effort.',
        'warning', 'Every source is producing replies at the expected rate.', sourceItems
      ),
      group(
        'rejections', 'Why contacts are being rejected',
        'The reasons qualification is turning supply away, largest first.',
        'info', 'Nothing is being rejected.', rejectionItems
      ),
    ],
    sources: ['Leadgen pool metrics', 'Campaign lead requirements', 'Inbound replies'],
  };
}

interface SourceBehaviour {
  source: string;
  delivered: number;
  replies: number;
  replyRate: number;
}

/**
 * The join leadgen metrics deliberately does not make: supply quality *at source* against what
 * happened after an SDR worked it.
 *
 * This is the difference between "leadgen delivered 400 qualified contacts" and "those 400
 * produced two replies" — the second is the only one that tells a Leadgen Manager to change the
 * qualification criteria.
 */
async function loadSourceBehaviour(tenantId: string): Promise<SourceBehaviour[]> {
  const items = await prisma.leadPoolItem.findMany({
    where: { tenantId, qualification: 'qualified', convertedLeadId: { not: null } },
    select: { convertedLeadId: true, sourceName: true, sourceType: true },
    take: 2000,
  });
  if (items.length === 0) return [];

  const leadIds = items.map((i) => i.convertedLeadId!).filter(Boolean);
  const replied = await prisma.inboundMessage.groupBy({
    by: ['leadId'],
    where: { tenantId, leadId: { in: leadIds }, replyClass: { not: null } },
    _count: { _all: true },
  });
  const repliedLeads = new Set(replied.map((r) => r.leadId).filter((id): id is string => Boolean(id)));

  const bySource = new Map<string, SourceBehaviour>();
  for (const item of items) {
    const key = item.sourceName || item.sourceType;
    const entry = bySource.get(key) ?? { source: key, delivered: 0, replies: 0, replyRate: 0 };
    entry.delivered += 1;
    if (item.convertedLeadId && repliedLeads.has(item.convertedLeadId)) entry.replies += 1;
    bySource.set(key, entry);
  }

  return [...bySource.values()]
    .map((s) => ({ ...s, replyRate: s.delivered > 0 ? s.replies / s.delivered : 0 }))
    .sort((a, b) => a.replyRate - b.replyRate);
}
