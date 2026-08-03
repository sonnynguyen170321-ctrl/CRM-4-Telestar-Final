import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { isQueueReachable } from '@/lib/bullmq/health';
import { enqueue } from '@/lib/bullmq/enqueue';
import { JobType } from '@/lib/bullmq/types';
import {
  sequenceQueue,
  emailQueue,
  importQueue,
  syncQueue,
  maintenanceQueue,
} from '@/lib/bullmq/queues';

export const dynamic = 'force-dynamic';

export async function GET(_req?: NextRequest) {
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;

  try {
    // 1. Check Redis Ping. isQueueReachable races the ping against a timeout —
    // the shared connection never rejects on its own, so a bare ping would hang
    // this request until the platform's own timeout when Redis is down.
    const redisReachable = await isQueueReachable();
    const redisStatus = redisReachable ? 'ok' : 'fail';

    // 2. Check DB Ping
    let dbStatus = 'fail';
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbStatus = 'ok';
    } catch (err) {
      console.error('[admin/worker-health] DB ping failed:', err);
    }

    // 3. Check Queue Statistics
    const queues = [
      { name: 'sequence', q: sequenceQueue() },
      { name: 'email', q: emailQueue() },
      { name: 'import', q: importQueue() },
      { name: 'sync', q: syncQueue() },
      { name: 'maintenance', q: maintenanceQueue() },
    ];

    // getJobCounts() hangs rather than throwing when Redis is unreachable, so it
    // is only safe to call once the ping above has confirmed a live connection.
    const queueStats = redisReachable
      ? await Promise.all(
          queues.map(async (item) => {
            try {
              const counts = await item.q.getJobCounts();
              return { name: item.name, counts };
            } catch {
              return { name: item.name, counts: null, error: 'Failed to fetch counts' };
            }
          })
        )
      : queues.map((item) => ({ name: item.name, counts: null, error: 'Redis unreachable' }));

    // 4. Retrieve latest healthcheck job run from database
    const latestHealthcheck = await prisma.jobRun.findFirst({
      where: {
        jobName: JobType.MAINTENANCE_HEALTHCHECK,
      },
      orderBy: {
        enqueuedAt: 'desc',
      },
    });

    return NextResponse.json({
      redis: redisStatus,
      database: dbStatus,
      queues: queueStats,
      latestHealthcheck,
    });
  } catch (err: any) {
    console.error('[admin/worker-health GET] Error checking health:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(_req: NextRequest) {
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    // enqueue() writes a JobRun row and then blocks forever if Redis is down,
    // leaving a permanently-queued job behind. Fail fast instead.
    if (!(await isQueueReachable())) {
      return NextResponse.json(
        { error: 'Job queue is offline — cannot trigger a health check' },
        { status: 503 }
      );
    }

    const jobId = await enqueue(
      JobType.MAINTENANCE_HEALTHCHECK,
      { startedAt: new Date().toISOString() },
      { tenantId: user.tenantId }
    );

    return NextResponse.json({ success: true, jobId });
  } catch (err: any) {
    console.error('[admin/worker-health POST] Error triggering health check:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
