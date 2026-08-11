export const QUEUES = {
  SEQUENCE: 'sequence',
  EMAIL: 'email',
  IMPORT: 'import',
  SYNC: 'sync',
  MAINTENANCE: 'maintenance',
  /** Agent work (Revenue AI Phase 6b). Priorities are SLA-derived — see lib/agent/priorities.ts. */
  AGENT: 'agent',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export enum JobType {
  SEQUENCE_ENROLL = 'sequence.enroll',
  SEQUENCE_ADVANCE = 'sequence.advance',
  SEQUENCE_PAUSE = 'sequence.pause',
  SEQUENCE_UNENROLL = 'sequence.unenroll',
  SEQUENCE_REBUILD = 'sequence.rebuild',
  SEQUENCE_EXECUTE_TASK = 'sequence.execute-task',
  EMAIL_SEND = 'email.send',
  EMAIL_SYNC = 'email.sync',
  EMAIL_APPLY_REPLY = 'email.apply-reply',
  EMAIL_APPLY_BOUNCE = 'email.apply-bounce',
  IMPORT_PARSE = 'import.parse',
  IMPORT_CHUNK = 'import.chunk',
  IMPORT_COMMIT = 'import.commit',
  REMINDER_DUE = 'reminder.due',
  DIGEST_DAILY = 'digest.daily',
  MAINTENANCE_HEALTHCHECK = 'maintenance.healthcheck',
  MAINTENANCE_REPAIR = 'maintenance.repair',
  AGENT_EXECUTE_WORK_ORDER = 'agent.execute-work-order',
}

export interface SequenceEnrollPayload {
  leadId: string;
  sequenceId: string;
  userId: string;
}

export interface SequenceAdvancePayload {
  leadId: string;
  sequenceId: string;
  currentStep: number;
}

export interface SequencePausePayload {
  leadId: string;
  /**
   * The enrollment occurrence to pause (Phase 8a). Optional only for jobs queued before this
   * existed; the worker refuses those rather than pausing whichever cadence is current, because
   * by the time an old pause job runs the enrollment may have been replaced.
   */
  enrollmentId?: string;
  sequenceId?: string;
  /**
   * A `PausedReason` from `@/lib/automation/types`. Typed as `string` because jobs queued
   * before the vocabularies were collapsed still carry `replied` / `bounced`; `pauseSequence`
   * normalizes at the write site rather than rejecting them.
   */
  reason: string;
  userId: string;
}

export interface SequenceUnenrollPayload {
  leadId: string;
  sequenceId: string;
}

export interface SequenceRebuildPayload {
  sequenceId: string;
}

/** Delayed execution of an automated sequence email task at its due date. */
export interface SequenceExecuteTaskPayload {
  taskId: string;
  /**
   * The enrollment occurrence this job was scheduled for (Phase 8a).
   *
   * Optional for compatibility: jobs enqueued before this existed carry no id and keep the
   * legacy lead+sequence matching. When present the worker requires *that* enrollment to still
   * be the active occupying one, so a task from an ended cadence can never execute under the
   * enrollment that replaced it.
   */
  expectedEnrollmentId?: string;
}

export interface EmailSendPayload {
  outboundMessageId: string;
  accountId: string;
  to: string;
  subject: string;
  body: string;
  leadId?: string;
  templateId?: string;
}

export interface EmailSyncPayload {
  accountId: string;
}

export interface EmailApplyReplyPayload {
  providerMessageId: string;
  leadId: string;
  accountId: string;
}

export interface EmailApplyBouncePayload {
  providerMessageId: string;
  leadId: string;
  accountId: string;
  bounceType: 'hard' | 'soft';
}

export type ImportResolution = 'skip' | 'update' | 'import';
export type ImportEmailQualityMode = 'recommended' | 'strict' | 'aggressive';
export type ImportTargetType = 'lead' | 'pool';

export interface ImportParsePayload {
  batchId: string;
  assignedToId: string;
  /** Required when `targetType` is `'lead'`; omitted for pool (internal database) imports. */
  campaignId?: string;
  tenantId: string;
  userId: string;
  targetType?: ImportTargetType;
  initialStage?: string;
  sequenceId?: string;
  defaultResolution?: ImportResolution;
  resolutions?: Record<string, ImportResolution>;
  emailQualityMode?: ImportEmailQualityMode;
  filename?: string;
}

export interface ImportChunkPayload {
  batchId: string;
  chunkIndex: number;
  rowIds: string[];
  rows: Record<string, unknown>[];
  assignedToId: string;
  userId: string;
  campaignId?: string;
  tenantId: string;
  targetType?: ImportTargetType;
  initialStage: string;
  sequenceId?: string;
}

export interface ImportCommitPayload {
  batchId: string;
}

export interface ReminderDuePayload {
  reminderId: string;
  leadId?: string;
}

export interface DigestDailyPayload {
  userIds?: string[];
}

export interface MaintenanceHealthcheckPayload {
  startedAt: string;
}

export interface MaintenanceRepairPayload {
  types: (
    | 'orphan-tasks'
    | 'stale-sending'
    | 'outbound-reconcile'
    | 'stuck-running'
    | 'missing-delayed'
    | 'reassignment-drift'
    | 'enrollment-schedule-drift'
    | 'stale-pending-outbound'
    | 'audit-prune'
  )[];
}

/**
 * Execute one typed work order (Revenue AI Phase 6b).
 *
 * Carries no capability, no lead and no playbook version: all three are read from the
 * `WorkOrder` row at execution time. A payload that carried them would let a job queued before
 * a policy change execute under the policy that existed when it was enqueued — the queue is a
 * transport, and the database is the truth it transports a pointer to.
 */
export interface AgentExecuteWorkOrderPayload {
  workOrderId: string;
  /** Whose authority the agent acts under. `AgentAction.userId` is a non-null FK. */
  actorUserId: string;
  /** The lease token this execution holds, when the order is lead-scoped and exclusive. */
  claimToken?: string;
}

export type JobPayload = {
  [JobType.SEQUENCE_ENROLL]: SequenceEnrollPayload;
  [JobType.SEQUENCE_ADVANCE]: SequenceAdvancePayload;
  [JobType.SEQUENCE_PAUSE]: SequencePausePayload;
  [JobType.SEQUENCE_UNENROLL]: SequenceUnenrollPayload;
  [JobType.SEQUENCE_REBUILD]: SequenceRebuildPayload;
  [JobType.SEQUENCE_EXECUTE_TASK]: SequenceExecuteTaskPayload;
  [JobType.EMAIL_SEND]: EmailSendPayload;
  [JobType.EMAIL_SYNC]: EmailSyncPayload;
  [JobType.EMAIL_APPLY_REPLY]: EmailApplyReplyPayload;
  [JobType.EMAIL_APPLY_BOUNCE]: EmailApplyBouncePayload;
  [JobType.IMPORT_PARSE]: ImportParsePayload;
  [JobType.IMPORT_CHUNK]: ImportChunkPayload;
  [JobType.IMPORT_COMMIT]: ImportCommitPayload;
  [JobType.REMINDER_DUE]: ReminderDuePayload;
  [JobType.DIGEST_DAILY]: DigestDailyPayload;
  [JobType.MAINTENANCE_HEALTHCHECK]: MaintenanceHealthcheckPayload;
  [JobType.MAINTENANCE_REPAIR]: MaintenanceRepairPayload;
  [JobType.AGENT_EXECUTE_WORK_ORDER]: AgentExecuteWorkOrderPayload;
};

export function jobQueue(jobType: JobType): QueueName {
  if (jobType.startsWith('agent.')) return QUEUES.AGENT;
  if (jobType.startsWith('sequence.')) return QUEUES.SEQUENCE;
  if (jobType === JobType.EMAIL_SEND) return QUEUES.EMAIL;
  if (jobType.startsWith('email.')) return QUEUES.SYNC;
  if (jobType.startsWith('import.')) return QUEUES.IMPORT;
  if (jobType.startsWith('reminder.') || jobType.startsWith('digest.')) return QUEUES.SYNC;
  if (jobType.startsWith('maintenance.')) return QUEUES.MAINTENANCE;
  return QUEUES.MAINTENANCE;
}
