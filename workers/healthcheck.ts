import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { getConnection } from '@/lib/bullmq/connection';

/**
 * The `maintenance.healthcheck` job body.
 *
 * This used to be its own BullMQ Worker — a second consumer of the `maintenance` queue, running
 * beside the repair worker. Two workers on one queue are competing consumers: BullMQ hands each
 * job to whichever one reaches it first, not to the one that knows how to do it. Both then
 * `return`ed early on the other's job name, and an early return is a *successful* completion, so
 * roughly half of every job on the queue was silently marked done without being performed.
 *
 * The casualty that mattered was `maintenance.repair`, which carries the sweeper that moves stuck
 * `sending`/`reconciliation_required` rows along and raises the notification a human sees. The one
 * mechanism for surfacing a stalled send was itself being eaten, at random, about half the time.
 *
 * So this is now a plain handler, dispatched by the single maintenance worker. The queue name and
 * both job names are unchanged, so nothing that enqueues work has to know, and no job already on
 * the queue is stranded.
 */
export async function runHealthcheck(job: Job): Promise<{ success: true; elapsedMs: number }> {
  const startedAt = job.data.startedAt;
  const redisOk = await getConnection().ping().catch(() => null);

  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const elapsed = Date.now() - new Date(startedAt).getTime();

  await job.updateProgress({
    redis: redisOk === 'PONG' ? 'ok' : 'fail',
    database: dbOk ? 'ok' : 'fail',
    elapsedMs: elapsed,
  });

  console.log(`[worker:healthcheck] redis=${redisOk === 'PONG' ? 'OK' : 'FAIL'} db=${dbOk ? 'OK' : 'FAIL'} ${elapsed}ms`);
  return { success: true, elapsedMs: elapsed };
}

export async function closeHealthcheck(): Promise<void> {
  // Global prisma client connection is managed by standard app lifecycle
}
