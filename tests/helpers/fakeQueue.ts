/** An in-memory stand-in for the BullMQ queue: records adds, serves getJob, removes on request. */
function createFakeQueue() {
  const jobs = new Map<string, { id: string; name: string; data: unknown; opts: { delay?: number; jobId: string }; state: string }>();
  const removed: string[] = [];
  const queue = {
    jobs,
    removed,
    async add(name: string, data: unknown, opts: { delay?: number; jobId: string }) {
      jobs.set(opts.jobId, { id: opts.jobId, name, data, opts, state: opts.delay ? 'delayed' : 'waiting' });
      return { id: opts.jobId };
    },
    async getJob(id: string) {
      const job = jobs.get(id);
      if (!job) return undefined;
      return {
        id,
        async getState() {
          return job.state;
        },
        async remove() {
          jobs.delete(id);
          removed.push(id);
        },
        async changeDelay(delay: number) {
          job.opts.delay = delay;
        },
      };
    },
  };
  return queue;
}

/**
 * One shared instance. `vi.mock('@/lib/bullmq/queues')` factories hand this out and the test reads
 * it back, which works because both resolve the same module.
 */
export const fakeQueue = createFakeQueue();

export function resetFakeQueue(): void {
  fakeQueue.jobs.clear();
  fakeQueue.removed.length = 0;
}

/** The mock the BullMQ queue module is replaced with. */
export function fakeQueues() {
  return {
    sequenceQueue: () => fakeQueue,
    emailQueue: () => fakeQueue,
    importQueue: () => fakeQueue,
    syncQueue: () => fakeQueue,
    maintenanceQueue: () => fakeQueue,
    agentQueue: () => fakeQueue,
    researchQueue: () => fakeQueue,
    telephonyQueue: () => fakeQueue,
  };
}
