import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { badRequest, forbidden, handleApiError } from '@/lib/api/errors';
import { getEmailAccountScope, emailAccountWhere } from '@/lib/email-health/access';
import { checkDomainDns, isPlausibleDomain } from '@/lib/email-health/domains';
import { domainOf } from '@/lib/email-health/metrics';

export const dynamic = 'force-dynamic';

/**
 * Runs live SPF / DMARC / MX lookups for a domain and stores the result.
 *
 * DKIM is untouched: its record lives under a provider-specific selector that
 * cannot be discovered, so it stays whatever a manager set manually.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ domain: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const scope = await getEmailAccountScope(user);
    if (!scope.canManage) return forbidden('Only managers can run DNS checks');

    const { domain: rawDomain } = await params;
    const domain = decodeURIComponent(rawDomain).trim().toLowerCase();

    // Validate before the resolver sees it — this value reaches a network call.
    if (!isPlausibleDomain(domain)) return badRequest('Invalid domain');

    // Only allow checking domains the viewer actually sends from. Without this,
    // the endpoint is an arbitrary outbound DNS probe.
    const accounts = await prisma.emailAccount.findMany({
      where: emailAccountWhere(scope),
      select: { email: true, tenantId: true, provider: true },
    });
    const owned = accounts.filter((a) => domainOf(a.email) === domain);
    if (owned.length === 0) {
      return forbidden('That domain is not used by any inbox in your scope');
    }

    const result = await checkDomainDns(domain);
    const tenantId = owned[0].tenantId;

    const saved = await prisma.emailDomainHealth.upsert({
      where: { tenantId_domain: { tenantId, domain } },
      create: {
        domain,
        tenantId,
        provider: owned[0].provider,
        spfStatus: result.spfStatus,
        dmarcStatus: result.dmarcStatus,
        mxStatus: result.mxStatus,
        dnsNotes: result.notes.join(' · ') || null,
        lastCheckedAt: result.checkedAt,
        activeInboxCount: owned.length,
      },
      update: {
        spfStatus: result.spfStatus,
        dmarcStatus: result.dmarcStatus,
        mxStatus: result.mxStatus,
        dnsNotes: result.notes.join(' · ') || null,
        lastCheckedAt: result.checkedAt,
        activeInboxCount: owned.length,
      },
    });

    return NextResponse.json({ success: true, domain: saved, notes: result.notes });
  } catch (err) {
    return handleApiError('api/email-health/domains/[domain]/check POST', err);
  }
}
