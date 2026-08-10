import type { JobsOptions } from 'bullmq';
import { JobType } from './types';

// Outbound idempotency keys now live in `lib/email/idempotency.ts`. The old
// sha256(leadId:accountId:subject) helper that used to sit here was removed because a
// subject is re-rendered per attempt: it both false-deduped distinct sends and missed
// real duplicates.

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: {
    age: 86400 * 3,
    count: 500,
  },
  removeOnFail: {
    age: 86400 * 7,
    count: 100,
  },
};

export const JOB_OPTIONS: Partial<Record<JobType, JobsOptions>> = {
  [JobType.EMAIL_SEND]: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400 * 7, count: 1000 },
    removeOnFail: { age: 86400 * 14, count: 500 },
  },
  [JobType.SEQUENCE_ENROLL]: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 3000 },
  },
  [JobType.SEQUENCE_ADVANCE]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
  [JobType.SEQUENCE_EXECUTE_TASK]: {
    // Safe to retry: the handler re-checks task status and CAS-locks before sending.
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
  [JobType.IMPORT_PARSE]: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
  },
  [JobType.IMPORT_CHUNK]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
  [JobType.MAINTENANCE_HEALTHCHECK]: {
    attempts: 1,
    removeOnComplete: { age: 86400, count: 50 },
    removeOnFail: { age: 86400 * 3, count: 50 },
  },
  [JobType.MAINTENANCE_REPAIR]: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 10000 },
  },
  [JobType.EMAIL_SYNC]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
  [JobType.EMAIL_APPLY_REPLY]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
  },
  [JobType.EMAIL_APPLY_BOUNCE]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
  },
  [JobType.IMPORT_COMMIT]: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 5000 },
  },
  [JobType.REMINDER_DUE]: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
  },
  [JobType.DIGEST_DAILY]: {
    attempts: 1,
    removeOnComplete: { age: 86400, count: 100 },
    removeOnFail: { age: 86400 * 3, count: 50 },
  },
  [JobType.AGENT_EXECUTE_WORK_ORDER]: {
    // Safe to retry: every CRM mutation goes through `executeAgentAction`, whose `actionKey` is
    // derived from the work order and a stable ordinal, so a replayed attempt finds the
    // completed `AgentAction` and returns its recorded result instead of acting again.
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400 * 3, count: 500 },
    removeOnFail: { age: 86400 * 7, count: 200 },
  },
};
