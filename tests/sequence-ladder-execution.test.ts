import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * The three-step ladder, executed (Plan 1 §A2).
 *
 * `tests/sequence-ladder.test.ts` proves the *schedule* is right. This one runs the worker
 * against an in-memory store and proves the **durable state** the schedule is written into:
 * after step 1 sends, the enrollment is on step 2, step 2's task carries the exact timestamp the
 * scheduler produced, `nextActionAt` agrees with it, and step 3 has no row at all until step 2
 * completes. Assertions are on stored values, not on call order — a cadence that advances in
 * memory but persists the wrong instant is the failure this is for.
 *
 * The store is deliberately small and explicit rather than a Prisma mock library: every query the
 * spine issues is visible here, so a new database read in the send path shows up as a test
 * failure instead of silently returning `undefined`.
 */

type Row = Record<string, any>;

const store = {
  leads: new Map<string, Row>(),
  sequences: new Map<string, Row>(),
  steps: [] as Row[],
  tasks: new Map<string, Row>(),
  enrollments: new Map<string, Row>(),
  accounts: [] as Row[],
  activities: [] as Row[],
  notifications: [] as Row[],
  outbound: [] as Row[],
  sendJobs: [] as Row[],
  executeJobs: [] as Row[],
  /** Set by an interruption test to simulate a suppression entry landing after scheduling. */
  suppression: null as Row | null,
  /** Fail the next N email enqueues — the Redis-side half of the durable/transport seam. */
  failEmailEnqueues: 0,
  /** Throw on the next N task completions — a crash after the send was already handed off. */
  failTaskCompletions: 0,
  /** Approved per-occurrence copy, as the design/approval path would have written it. */
  approvedCopy: [] as Row[],
};

/** Does `row` satisfy every scalar constraint in `where`? Nested objects are not used by the spine. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return (value.in as unknown[]).includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
      if ('lt' in value) return row[key] < value.lt;
      return true;
    }
    if (value instanceof Date) return row[key]?.getTime?.() === value.getTime();
    return row[key] === value;
  });
}

function applyData(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      row[key] = (row[key] ?? 0) + (value as { increment: number }).increment;
    } else {
      row[key] = value;
    }
  }
}

function collection(map: Map<string, Row>, defaults: Row = {}) {
  return {
    findUnique: async ({ where }: Row) => map.get(where.id) ?? null,
    findUniqueOrThrow: async ({ where }: Row) => {
      const row = map.get(where.id);
      if (!row) throw new Error(`not found: ${where.id}`);
      return row;
    },
    findFirst: async ({ where }: Row = {}) =>
      [...map.values()].find((row) => matches(row, where)) ?? null,
    findMany: async ({ where }: Row = {}) => [...map.values()].filter((row) => matches(row, where)),
    create: async ({ data }: Row) => {
      const id = data.id ?? `gen-${map.size + 1}`;
      if (data.id && map.has(data.id)) {
        const err = new Error('unique constraint') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      // Schema defaults the real database would apply — a task created without an explicit
      // status is `pending`, and the send path branches on exactly that.
      const row = { ...defaults, ...data, id };
      map.set(id, row);
      return row;
    },
    update: async ({ where, data }: Row) => {
      const row = map.get(where.id);
      if (!row) throw new Error(`not found: ${where.id}`);
      applyData(row, data);
      return row;
    },
    updateMany: async ({ where, data }: Row) => {
      const hits = [...map.values()].filter((row) => matches(row, where));
      hits.forEach((row) => applyData(row, data));
      return { count: hits.length };
    },
  };
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    get lead() {
      return collection(store.leads);
    },
    get sequence() {
      return {
        ...collection(store.sequences),
        findUnique: async ({ where }: Row) => {
          const row = store.sequences.get(where.id);
          if (!row) return null;
          return { ...row, steps: store.steps.filter((s) => s.sequenceId === where.id) };
        },
      };
    },
    get task() {
      const base = collection(store.tasks, {
        status: 'pending',
        lockedAt: null,
        completedAt: null,
        tenantId: TENANT_ID,
      });
      return {
        ...base,
        update: async (args: Row) => {
          // The completion write is the one that turns "handed to the email pipeline" into
          // "this step is done". Failing exactly here reproduces a worker dying in that window.
          if (store.failTaskCompletions > 0 && args.data?.status === 'completed') {
            store.failTaskCompletions -= 1;
            throw new Error('connection terminated unexpectedly');
          }
          return base.update(args);
        },
      };
    },
    get sequenceEnrollment() {
      return collection(store.enrollments);
    },
    sequenceStep: {
      findFirst: async ({ where }: Row) => {
        const step = store.steps.find((s) => matches(s, where));
        return step ?? null;
      },
    },
    emailAccount: {
      findFirst: async ({ where }: Row) => store.accounts.find((a) => matches(a, where)) ?? null,
    },
    suppressionEntry: { findFirst: async () => store.suppression },
    sequenceStepCopy: {
      findUnique: async ({ where }: Row) => {
        const key = where.enrollmentId_stepOrder;
        return (
          store.approvedCopy.find(
            (c) => c.enrollmentId === key.enrollmentId && c.stepOrder === key.stepOrder
          ) ?? null
        );
      },
    },
    activity: {
      create: async ({ data }: Row) => {
        store.activities.push(data);
        return data;
      },
    },
    notification: {
      create: async ({ data }: Row) => {
        store.notifications.push(data);
        return data;
      },
    },
    abTestVariant: { update: async ({ data }: Row) => data },
    jobRun: { upsert: async () => ({}) },
  },
}));

const enqueueSpy = vi.fn(async (type: string, payload: Row, opts: Row) => {
  store.executeJobs.push({ type, payload, ...opts });
  return 'job-id';
});

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: (type: string, payload: Row, opts: Row) => enqueueSpy(type, payload, opts),
  enqueueImmediate: (type: string, payload: Row, opts: Row) => enqueueSpy(type, payload, opts),
  enqueueReschedule: (type: string, payload: Row, opts: Row) => enqueueSpy(type, payload, opts),
  ensureJob: (type: string, payload: Row, opts: Row) => enqueueSpy(type, payload, opts),
}));

vi.mock('@/lib/workflows/email', () => ({
  createOutboundMessage: async (params: Row) => {
    const existing = store.outbound.find((o) => o.taskId === params.source.taskId);
    if (existing) return existing;
    const row = { id: `out-${store.outbound.length + 1}`, taskId: params.source.taskId, ...params };
    store.outbound.push(row);
    return row;
  },
  enqueueEmailSendWorkflow: async (payload: Row) => {
    if (store.failEmailEnqueues > 0) {
      store.failEmailEnqueues -= 1;
      throw new Error('ECONNREFUSED: redis unavailable');
    }
    store.sendJobs.push(payload);
    return 'email-job';
  },
}));

vi.mock('@/lib/templates/render', () => ({
  renderTemplate: (text: string) => text,
}));

const { handleExecuteTask } = await import('@/workers/sequence');
const { enrollmentStepTaskId } = await import('@/lib/sequences/identity');
const { computeStepDueDate } = await import('@/lib/sequences/engine');
const { buildJitterSeed } = await import('@/lib/automation/jitter');

const TENANT_ID = 'tenant-exec';
const LEAD_ID = 'lead-exec';
const SEQUENCE_ID = 'seq-exec';
const ENROLLMENT_ID = 'enr-exec';
const USER_ID = 'user-exec';
const TZ = 'Asia/Ho_Chi_Minh';

function stepFixture(order: number, over: Row = {}): Row {
  return {
    id: `step-${order}`,
    sequenceId: SEQUENCE_ID,
    order,
    channel: 'email',
    autoComplete: true,
    instructions: null,
    templateId: `tmpl-${order}`,
    template: { id: `tmpl-${order}`, subject: `Subject ${order}`, body: `Body ${order}`, abVariants: [] },
    delayDays: 0,
    delayHours: 0,
    sendWindowStartMinutes: null,
    sendWindowEndMinutes: null,
    ...over,
  };
}

/** The scheduler's own answer for a step — what the stored due date must equal. */
function expectedDue(step: Row, baseAt: Date): Date {
  return computeStepDueDate(baseAt, step as never, {
    timezone: TZ,
    seed: buildJitterSeed({
      tenantId: TENANT_ID,
      sequenceId: SEQUENCE_ID,
      sequenceStepId: step.id,
      leadId: LEAD_ID,
    }),
  });
}

function seedLadder(): void {
  store.leads.clear();
  store.sequences.clear();
  store.tasks.clear();
  store.enrollments.clear();
  store.steps = [stepFixture(1), stepFixture(2, { delayDays: 3 }), stepFixture(3, { delayDays: 4 })];
  store.accounts = [{ id: 'acct-1', userId: USER_ID, isActive: true, email: 'sdr@telestar.vn' }];
  store.activities = [];
  store.notifications = [];
  store.outbound = [];
  store.sendJobs = [];
  store.executeJobs = [];
  store.suppression = null;
  store.failEmailEnqueues = 0;
  store.failTaskCompletions = 0;
  store.approvedCopy = [];
  enqueueSpy.mockClear();

  store.leads.set(LEAD_ID, {
    id: LEAD_ID,
    tenantId: TENANT_ID,
    email: 'prospect@acme.com',
    firstName: 'Pat',
    lastName: 'Prospect',
    emailInvalid: false,
    archivedAt: null,
    stage: 'sequence_active',
    timezone: TZ,
    sequenceId: SEQUENCE_ID,
    sequenceStep: 1,
    sequenceStatus: 'active',
    assignedToId: USER_ID,
    crmPriorityScore: 'warm',
    assignedTo: { id: USER_ID, firstName: 'Sam', lastName: 'Rep', role: 'sdr', isActive: true, timezone: TZ },
    campaign: { id: 'camp-1', status: 'active' },
    sequence: { id: SEQUENCE_ID, isActive: true, isArchived: false },
  });

  store.sequences.set(SEQUENCE_ID, { id: SEQUENCE_ID, name: 'Ladder', isActive: true, isArchived: false });

  store.enrollments.set(ENROLLMENT_ID, {
    id: ENROLLMENT_ID,
    leadId: LEAD_ID,
    sequenceId: SEQUENCE_ID,
    tenantId: TENANT_ID,
    status: 'active',
    currentStep: 1,
    occupancyKey: `${TENANT_ID}:${LEAD_ID}`,
    nextActionAt: null,
    lastEvaluatedAt: null,
  });

  const taskId = enrollmentStepTaskId(ENROLLMENT_ID, 1);
  store.tasks.set(taskId, {
    id: taskId,
    tenantId: TENANT_ID,
    leadId: LEAD_ID,
    userId: USER_ID,
    type: 'email',
    status: 'pending',
    lockedAt: null,
    sequenceId: SEQUENCE_ID,
    sequenceStep: 1,
    dueDate: new Date(),
    lead: store.leads.get(LEAD_ID),
  });
}

/** The worker reads `task.lead` as an include; keep the joined copy pointing at the live row. */
function relinkTaskLeads(): void {
  for (const task of store.tasks.values()) {
    task.lead = store.leads.get(task.leadId);
  }
}

async function executeStep(order: number) {
  relinkTaskLeads();
  return handleExecuteTask({
    taskId: enrollmentStepTaskId(ENROLLMENT_ID, order),
    expectedEnrollmentId: ENROLLMENT_ID,
  });
}

// The eligibility check's send-window step (`lib/automation/eligibility.ts`, "Schedule / Send
// window check") defers to the next business day under `businessDayPolicy: 'skip_weekends'`
// regardless of the hour, because every step fixture here carries null send-window minutes —
// "no configured window" still has a business-day policy applied to it. Every step in this file
// read real wall-clock time via `new Date()` at `workers/sequence.ts`'s `now: new Date()`, so a
// CI run landing in the Saturday/Sunday window in `Asia/Ho_Chi_Minh` (the fixture lead's
// timezone) deferred every send instead of completing it — 29/29 failures, all fast, all
// `status: 'deferred'` where `'completed'` was expected. Same pattern and instant as
// `tests/sequence-execute.test.ts`: a fixed Monday, so the file's outcome no longer depends on
// which day it happens to run.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-10T10:00:00Z')); // Monday 10:00 UTC
});
afterEach(() => {
  vi.useRealTimers();
});

describe('three-step ladder — durable execution state', () => {
  beforeEach(() => {
    seedLadder();
  });

  it('advances the enrollment to step 2 and stores the scheduler timestamp on both the task and the enrollment', async () => {
    const result = await executeStep(1);
    expect(result).toMatchObject({ status: 'completed' });

    const enrollment = store.enrollments.get(ENROLLMENT_ID)!;
    expect(enrollment.currentStep).toBe(2);
    expect(enrollment.status).toBe('active');

    const step2TaskId = enrollmentStepTaskId(ENROLLMENT_ID, 2);
    const step2Task = store.tasks.get(step2TaskId)!;
    expect(step2Task).toBeDefined();
    expect(step2Task.status).toBe('pending');

    // The stored due date is the scheduler's answer, not an approximation of it.
    expect(enrollment.nextActionAt.getTime()).toBe(step2Task.dueDate.getTime());
    expect(store.leads.get(LEAD_ID)!.nextTaskDue.getTime()).toBe(step2Task.dueDate.getTime());
  });

  it('creates no row for step 3 until step 2 has completed', async () => {
    await executeStep(1);
    expect(store.tasks.has(enrollmentStepTaskId(ENROLLMENT_ID, 3))).toBe(false);

    await executeStep(2);
    expect(store.tasks.has(enrollmentStepTaskId(ENROLLMENT_ID, 3))).toBe(true);
    expect(store.enrollments.get(ENROLLMENT_ID)!.currentStep).toBe(3);
  });

  it('refuses a step-3 job that arrives while the cadence is still on step 2', async () => {
    await executeStep(1); // cadence now on step 2, and a step-2 task exists

    // Forge the step-3 task a buggy caller might have created early.
    const earlyId = enrollmentStepTaskId(ENROLLMENT_ID, 3);
    store.tasks.set(earlyId, {
      ...store.tasks.get(enrollmentStepTaskId(ENROLLMENT_ID, 2))!,
      id: earlyId,
      sequenceStep: 3,
    });

    const result = await executeStep(3);
    expect(result).toMatchObject({ status: 'skipped', reason: 'step_mismatch' });
    expect(store.sendJobs).toHaveLength(1); // only step 1 ever reached the email pipeline
  });

  it('sends once and advances once when the same job is delivered twice', async () => {
    await executeStep(1);
    const afterFirst = store.enrollments.get(ENROLLMENT_ID)!.currentStep;

    const replay = await executeStep(1);

    expect(replay).toMatchObject({ status: 'ignored' });
    expect(store.enrollments.get(ENROLLMENT_ID)!.currentStep).toBe(afterFirst);
    expect(store.outbound).toHaveLength(1);
    expect(store.sendJobs).toHaveLength(1);
  });

  it('walks all three steps and then terminalises the occurrence exactly once', async () => {
    await executeStep(1);
    await executeStep(2);
    await executeStep(3);

    const enrollment = store.enrollments.get(ENROLLMENT_ID)!;
    expect(enrollment.status).toBe('completed');
    expect(store.sendJobs).toHaveLength(3);
    expect(store.outbound).toHaveLength(3);

    // The lead's compatibility cache is cleared, and the occupancy released.
    const lead = store.leads.get(LEAD_ID)!;
    expect(lead.sequenceId).toBeNull();
    expect(enrollment.occupancyKey).toBeNull();
  });

  it('schedules step 2 with the delay a restart would recompute from the database', async () => {
    await executeStep(1);

    const step2Task = store.tasks.get(enrollmentStepTaskId(ENROLLMENT_ID, 2))!;
    const executeJob = store.executeJobs.find(
      (j) => j.payload?.taskId === step2Task.id
    );

    expect(executeJob).toBeDefined();
    expect(executeJob!.payload.expectedEnrollmentId).toBe(ENROLLMENT_ID);

    // A rebuild derives the delay from the stored due date; the enqueued delay must match it.
    const rebuiltDelay = Math.max(0, step2Task.dueDate.getTime() - Date.now());
    expect(Math.abs(executeJob!.delay - rebuiltDelay)).toBeLessThan(2_000);
  });

  it('stops the ladder when the prospect replies before the step-2 job wakes', async () => {
    await executeStep(1);

    // The reply pipeline moves the lead to `replied` and pauses the occurrence.
    const lead = store.leads.get(LEAD_ID)!;
    lead.stage = 'replied';
    store.enrollments.get(ENROLLMENT_ID)!.status = 'paused';
    store.enrollments.get(ENROLLMENT_ID)!.pausedReason = 'reply';

    // The already-queued step-2 job still wakes up. It must refuse on its own.
    const result = await executeStep(2);

    // The refusal has to come from the occurrence check, not from a missing or already-finished
    // task — a pass for the wrong reason would hide the guard being gone.
    expect(result).toMatchObject({ status: 'skipped', reason: 'occurrence_no_longer_active' });
    expect(store.sendJobs).toHaveLength(1);
    expect(store.outbound).toHaveLength(1);
  });
});

/**
 * Interruptions (Plan 1 §A3).
 *
 * Each case does the same thing: run step 1 so a real step-2 task and a real delayed job exist,
 * apply the interruption to durable state, then **let the step-2 job wake up anyway**. Nothing is
 * cancelled or deleted first — the point is that the execution path refuses on its own, because a
 * queue is not a safety mechanism and a job that is already scheduled will eventually run.
 */
describe('interruptions — a queued follow-up refuses on its own', () => {
  beforeEach(() => {
    seedLadder();
  });

  /** Run step 1, then hand the caller the live lead row to interrupt. */
  async function afterFirstEmail(): Promise<Row> {
    await executeStep(1);
    expect(store.sendJobs).toHaveLength(1);
    return store.leads.get(LEAD_ID)!;
  }

  function noSecondContact(result: unknown, expected: Row) {
    expect(result).toMatchObject(expected);
    expect(store.sendJobs).toHaveLength(1);
    expect(store.outbound).toHaveLength(1);
  }

  it('stops after a meaningful reply moved the prospect to replied', async () => {
    const lead = await afterFirstEmail();
    lead.stage = 'replied';

    noSecondContact(await executeStep(2), { status: 'skipped', reason: 'lead_replied' });
  });

  it('stops once a meeting is booked', async () => {
    const lead = await afterFirstEmail();
    lead.stage = 'meeting_booked';

    noSecondContact(await executeStep(2), { status: 'skipped', reason: 'meeting_booked' });
  });

  it('stops after a hard bounce flagged the address invalid', async () => {
    const lead = await afterFirstEmail();
    lead.emailInvalid = true;

    noSecondContact(await executeStep(2), { status: 'skipped', reason: 'lead_email_invalid' });
  });

  it('stops when a suppression entry lands after the follow-up was scheduled', async () => {
    await afterFirstEmail();
    store.suppression = { id: 'sup-1', reason: 'unsubscribe' };

    noSecondContact(await executeStep(2), { status: 'skipped', reason: 'recipient_suppressed' });
  });

  it('stops when the SDR takes the conversation over and the cadence is paused', async () => {
    await afterFirstEmail();
    const enrollment = store.enrollments.get(ENROLLMENT_ID)!;
    enrollment.status = 'paused';
    enrollment.pausedReason = 'manual';

    noSecondContact(await executeStep(2), {
      status: 'skipped',
      reason: 'occurrence_no_longer_active',
    });
  });

  it('stops when the prospect is won or lost, and reports it as a terminal outcome', async () => {
    const lead = await afterFirstEmail();
    lead.stage = 'won';

    noSecondContact(await executeStep(2), { status: 'skipped', reason: 'lead_stage_won' });
  });

  it('stops when the campaign itself is paused', async () => {
    const lead = await afterFirstEmail();
    lead.campaign = { id: 'camp-1', status: 'paused' };

    noSecondContact(await executeStep(2), { status: 'skipped', reason: 'campaign_paused' });
  });

  it('holds rather than stops when the mailbox is unavailable, and tells the SDR', async () => {
    await afterFirstEmail();
    store.accounts = []; // the SDR disconnected their mailbox

    const result = await executeStep(2);

    expect(result).toMatchObject({ status: 'manual_action_required', reason: 'no_connected_mailbox' });
    expect(store.sendJobs).toHaveLength(1);
    // A held step is worth interrupting a human for; a stopped one is not.
    expect(store.notifications.some((n) => n.type === 'sequence_error')).toBe(true);
    // The cadence is still on step 2 — this is a hold, not a terminal state.
    expect(store.enrollments.get(ENROLLMENT_ID)!.currentStep).toBe(2);
  });

  it('leaves the step runnable after an interruption is lifted', async () => {
    const lead = await afterFirstEmail();
    lead.stage = 'replied';
    await executeStep(2);

    // The SDR handed the prospect back and the stage returned to an outreachable one.
    lead.stage = 'sequence_active';

    const result = await executeStep(2);
    expect(result).toMatchObject({ status: 'completed' });
    expect(store.sendJobs).toHaveLength(2);
  });
});

/**
 * The two crash windows between durable intent and transport (Plan 1 §A5).
 *
 * Both look identical from the outside — a job threw and BullMQ will retry it — and both are
 * places where a system that is idempotent in normal operation starts sending twice. The
 * assertions are on the *count* of prospect-facing occurrences, because that is the only thing
 * the prospect experiences.
 */
describe('durable delivery seams', () => {
  beforeEach(() => {
    seedLadder();
  });

  it('creates no second outbound occurrence when the database write succeeded and the enqueue failed', async () => {
    store.failEmailEnqueues = 1;

    await expect(executeStep(1)).rejects.toThrow(/redis unavailable/);

    // Intent is durable, transport is not: exactly one outbound row, nothing sent, and the task
    // is back in the claimable pool rather than stranded locked.
    expect(store.outbound).toHaveLength(1);
    expect(store.sendJobs).toHaveLength(0);
    const task = store.tasks.get(enrollmentStepTaskId(ENROLLMENT_ID, 1))!;
    expect(task.status).toBe('pending');
    expect(task.lockedAt).toBeNull();
    // Nothing advanced on a step that never reached the prospect.
    expect(store.enrollments.get(ENROLLMENT_ID)!.currentStep).toBe(1);

    // The retry re-derives the same intent and finds the existing row.
    const retry = await executeStep(1);
    expect(retry).toMatchObject({ status: 'completed' });
    expect(store.outbound).toHaveLength(1);
    expect(store.sendJobs).toHaveLength(1);
    expect(store.enrollments.get(ENROLLMENT_ID)!.currentStep).toBe(2);
  });

  it('converges to one outbound occurrence when the process dies after the enqueue', async () => {
    store.failTaskCompletions = 1;

    await expect(executeStep(1)).rejects.toThrow(/connection terminated/);

    // The send was already handed to the email pipeline before the crash.
    expect(store.sendJobs).toHaveLength(1);
    expect(store.outbound).toHaveLength(1);
    expect(store.tasks.get(enrollmentStepTaskId(ENROLLMENT_ID, 1))!.status).toBe('pending');

    const retry = await executeStep(1);

    expect(retry).toMatchObject({ status: 'completed' });
    // One logical outbound occurrence, and the enrollment converges to step 2 exactly once.
    expect(store.outbound).toHaveLength(1);
    expect(store.enrollments.get(ENROLLMENT_ID)!.currentStep).toBe(2);
    expect(store.tasks.get(enrollmentStepTaskId(ENROLLMENT_ID, 1))!.status).toBe('completed');
  });

  it('re-enqueues the same email payload rather than a second distinct send on retry', async () => {
    store.failTaskCompletions = 1;
    await expect(executeStep(1)).rejects.toThrow();
    await executeStep(1);

    // Both attempts name the same OutboundMessage, so the email worker's status guard — not luck —
    // is what stops the second delivery.
    const outboundIds = new Set(store.sendJobs.map((j) => j.outboundMessageId));
    expect(outboundIds.size).toBe(1);
  });
});

/**
 * Approved copy at execution (Plan 1 §A4).
 *
 * The send path *reads* durable approved content. It does not generate any — the mocks here
 * include no AI module at all, and the worker still sends, which is the point: an approved
 * cadence executes identically whether or not a provider is reachable.
 */
describe('approved per-occurrence copy', () => {
  beforeEach(() => {
    seedLadder();
  });

  it('sends the approved copy instead of the shared template when one exists', async () => {
    store.approvedCopy = [
      {
        enrollmentId: ENROLLMENT_ID,
        stepOrder: 1,
        subject: 'Your Q3 hiring push',
        body: 'Saw the 12 SDR openings in Da Nang.',
        aiGenerated: true,
      },
    ];

    await executeStep(1);

    expect(store.sendJobs[0].subject).toBe('Your Q3 hiring push');
    expect(store.sendJobs[0].body).toBe('Saw the 12 SDR openings in Da Nang.');
  });

  it('falls back to the shared template for a step with no approved copy', async () => {
    store.approvedCopy = [
      { enrollmentId: ENROLLMENT_ID, stepOrder: 1, subject: 'Approved 1', body: 'Approved body 1' },
    ];

    await executeStep(1);
    await executeStep(2);

    expect(store.sendJobs[0].subject).toBe('Approved 1');
    // Step 2 was never personalized, so it sends exactly what it did before this feature existed.
    expect(store.sendJobs[1].subject).toBe('Subject 2');
    expect(store.sendJobs[1].body).toBe('Body 2');
  });

  it('never inherits copy approved for a different occurrence', async () => {
    store.approvedCopy = [
      {
        enrollmentId: 'some-other-enrollment',
        stepOrder: 1,
        subject: 'Not for this cadence',
        body: 'Not for this cadence',
      },
    ];

    await executeStep(1);

    expect(store.sendJobs[0].subject).toBe('Subject 1');
  });

  it('sends the same approved words on a retry — content cannot drift between attempts', async () => {
    store.approvedCopy = [
      { enrollmentId: ENROLLMENT_ID, stepOrder: 1, subject: 'Stable', body: 'Stable body' },
    ];
    store.failTaskCompletions = 1;

    await expect(executeStep(1)).rejects.toThrow();
    await executeStep(1);

    // One occurrence, and both attempts derived identical content.
    expect(store.outbound).toHaveLength(1);
    expect(store.sendJobs.every((j) => j.subject === 'Stable')).toBe(true);
  });
});

describe('three-step ladder — scheduler agreement', () => {
  beforeEach(() => {
    seedLadder();
  });

  it('stores exactly the timestamp the scheduling engine computes for step 2', async () => {
    const before = new Date();
    await executeStep(1);
    const step2Task = store.tasks.get(enrollmentStepTaskId(ENROLLMENT_ID, 2))!;

    // `advanceOccurrence` bases the next step on `new Date()` at advance time, so recompute a
    // bracket around that instant rather than a single point.
    const low = expectedDue(store.steps[1], before);
    const high = expectedDue(store.steps[1], new Date());

    expect(step2Task.dueDate.getTime()).toBeGreaterThanOrEqual(low.getTime());
    expect(step2Task.dueDate.getTime()).toBeLessThanOrEqual(high.getTime());
  });
});

/**
 * Durable A/B variant attribution (Task 9).
 *
 * Selection was already deterministic; what was missing is that the *choice* was thrown away
 * after the send. A running `sentCount` says how many messages went out under a variant and can
 * never say which prospect got which wording, so no reply, meeting or bounce could be attributed
 * back to it. These assert the identity is on the outbound row — the record of the send — not
 * recomputed later, because a recomputation changes its answer the day the seed inputs or the
 * variant set change and would quietly rewrite history.
 */
describe('A/B variant attribution at send time', () => {
  const VARIANTS = [
    { id: 'var-a', version: 'A', subject: 'Subject A', body: 'Body A' },
    { id: 'var-b', version: 'B', subject: 'Subject B', body: 'Body B' },
  ];

  function seedWithVariants(): void {
    seedLadder();
    store.steps = [
      stepFixture(1, {
        template: {
          id: 'tmpl-1',
          subject: 'Subject 1',
          body: 'Body 1',
          abVariants: VARIANTS,
        },
      }),
      stepFixture(2, { delayDays: 3 }),
      stepFixture(3, { delayDays: 4 }),
    ];
  }

  beforeEach(() => {
    seedWithVariants();
  });

  it('records which variant produced the words that were sent', async () => {
    await executeStep(1);

    const sent = store.outbound[0];
    expect(VARIANTS.map((v) => v.id)).toContain(sent.abVariantId);
    // The recorded variant is the one whose wording actually went out, not merely a variant.
    const chosen = VARIANTS.find((v) => v.id === sent.abVariantId)!;
    expect(sent.subject).toBe(chosen.subject);
    expect(sent.body).toBe(chosen.body);
  });

  it('records the cadence and step alongside it, so a send can be grouped without the task', async () => {
    await executeStep(1);

    expect(store.outbound[0].sequenceId).toBe(SEQUENCE_ID);
    expect(store.outbound[0].sequenceStepOrder).toBe(1);
  });

  it('attributes a retry to the same variant — one send, one identity', async () => {
    store.failTaskCompletions = 1;

    await expect(executeStep(1)).rejects.toThrow();
    const afterCrash = store.outbound[0].abVariantId;
    await executeStep(1);

    expect(store.outbound).toHaveLength(1);
    expect(store.outbound[0].abVariantId).toBe(afterCrash);
  });

  it('attributes no variant when approved copy decided the wording', async () => {
    store.approvedCopy = [
      {
        enrollmentId: ENROLLMENT_ID,
        stepOrder: 1,
        subject: 'Approved for this prospect',
        body: 'Approved body',
        aiGenerated: true,
      },
    ];

    await executeStep(1);

    // Not "variant A by default". The approval overrode selection, so no variant was on trial —
    // counting this send toward one would put messages the experiment never sent into its result.
    expect(store.outbound[0].abVariantId).toBeNull();
    expect(store.outbound[0].subject).toBe('Approved for this prospect');
  });

  it('attributes no variant when the step has no pair', async () => {
    await executeStep(1);
    await executeStep(2);

    expect(store.outbound[1].abVariantId).toBeNull();
    expect(store.outbound[1].sequenceStepOrder).toBe(2);
  });
});
