/**
 * Prove a worker is actually consuming — enqueue one maintenance healthcheck and wait for its
 * `JobRun` to reach `completed`.
 *
 *     npm run worker:healthcheck
 *     CUTOVER_TENANT_ID=<id> npm run worker:healthcheck
 *
 * Replaces an inline `tsx -e "…"` npm script that could not work. It failed two ways: the inline
 * form died at `MODULE_NOT_FOUND` before running anything, and had it loaded, `enqueue` would have
 * thrown `requires a tenantId` because the call passed no options. So the documented Phase 7
 * verification had never once succeeded, and "queue is healthy" had never been demonstrated by it.
 *
 * A Redis `PING` is not this check. Ping proves Redis answers; it says nothing about whether a
 * worker is attached and draining, which is the failure that silently strands every sequence,
 * import and email job while every dashboard stays green.
 *
 * Exported so `scripts/cutover-preflight.ts` runs the identical path rather than a second copy of
 * it — one healthcheck, two callers.
 */
import { PrismaClient } from '@prisma/client';

export const DEFAULT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

export interface HealthcheckResult {
  /** null when the job could not be enqueued at all — distinct from enqueued-but-never-finished. */
  completed: boolean | null;
  detail: string;
  bullJobId?: string;
}

/**
 * Resolve the tenant to enqueue for.
 *
 * `enqueue` refuses an unknown tenant by design — queueing work into no tenant is how a job ends
 * up invisible to every scoped reader. Prefer an explicit id; otherwise use the only tenant when
 * there is exactly one, and refuse to guess when there are several.
 */
export async function resolveTenantId(
  prisma: Pick<PrismaClient, 'tenant'>,
  explicit: string | undefined
): Promise<{ tenantId: string } | { error: string }> {
  if (explicit) return { tenantId: explicit };

  const tenants = await prisma.tenant.findMany({ select: { id: true }, take: 2 });
  if (tenants.length === 0) return { error: 'no tenants exist in this database' };
  if (tenants.length > 1) {
    return { error: 'more than one tenant exists — pass CUTOVER_TENANT_ID to say which one' };
  }
  return { tenantId: tenants[0].id };
}

export async function runWorkerHealthcheck(options: {
  prisma: PrismaClient;
  tenantId?: string;
  timeoutMs?: number;
}): Promise<HealthcheckResult> {
  const { prisma, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const resolved = await resolveTenantId(prisma, options.tenantId);
  if ('error' in resolved) {
    return { completed: null, detail: `cannot enqueue: ${resolved.error}` };
  }

  let bullJobId: string;
  try {
    const { enqueue, JobType } = await import('../lib/bullmq');
    bullJobId = await enqueue(
      JobType.MAINTENANCE_HEALTHCHECK,
      { startedAt: new Date().toISOString() },
      { tenantId: resolved.tenantId }
    );
  } catch (err) {
    return {
      completed: null,
      detail: `enqueue failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // `bullJobId` is the queue's id and `enqueuedAt` is this model's clock — JobRun has no
    // `jobId` and no `createdAt`.
    const run = await prisma.jobRun.findFirst({
      where: { bullJobId },
      select: { status: true, failedReason: true },
      orderBy: { enqueuedAt: 'desc' },
    });
    if (run?.status === 'completed') {
      return { completed: true, detail: `job ${bullJobId} completed`, bullJobId };
    }
    if (run?.status === 'failed') {
      return { completed: false, detail: `job ${bullJobId} failed: ${run.failedReason ?? 'no reason recorded'}`, bullJobId };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  return {
    completed: false,
    detail: `job ${bullJobId} did not reach completed within ${timeoutMs / 1000}s — is a worker running?`,
    bullJobId,
  };
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await runWorkerHealthcheck({ prisma, tenantId: process.env.CUTOVER_TENANT_ID });
    console.log(result.detail);
    if (result.completed !== true) process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && process.argv[1].includes('worker-healthcheck')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : 'worker healthcheck failed');
    process.exit(1);
  });
}
