import { vi, describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * One queue, one consumer.
 *
 * `healthcheck` and `maintenance` were two separate BullMQ Workers on the *same* `maintenance`
 * queue. Two workers on one queue are competing consumers: BullMQ hands each job to whichever
 * reaches it first, not to the one that knows how to do it. Both then `return`ed early on the
 * other's job name — and an early return is a *successful* completion — so roughly half of every
 * job on that queue was marked done without being performed.
 *
 * The casualty that mattered was `maintenance.repair`. It carries the sweeper that moves stuck
 * `sending` / `reconciliation_required` outbound rows along and raises the only notification a
 * human ever sees for a stalled send. The one mechanism for surfacing a stalled send was itself
 * being discarded, at random, about half the time — and the failure was invisible, because the
 * job's own record said it completed.
 *
 * The visible symptom in the worker log was `ready: maintenance` printed twice while
 * `healthcheck` never appeared: BullMQ names a worker after its queue, so two consumers of one
 * queue are indistinguishable in that line.
 */

const REPO_ROOT = process.cwd();
const WORKERS_DIR = path.join(REPO_ROOT, 'workers');

describe('no two workers consume the same queue', () => {
  it('each queue name is passed to createAppWorker exactly once across workers/', () => {
    const byQueue = new Map<string, string[]>();

    for (const file of readdirSync(WORKERS_DIR).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(path.join(WORKERS_DIR, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

      for (const [, queue] of source.matchAll(/createAppWorker(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g)) {
        byQueue.set(queue, [...(byQueue.get(queue) ?? []), file]);
      }
    }

    // Sanity: if the regex stops matching, every queue silently disappears and this passes
    // while proving nothing.
    expect(byQueue.size, 'no createAppWorker calls found — the scan is broken, not the code')
      .toBeGreaterThan(3);

    const shared = [...byQueue].filter(([, files]) => files.length > 1);
    expect(
      shared.map(([queue, files]) => `${queue} <- ${files.join(', ')}`),
      'Two workers on one queue silently complete each other\'s jobs. Dispatch on job.name inside a single worker instead.'
    ).toEqual([]);
  });
});

const mockRunHealthcheck = vi.fn();
const mockCreateAppWorker = vi.fn();

vi.mock('@/lib/bullmq', () => ({
  createAppWorker: (...args: unknown[]) => {
    mockCreateAppWorker(...args);
    return { name: args[0], on: vi.fn(), close: vi.fn() };
  },
}));

vi.mock('@/workers/healthcheck', () => ({
  runHealthcheck: (...args: unknown[]) => mockRunHealthcheck(...args),
  closeHealthcheck: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    lead: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    outboundMessage: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    jobRun: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    auditLog: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

vi.mock('@/lib/bullmq/enqueue', () => ({ enqueueReschedule: vi.fn() }));

const { createMaintenanceWorker } = await import('@/workers/maintenance');

/** The processor the single maintenance worker was built with. */
function maintenanceProcessor(): (job: unknown) => Promise<unknown> {
  createMaintenanceWorker();
  const call = mockCreateAppWorker.mock.calls.at(-1)!;
  expect(call[0], 'the maintenance worker changed queue').toBe('maintenance');
  return call[1] as (job: unknown) => Promise<unknown>;
}

describe('the maintenance worker performs every job name on its queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the healthcheck rather than silently completing it', async () => {
    const job = { name: 'maintenance.healthcheck', data: { startedAt: new Date().toISOString() } };
    await maintenanceProcessor()(job);
    expect(mockRunHealthcheck).toHaveBeenCalledWith(job);
  });

  it('runs the repair sweep', async () => {
    // A repair with no types does no work but must still reach handleRepair — what is asserted
    // is that the dispatcher routes it, not what the sweep finds.
    const result = await maintenanceProcessor()({ name: 'maintenance.repair', data: { types: [] } });
    expect(result).toEqual({});
    expect(mockRunHealthcheck).not.toHaveBeenCalled();
  });

  it('says so when a job name has no handler, instead of reporting success in silence', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await maintenanceProcessor()({ name: 'maintenance.something-nobody-wrote', data: {} });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('maintenance.something-nobody-wrote'));
    warn.mockRestore();
  });

  it('keeps concurrency at 1 so a repair sweep never overlaps another', () => {
    maintenanceProcessor();
    expect(mockCreateAppWorker.mock.calls.at(-1)![2]).toEqual({ concurrency: 1 });
  });
});
