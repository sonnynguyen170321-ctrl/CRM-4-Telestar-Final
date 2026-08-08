import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { getInboxHealthRows } from '@/lib/email-health/queries';
import { getEmailAccountScope, emailAccountWhere } from '@/lib/email-health/access';
import { domainOf } from '@/lib/email-health/metrics';

export const dynamic = 'force-dynamic';

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * CSV Export for Email Health & Deliverability data (accounts + domain DNS status).
 */
export async function GET(_req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const scope = await getEmailAccountScope(user);

    const [{ rows: accountRows }, domainRecords, accounts] = await Promise.all([
      getInboxHealthRows(user, {}),
      prisma.emailDomainHealth.findMany({ orderBy: { domain: 'asc' } }),
      prisma.emailAccount.findMany({
        where: { ...emailAccountWhere(scope), isActive: true },
        select: { email: true, provider: true },
      }),
    ]);

    const inboxesByDomain = new Map<string, number>();
    for (const a of accounts) {
      const d = domainOf(a.email);
      if (!d) continue;
      inboxesByDomain.set(d, (inboxesByDomain.get(d) ?? 0) + 1);
    }

    const lines: string[] = [];

    // Section 1: Mailbox Accounts Health
    lines.push('=== MAILBOX ACCOUNTS DELIVERABILITY & HEALTH ===');
    lines.push('Email,Owner,Provider,Health Level,Score,7d Sent,Hard Bounce Rate,Soft Bounce Rate,Reply Rate,Daily Cap,Sent Today,Status,Active');

    for (const a of accountRows) {
      const ownerName = a.owner ? `${a.owner.firstName} ${a.owner.lastName}`.trim() : 'Unassigned';
      lines.push([
        escapeCsv(a.email),
        escapeCsv(ownerName),
        escapeCsv(a.provider),
        escapeCsv(a.healthLevel),
        a.healthScore,
        a.sevenDaySent,
        `${(a.hardBounceRate * 100).toFixed(2)}%`,
        `${(a.softBounceRate * 100).toFixed(2)}%`,
        `${(a.replyRate * 100).toFixed(2)}%`,
        a.dailyCap,
        a.sentToday,
        escapeCsv(a.isPaused ? 'Paused' : 'Active'),
        escapeCsv(a.isActive ? 'Yes' : 'No'),
      ].join(','));
    }

    lines.push('');

    // Section 2: Domain DNS & Authentication Posture
    lines.push('=== DOMAIN DNS & AUTHENTICATION POSTURE ===');
    lines.push('Domain,Health Level,SPF,DKIM,DMARC,MX,Active Inboxes,Last Checked');

    for (const d of domainRecords) {
      const inboxCount = inboxesByDomain.get(d.domain) ?? d.activeInboxCount ?? 0;
      lines.push([
        escapeCsv(d.domain),
        escapeCsv(d.healthLevel),
        escapeCsv(d.spfStatus),
        escapeCsv(d.dkimStatus),
        escapeCsv(d.dmarcStatus),
        escapeCsv(d.mxStatus),
        inboxCount,
        escapeCsv(d.lastCheckedAt ? new Date(d.lastCheckedAt).toISOString() : 'Never'),
      ].join(','));
    }

    const csvContent = lines.join('\n');
    const filename = `email-deliverability-health-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return handleApiError('api/email-health/export/csv GET', err);
  }
}
