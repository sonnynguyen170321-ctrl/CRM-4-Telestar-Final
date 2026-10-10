import { Prisma, type CallStatus } from '@prisma/client';

import { prisma, tenantStorage } from '@/lib/prisma';

import { finalStatusFor, isTerminalStatus, statusesBefore, type FinalStatus } from './callStatus';
import { legCallId } from './legMarker';
import { startRecordingOnAnswer, storeSavedRecording } from './recording';
import { parseTelnyxEvent, type TelnyxEvent } from './telnyx/events';

/**
 * Applying a stored provider event to its call (docs/dialer/SYSTEM_DESIGN.md, Phase 4).
 *
 * Runs in the `telephony` worker for every event the webhook stored, and again from the reconcile
 * cron for any that stayed unprocessed. It must therefore be safe to run twice, concurrently, and
 * in any order:
 *   - the tenant is the `Call` row's, found by the provider's session id — never the payload's say-so;
 *   - status moves only through `updateMany` guarded on the statuses a move may start from;
 *   - timestamps and causes are filled only while empty;
 *   - the `call_made` Activity is keyed `call:<id>:final` and linked once through the unique
 *     `Call.activityId`.
 */

const asSystem = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);
/** Scoped, not bypassed: every query on a tenant model below gets `tenantId` injected. */
const asTenant = <T>(tenantId: string, fn: () => Promise<T>) => tenantStorage.run({ tenantId }, fn);

export type ProcessResult = 'applied' | 'already_processed' | 'unmatched' | 'missing';

/** The columns the event handlers need. Read under the bypass scope, so nothing else is fetched. */
const CALL_REF_SELECT = { id: true, tenantId: true, answeredAt: true, providerSessionId: true } as const;
export type CallRef = Prisma.CallGetPayload<{ select: typeof CALL_REF_SELECT }>;

export async function findCallForEvent(event: Pick<TelnyxEvent, 'sessionId' | 'controlId'>): Promise<CallRef | null> {
  return asSystem(async () => {
    if (event.sessionId) {
      const bySession = await prisma.call.findFirst({ where: { provider: 'telnyx', providerSessionId: event.sessionId }, select: CALL_REF_SELECT });
      if (bySession) return bySession;
    }
    if (event.controlId) {
      return prisma.call.findFirst({ where: { provider: 'telnyx', providerControlId: event.controlId }, orderBy: { createdAt: 'desc' }, select: CALL_REF_SELECT });
    }
    return null;
  });
}

async function markProcessed(providerEventId: string, error: string | null): Promise<void> {
  await asSystem(() =>
    prisma.telephonyEvent.updateMany({
      where: { providerEventId, processedAt: null },
      data: { processedAt: new Date(), attempts: { increment: 1 }, lastError: error },
    })
  );
}

async function noteAttempt(providerEventId: string, error: string): Promise<void> {
  await asSystem(() =>
    prisma.telephonyEvent.updateMany({ where: { providerEventId, processedAt: null }, data: { attempts: { increment: 1 }, lastError: error } })
  );
}

export async function processTelephonyEvent(providerEventId: string): Promise<ProcessResult> {
  const row = await asSystem(() => prisma.telephonyEvent.findUnique({ where: { providerEventId } }));
  if (!row) return 'missing';
  if (row.processedAt) return 'already_processed';

  const event = parseTelnyxEvent(row.payload);
  if (!event) {
    await markProcessed(providerEventId, 'unparseable');
    return 'applied';
  }

  const call = await findCallForEvent(event);
  if (!call) {
    await noteAttempt(providerEventId, 'no_call');
    return 'unmatched';
  }

  await asTenant(call.tenantId, async () => {
    switch (event.type) {
      case 'call.initiated':
        return onLegInitiated(call, event);
      case 'call.answered':
      case 'call.bridged':
        return onAnswered(call, event);
      case 'call.hangup':
        return onHangup(call, event);
      case 'call.recording.saved':
        return onRecordingSaved(call, event);
      default:
        return undefined;
    }
  });
  await markProcessed(providerEventId, null);
  return 'applied';
}

async function advance(call: Pick<CallRef, 'id' | 'tenantId'>, to: CallStatus, extra: Prisma.CallUpdateManyMutationInput = {}): Promise<boolean> {
  const moved = await prisma.call.updateMany({
    where: { id: call.id, tenantId: call.tenantId, status: { in: statusesBefore(to) } },
    data: { status: to, ...extra },
  });
  return moved.count > 0;
}

/** Our own transferred leg being created is the closest thing Telnyx gives to "ringing". The parked leg's `call.initiated` is the webhook's inline work, not ours. */
async function onLegInitiated(call: CallRef, event: TelnyxEvent): Promise<void> {
  if (legCallId(event.clientState) !== call.id) return;
  await advance(call, 'ringing');
}

async function onAnswered(call: CallRef, event: TelnyxEvent): Promise<void> {
  const at = event.occurredAt ?? new Date();
  await advance(call, 'answered');
  await prisma.call.updateMany({ where: { id: call.id, tenantId: call.tenantId, answeredAt: null }, data: { answeredAt: at } });
  // The lead's leg answering is the hook: both the answered and the bridged event reach here, and the
  // stable command ids make the second a no-op at the provider.
  await startRecordingOnAnswer(call, event);
}

async function onRecordingSaved(call: CallRef, event: TelnyxEvent): Promise<void> {
  if (!event.recordingId) return;
  await storeSavedRecording(call, event.recordingId, event.occurredAt ?? new Date());
}

/**
 * The call ended. Whether it was answered is read from every event stored for the session, not just
 * the order they reached us in — a `call.answered` that overtook its own hangup, or lost the race
 * to a job, still counts. The webhook delays the hangup job a few seconds for the same reason.
 */
async function onHangup(call: CallRef, event: TelnyxEvent): Promise<void> {
  const stored = call.providerSessionId
    ? await asSystem(() =>
        prisma.telephonyEvent.findMany({
          where: { sessionId: call.providerSessionId, type: { in: ['call.answered', 'call.bridged', 'call.hangup'] } },
          orderBy: { receivedAt: 'asc' },
          take: 50,
        })
      )
    : [];
  const events = stored.map((s) => parseTelnyxEvent(s.payload)).filter((e): e is TelnyxEvent => e !== null);

  const answerTimes = events.filter((e) => e.type === 'call.answered' || e.type === 'call.bridged').map((e) => (e.occurredAt ?? new Date()).getTime());
  const answeredAt = call.answeredAt ?? (answerTimes.length > 0 ? new Date(Math.min(...answerTimes)) : null);

  // The lead's leg says why the call ended; the rep's leg only says the call is over.
  const hangups = events.filter((e) => e.type === 'call.hangup');
  const primary = hangups.find((e) => e.direction === 'outgoing') ?? event;

  await finishCall(call, {
    status: finalStatusFor({ answered: answeredAt !== null, hangupCause: primary.hangupCause }),
    endedAt: primary.endTime ?? primary.occurredAt ?? new Date(),
    hangupCause: primary.hangupCause,
    answeredAt,
  });
}

export type FinishInput = {
  status: FinalStatus;
  endedAt: Date;
  hangupCause: string | null;
  answeredAt: Date | null;
};

/**
 * Move a call to its end and make sure its Activity exists. Shared by the worker and the reconcile
 * cron. When the call already ended, only the fields still empty are filled — the status never changes.
 */
export async function finishCall(call: CallRef, input: FinishInput): Promise<'finished' | 'already_final'> {
  const billedDurationSec = input.answeredAt ? Math.max(0, Math.ceil((input.endedAt.getTime() - input.answeredAt.getTime()) / 1000)) : 0;
  const finished = await advance(call, input.status, {
    endedAt: input.endedAt,
    hangupCause: input.hangupCause,
    billedDurationSec,
    ...(input.answeredAt && !call.answeredAt ? { answeredAt: input.answeredAt } : {}),
  });

  if (!finished) {
    const where = { id: call.id, tenantId: call.tenantId };
    await prisma.call.updateMany({ where: { ...where, endedAt: null }, data: { endedAt: input.endedAt } });
    await prisma.call.updateMany({ where: { ...where, hangupCause: null }, data: { hangupCause: input.hangupCause } });
    await prisma.call.updateMany({ where: { ...where, billedDurationSec: null }, data: { billedDurationSec } });
    if (input.answeredAt) await prisma.call.updateMany({ where: { ...where, answeredAt: null }, data: { answeredAt: input.answeredAt } });
  }

  await ensureFinalActivity(call.id, call.tenantId);
  return finished ? 'finished' : 'already_final';
}

function describeFinal(status: CallStatus, billedDurationSec: number | null): string {
  const label: Record<string, string> = {
    completed: 'Call completed',
    no_answer: 'Call not answered',
    busy: 'Call busy',
    failed: 'Call failed',
    canceled: 'Call canceled',
    missed: 'Call missed',
  };
  const head = label[status] ?? 'Call ended';
  if (status !== 'completed' || billedDurationSec === null) return head;
  const minutes = Math.floor(billedDurationSec / 60);
  const seconds = billedDurationSec % 60;
  return `${head} (${minutes}m ${String(seconds).padStart(2, '0')}s)`;
}

/**
 * The one `call_made` Activity for a finished call, and the lead's last-contacted date.
 *
 * Not written for a call the provider was never asked to place (`initiatedAt` is null: refused at the
 * webhook, cancelled while still authorized, or the connect command failed), nor for one without a
 * rep to credit. The Activity is created under a unique key and linked through the unique
 * `Call.activityId`, so a replay, a redelivery and the reconcile cron all converge on one row.
 */
export async function ensureFinalActivity(callId: string, tenantId: string): Promise<'written' | 'exists' | 'skipped'> {
  const call = await prisma.call.findFirst({ where: { id: callId, tenantId } });
  if (!call || !isTerminalStatus(call.status) || !call.initiatedAt || !call.userId) return 'skipped';
  if (call.activityId) return 'exists';

  const key = `call:${call.id}:final`;
  const at = call.endedAt ?? new Date();
  let activity: { id: string } | null;
  try {
    activity = await prisma.activity.create({
      data: {
        idempotencyKey: key,
        userId: call.userId,
        leadId: call.leadId,
        type: 'call_made',
        channel: 'phone',
        description: describeFinal(call.status, call.billedDurationSec),
        metadata: {
          callId: call.id,
          direction: call.direction,
          status: call.status,
          durationSec: call.billedDurationSec ?? 0,
          hangupCause: call.hangupCause,
          contactId: call.contactId,
        },
        createdAt: at,
      },
      select: { id: true },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    activity = await prisma.activity.findFirst({ where: { idempotencyKey: key }, select: { id: true } });
    if (!activity) throw error;
  }

  const linked = await prisma.call.updateMany({ where: { id: call.id, tenantId, activityId: null }, data: { activityId: activity.id } });
  if (call.leadId) {
    await prisma.lead.updateMany({
      where: { id: call.leadId, tenantId, OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: at } }] },
      data: { lastContactedAt: at },
    });
  }
  return linked.count > 0 ? 'written' : 'exists';
}
