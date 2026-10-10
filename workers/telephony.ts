import { createAppWorker } from '@/lib/bullmq';
import { JobType, QUEUES, type TelephonyEventPayload } from '@/lib/bullmq/types';
import { processTelephonyEvent } from '@/lib/telephony/applyEvent';

/**
 * The telephony worker: applies one stored provider event to its call per job.
 *
 * Thin on purpose — the rules (tenant from the `Call` row, forward-only status, one Activity per
 * call) live in `lib/telephony/applyEvent.ts` where they are tested against a database without a
 * broker. An event whose call is not known yet throws, so BullMQ retries it with backoff; the
 * reconcile cron picks up what still has no call after that. An unknown job name throws too, so a
 * job this worker does not understand never completes as if it had run.
 *
 * Concurrency 5, like the email and sequence workers: events are short database writes.
 */
const TELEPHONY_CONCURRENCY = 5;

export function createTelephonyWorker() {
  return createAppWorker(
    QUEUES.TELEPHONY,
    async (job) => {
      if (job.name !== JobType.TELEPHONY_EVENT) throw new Error(`telephony worker received an unknown job: ${job.name}`);
      const { providerEventId } = job.data as TelephonyEventPayload;
      const result = await processTelephonyEvent(providerEventId);
      if (result === 'unmatched') throw new Error(`telephony event ${providerEventId} has no call yet`);
      return { result };
    },
    { concurrency: TELEPHONY_CONCURRENCY }
  );
}
