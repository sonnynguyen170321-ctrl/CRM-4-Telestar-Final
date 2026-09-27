/**
 * List the leads that share an address, with enough context to decide what to do about each.
 *
 * Read-only. It writes nothing and has no `--apply`: merging leads destroys history, and which
 * copy to keep is a judgement about a real prospect relationship, not a rule.
 *
 * Production on 2026-09-27 held 420 such groups in one campaign — 698 rows beyond the first —
 * and 150 addresses had already received mail from more than one of them. Duplicate leads are
 * allowed here by decision (several personas may target one person); this exists so the scale
 * of that decision is visible rather than assumed.
 *
 *   npx tsx scripts/report-duplicate-leads.ts               # groups that have been emailed twice
 *   npx tsx scripts/report-duplicate-leads.ts --all         # every duplicate group
 *   npx tsx scripts/report-duplicate-leads.ts --limit=50
 *
 * For each lead in a group it shows the signals that decide which one is the real relationship:
 * replies first, then sends, then whether a cadence is running, then age.
 */
import { prisma } from '@/lib/prisma';
import { forEachTenant } from './lib/tenantContext';

const ALL = process.argv.includes('--all');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) ?? 25);

type LeadRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  stage: string;
  createdAt: Date;
  emailSentCount: number;
  archivedAt: Date | null;
  owner: string;
  campaign: string;
  sent: number;
  replies: number;
  activeCadence: boolean;
};

/** Replies outrank sends, sends outrank a running cadence, and age breaks the tie. */
function rank(l: LeadRow): string {
  if (l.replies > 0) return 'REPLIED — keep this one';
  if (l.sent > 0) return `${l.sent} sent`;
  if (l.activeCadence) return 'cadence running, nothing sent';
  return 'never contacted';
}

async function reportTenant(tenantName: string): Promise<void> {
  const leads = await prisma.lead.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      stage: true,
      createdAt: true,
      emailSentCount: true,
      archivedAt: true,
      assignedTo: { select: { email: true } },
      campaign: { select: { name: true } },
    },
  });

  const byAddress = new Map<string, typeof leads>();
  for (const lead of leads) {
    const key = lead.email.trim().toLowerCase();
    if (!key) continue;
    byAddress.set(key, [...(byAddress.get(key) ?? []), lead]);
  }

  const groups = [...byAddress.entries()].filter(([, rows]) => rows.length > 1);
  if (groups.length === 0) {
    console.log(`  ${tenantName}: no address is held by more than one lead.`);
    return;
  }

  const ids = groups.flatMap(([, rows]) => rows.map((r) => r.id));
  const [sends, replies, cadences] = await Promise.all([
    prisma.outboundMessage.groupBy({
      by: ['leadId'],
      where: { leadId: { in: ids }, status: 'sent' },
      _count: { _all: true },
    }),
    prisma.outboundMessage.groupBy({
      by: ['leadId'],
      where: { leadId: { in: ids }, repliedAt: { not: null } },
      _count: { _all: true },
    }),
    prisma.sequenceEnrollment.findMany({
      where: { leadId: { in: ids }, status: 'active' },
      select: { leadId: true },
    }),
  ]);
  const sentBy = new Map(sends.map((s) => [s.leadId, s._count._all]));
  const repliedBy = new Map(replies.map((s) => [s.leadId, s._count._all]));
  const running = new Set(cadences.map((c) => c.leadId));

  const enriched = groups.map(([address, rows]) => ({
    address,
    rows: rows
      .map(
        (r): LeadRow => ({
          id: r.id,
          email: r.email,
          firstName: r.firstName,
          lastName: r.lastName,
          company: r.company,
          stage: r.stage,
          createdAt: r.createdAt,
          emailSentCount: r.emailSentCount,
          archivedAt: r.archivedAt,
          owner: r.assignedTo?.email ?? 'unassigned',
          campaign: r.campaign?.name ?? '—',
          sent: sentBy.get(r.id) ?? 0,
          replies: repliedBy.get(r.id) ?? 0,
          activeCadence: running.has(r.id),
        })
      )
      .sort((a, b) => b.replies - a.replies || b.sent - a.sent || +a.createdAt - +b.createdAt),
  }));

  // The groups that have actually cost something come first: a person written to twice.
  const contacted = enriched.filter((g) => g.rows.filter((r) => r.sent > 0).length > 1);
  const shown = (ALL ? enriched : contacted).slice(0, LIMIT);

  console.log(
    `\n  ${tenantName}: ${enriched.length} duplicated address(es), ` +
      `${enriched.reduce((n, g) => n + g.rows.length - 1, 0)} rows beyond the first. ` +
      `${contacted.length} of them have been emailed from more than one lead.`
  );
  if (!ALL && contacted.length === 0) {
    console.log('  None has been double-emailed yet. Pass --all to see every group.');
  }

  for (const group of shown) {
    const doubled = group.rows.filter((r) => r.sent > 0).length > 1;
    console.log(`\n  ${group.address}${doubled ? '   ← emailed from more than one lead' : ''}`);
    for (const r of group.rows) {
      console.log(
        `    ${r.id}  ${r.createdAt.toISOString().slice(0, 10)}  ${r.campaign.padEnd(28).slice(0, 28)}` +
          `  ${r.owner.padEnd(24).slice(0, 24)}  ${r.stage.padEnd(16)}  ${rank(r)}`
      );
    }
  }

  if ((ALL ? enriched.length : contacted.length) > shown.length) {
    console.log(`\n  … ${(ALL ? enriched.length : contacted.length) - shown.length} more (raise --limit).`);
  }
}

async function main() {
  console.log(
    ALL
      ? 'Duplicate leads — every group (read-only).'
      : 'Duplicate leads that have been emailed more than once (read-only). Use --all for every group.'
  );
  await forEachTenant((tenant) => reportTenant(tenant.name));
  console.log('\nNothing was written. Deciding which copy survives is a judgement about a real relationship.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
