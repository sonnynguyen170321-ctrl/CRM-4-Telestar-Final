import { NextRequest, NextResponse } from 'next/server';
import { prisma, tenantStorage } from '@/lib/prisma';
import { auth } from '@/auth';
import { runHealthPassForTenant } from '@/lib/email-health/snapshots';

export const dynamic = 'force-dynamic';

const MANAGER_ROLES = ['director', 'floor_manager', 'team_lead'];

/**
 * Hourly deliverability pass.
 *
 * Auth mirrors app/api/cron/inbox-sync: a CRON_SECRET bearer for the scheduler,
 * falling back to a manager session so the run can be triggered by hand from the
 * UI. There is no vercel.json in this repo — see docs/DEPLOY.md for the crontab.
 */
export async function GET(req: NextRequest) {
  const isCronSecret =
    process.env.CRON_SECRET &&
    req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  const session = isCronSecret ? null : await auth();
  const isManager = session?.user && MANAGER_ROLES.includes((session.user as any)?.role ?? '');
  if (!isCronSecret && !isManager) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = new Date();

  try {
    // Discover tenants under a bypass, then re-enter per tenant so every write is
    // stamped and scoped by the Prisma tenant extension.
    const tenantIds = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
      const rows = await prisma.emailAccount.findMany({
        where: { isActive: true },
        select: { tenantId: true },
        distinct: ['tenantId'],
      });
      return rows.map((r) => r.tenantId);
    });

    const totals = {
      accountsScored: 0,
      snapshotsWritten: 0,
      alertsCreated: 0,
      alertsEscalated: 0,
      alertsResolved: 0,
      domainsUpdated: 0,
    };
    const failedTenants: string[] = [];

    for (const tenantId of tenantIds) {
      try {
        const result = await tenantStorage.run({ tenantId }, () =>
          runHealthPassForTenant(tenantId, startedAt)
        );
        totals.accountsScored += result.accountsScored;
        totals.snapshotsWritten += result.snapshotsWritten;
        totals.alertsCreated += result.alertsCreated;
        totals.alertsEscalated += result.alertsEscalated;
        totals.alertsResolved += result.alertsResolved;
        totals.domainsUpdated += result.domainsUpdated;
      } catch (tenantErr) {
        // One bad tenant must not abort the pass for the rest.
        console.error(`[cron/email-health] tenant ${tenantId} failed:`, tenantErr);
        failedTenants.push(tenantId);
      }
    }

    return NextResponse.json({
      tenants: tenantIds.length,
      ...totals,
      failedTenants,
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (err) {
    console.error('[cron/email-health] pass failed:', err);
    return NextResponse.json({ error: 'Email health pass failed' }, { status: 500 });
  }
}
