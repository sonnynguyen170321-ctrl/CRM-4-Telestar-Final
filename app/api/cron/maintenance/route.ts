import { NextRequest, NextResponse } from 'next/server';
import { prisma, tenantStorage } from '@/lib/prisma';
import { auth } from '@/auth';
import { enqueue } from '@/lib/bullmq/enqueue';
import { JobType } from '@/lib/bullmq/types';
import type { MaintenanceRepairPayload } from '@/lib/bullmq/types';

export const dynamic = 'force-dynamic';

const MANAGER_ROLES = ['director', 'floor_manager'];

/**
 * Scheduled maintenance sweep.
 *
 * `JobType.MAINTENANCE_REPAIR` and the repair registry in `workers/maintenance.ts`
 * both predate this route — but nothing ever enqueued the job, so the repairs only
 * ever ran if someone triggered them by hand. This is the scheduler entry point.
 *
 * Auth mirrors `app/api/cron/email-health`: a `CRON_SECRET` bearer for the host
 * scheduler, falling back to a manager session so it can be run by hand. Director
 * and Floor Manager only — the repairs mutate tasks and delete audit rows.
 *
 * Runtime law: this route records intent and returns. The worker executes it.
 */
const DEFAULT_TYPES: MaintenanceRepairPayload['types'] = [
  'orphan-tasks',
  'stale-sending',
  'stuck-running',
  'missing-delayed',
  'reassignment-drift',
  'audit-prune',
];

const KNOWN_TYPES = new Set<string>(DEFAULT_TYPES);

export async function GET(req: NextRequest) {
  const isCronSecret =
    process.env.CRON_SECRET &&
    req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  const session = isCronSecret ? null : await auth();
  const isManager = session?.user && MANAGER_ROLES.includes((session.user as any)?.role ?? '');
  if (!isCronSecret && !isManager) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // `?types=audit-prune,orphan-tasks` narrows the sweep; unknown names are rejected
  // rather than silently dropped, so a typo in a crontab is visible.
  const raw = req.nextUrl.searchParams.get('types');
  let types = DEFAULT_TYPES;
  if (raw) {
    const requested = raw.split(',').map((t) => t.trim()).filter(Boolean);
    const unknown = requested.filter((t) => !KNOWN_TYPES.has(t));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Unknown repair type(s): ${unknown.join(', ')}` },
        { status: 400 }
      );
    }
    types = requested as MaintenanceRepairPayload['types'];
  }

  try {
    // Discover tenants under a bypass, then enqueue one job each so the worker runs
    // every repair inside a single tenant's context.
    const tenantIds = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
      const rows = await prisma.tenant.findMany({ select: { id: true } });
      return rows.map((r) => r.id);
    });

    const enqueued: string[] = [];
    const failed: string[] = [];

    for (const tenantId of tenantIds) {
      try {
        await enqueue(JobType.MAINTENANCE_REPAIR, { types }, { tenantId });
        enqueued.push(tenantId);
      } catch (tenantErr) {
        // One bad tenant must not abort the sweep for the rest.
        console.error(`[cron/maintenance] tenant ${tenantId} enqueue failed:`, tenantErr);
        failed.push(tenantId);
      }
    }

    return NextResponse.json({ tenants: tenantIds.length, enqueued: enqueued.length, failed, types });
  } catch (err) {
    console.error('[cron/maintenance] sweep failed:', err);
    return NextResponse.json({ error: 'Maintenance sweep failed' }, { status: 500 });
  }
}
