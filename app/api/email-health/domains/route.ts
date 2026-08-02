import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { forbidden, handleApiError } from '@/lib/api/errors';
import { getEmailAccountScope, emailAccountWhere } from '@/lib/email-health/access';
import { domainOf } from '@/lib/email-health/metrics';

export const dynamic = 'force-dynamic';

/**
 * Domain health table.
 *
 * Rows are unioned from two sources: stored EmailDomainHealth records, and
 * domains derived from the viewer's inboxes that have never been checked. The
 * second half matters — a brand-new sending domain with no DNS setup is exactly
 * the case a manager needs to see, and it has no stored row yet.
 */
export async function GET(_req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const scope = await getEmailAccountScope(user);
    if (!scope.canManage) return forbidden('Domain health is manager-only');

    const [accounts, stored] = await Promise.all([
      prisma.emailAccount.findMany({
        where: { ...emailAccountWhere(scope), isActive: true },
        select: { email: true, provider: true },
      }),
      prisma.emailDomainHealth.findMany({ orderBy: { domain: 'asc' } }),
    ]);

    const inboxesByDomain = new Map<string, { count: number; providers: Set<string> }>();
    for (const a of accounts) {
      const d = domainOf(a.email);
      if (!d) continue;
      const entry = inboxesByDomain.get(d) ?? { count: 0, providers: new Set<string>() };
      entry.count++;
      entry.providers.add(a.provider);
      inboxesByDomain.set(d, entry);
    }

    const storedByDomain = new Map(stored.map((s) => [s.domain, s]));
    const allDomains = new Set<string>([...inboxesByDomain.keys(), ...storedByDomain.keys()]);

    const domains = [...allDomains]
      .filter((d) => inboxesByDomain.has(d) || scope.userIds === null)
      .map((domain) => {
        const row = storedByDomain.get(domain);
        const live = inboxesByDomain.get(domain);
        return {
          domain,
          providerMix: live ? [...live.providers] : [],
          activeInboxCount: live?.count ?? row?.activeInboxCount ?? 0,
          spfStatus: row?.spfStatus ?? 'unknown',
          dkimStatus: row?.dkimStatus ?? 'unknown',
          dmarcStatus: row?.dmarcStatus ?? 'unknown',
          mxStatus: row?.mxStatus ?? 'unknown',
          dnsNotes: row?.dnsNotes ?? null,
          lastCheckedAt: row?.lastCheckedAt ?? null,
          sevenDaySent: row?.sevenDaySent ?? 0,
          sevenDayBounceRate: row?.sevenDayBounceRate ?? 0,
          sevenDayReplyRate: row?.sevenDayReplyRate ?? 0,
          healthLevel: row?.healthLevel ?? 'healthy',
        };
      })
      .sort((a, b) => a.domain.localeCompare(b.domain));

    return NextResponse.json({ domains }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleApiError('api/email-health/domains GET', err);
  }
}
