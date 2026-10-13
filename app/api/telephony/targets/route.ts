import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';

import { getLeadWhereScope, requireAuth, requireInteractiveUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { findAccentInsensitiveIds, LEAD_SEARCH_COLUMNS } from '@/lib/search/accentSearch';
import { consumeAttempt } from '@/lib/security/attemptLimit';
import { parseTargetQuery, TARGET_RESULT_LIMIT, toDialTargets } from '@/lib/telephony/dialerTargets';
import { isTelephonyEnabled } from '@/lib/telephony/flags';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const RATE = { limit: 90, windowSeconds: 60 };

/**
 * Who the docked dialer may call (docs/dialer/ADR-001-park-and-authorize.md): leads the signed-in rep
 * can work, found by name, company or phone, with the lead's linked contact as a second target. The
 * tenant and the role scope come from the session, never from the request; the number returned is the
 * record's own and the call itself is still authorized by `POST /api/telephony/calls`. Nothing here
 * accepts a free number, and a lead the rep may not see is simply not in the results.
 */
export async function GET(req: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  const keyRefusal = requireInteractiveUser(user);
  if (keyRefusal) return keyRefusal;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403, headers: NO_STORE });
  const tenantId = user.tenantId;
  if (!isTelephonyEnabled(tenantId)) {
    return NextResponse.json({ error: 'The dialer is not enabled', code: 'dialer_disabled' }, { status: 403, headers: NO_STORE });
  }

  const query = parseTargetQuery(new URL(req.url).searchParams.get('q'));
  if (!query) return NextResponse.json({ targets: [] }, { headers: NO_STORE });

  const decision = await consumeAttempt({ bucket: 'telephony-targets', subject: user.id, ...RATE });
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'Too many searches. Wait a moment.', code: 'rate_limited' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(decision.retryAfterSeconds) } }
    );
  }

  const roleScope = (await getLeadWhereScope(user)) as Prisma.LeadWhereInput;
  const searchIds = await findAccentInsensitiveIds('Lead', LEAD_SEARCH_COLUMNS, query.text, tenantId);
  const phoneClauses: Prisma.LeadWhereInput[] = query.phoneNeedles.flatMap((digits) => [
    { normalizedPhone: { contains: digits } },
    { contact: { is: { normalizedPhone: { contains: digits } } } },
  ]);
  const match: Prisma.LeadWhereInput[] = [...(searchIds && searchIds.length > 0 ? [{ id: { in: searchIds } }] : []), ...phoneClauses];
  if (match.length === 0) return NextResponse.json({ targets: [] }, { headers: NO_STORE });

  const rows = await prisma.lead.findMany({
    // The role scope is ANDed on top of the tenant and the search, so nothing in the query can widen it.
    where: { AND: [{ tenantId, archivedAt: null }, roleScope, { OR: match }] },
    orderBy: { updatedAt: 'desc' },
    take: TARGET_RESULT_LIMIT,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      phone: true,
      doNotCall: true,
      doNotCallReason: true,
      contactId: true,
      contact: { select: { id: true, fullName: true, phone: true, country: true, doNotCall: true } },
      account: { select: { country: true } },
    },
  });

  // Suppression is looked up for the numbers on screen only (the gate re-checks it before any call).
  const draft = toDialTargets(rows, new Set());
  const numbers = [...new Set(draft.map((t) => t.phone).filter((p): p is string => Boolean(p)))];
  const suppressed = numbers.length
    ? await prisma.phoneSuppression.findMany({ where: { tenantId, e164: { in: numbers } }, select: { e164: true } })
    : [];
  const targets = toDialTargets(rows, new Set(suppressed.map((s) => s.e164)));

  return NextResponse.json({ targets }, { headers: NO_STORE });
}
