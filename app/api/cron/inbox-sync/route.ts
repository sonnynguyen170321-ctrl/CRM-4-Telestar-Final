import { NextRequest, NextResponse } from 'next/server';
import { prisma, tenantStorage } from '@/lib/prisma';
import { enqueueEmailSyncWorkflow } from '@/lib/workflows/email';
import { authorizeCronRequest } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';

const ACCOUNTS_PER_RUN = 10;
export async function GET(req: NextRequest) {
  // Constant-time secret check, and a manager session reaches only its own tenant. The
  // platform-wide sweep is the scheduler's alone — see lib/cron/auth.ts.
  const authz = await authorizeCronRequest(req);
  if (!authz) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    // A manager's manual run touches their own tenant's mailboxes only.
    const tenantScope = authz.scope === 'platform' ? {} : { tenantId: authz.tenantId };
    const accounts = await prisma.emailAccount.findMany({
      where: { isActive: true, ...tenantScope },
      orderBy: { lastSyncAt: { sort: 'asc', nulls: 'first' } },
      take: ACCOUNTS_PER_RUN,
    });

    const userIds = [...new Set(accounts.map(a => a.userId))];
    const userTenants = userIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, tenantId: true },
    }) : [];
    const tenantMap = new Map(userTenants.map(u => [u.id, u.tenantId]));

    const enqueued: { accountId: string; accountEmail: string; tenantId: string }[] = [];

    for (const account of accounts) {
      const tenantId = tenantMap.get(account.userId);
      if (!tenantId) continue;

      await enqueueEmailSyncWorkflow(account.id, tenantId);
      enqueued.push({ accountId: account.id, accountEmail: account.email, tenantId });
    }

    return NextResponse.json({ accounts: accounts.length, enqueued: enqueued.length });
  });
}
