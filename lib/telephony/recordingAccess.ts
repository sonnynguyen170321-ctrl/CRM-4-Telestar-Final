import 'server-only';

import { MANAGER_ROLES, canAccessLead, canAccessUser, type SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Who may listen to a call recording (docs/dialer/TASKS.md D7.2): the rep who made the call or a
 * manager role, and in both cases only while they can still work the lead. A call with no lead (the
 * lead was deleted afterwards) is the caller's own, or a manager's within reach of the caller. Shared by
 * the playback route and by the activity feed that decides whether to show a "Play recording" control,
 * so the two can never disagree.
 */

type LeadRef = { assignedToId: string | null; campaignId: string | null };

export type RecordingCallRef = {
  userId: string | null;
  lead: LeadRef | null;
};

export const RECORDING_CALL_SELECT = {
  id: true,
  userId: true,
  leadId: true,
  recordingProviderId: true,
  lead: { select: { assignedToId: true, campaignId: true } },
} as const;

/** Decides whether the viewer can work a lead; the feed passes a memoised one so each lead is checked once per request. */
export type LeadAccessCheck = (lead: LeadRef) => Promise<boolean>;

export async function canListenToRecording(viewer: SessionUser, call: RecordingCallRef, leadAccess?: LeadAccessCheck): Promise<boolean> {
  const isOwnCall = call.userId !== null && call.userId === viewer.id;
  if (!isOwnCall && !MANAGER_ROLES.includes(viewer.role)) return false;
  if (call.lead) return (leadAccess ?? ((lead) => canAccessLead(viewer, lead)))(call.lead);
  // No lead to check: the caller's own call, or a manager whose reach includes the caller.
  if (isOwnCall) return true;
  return call.userId !== null && canAccessUser(viewer, call.userId);
}

/** The recorded call, tenant-scoped, or null when it does not exist, has no recording, or is not the viewer's to hear. */
export async function findListenableCall(viewer: SessionUser & { tenantId: string }, callId: string) {
  const call = await prisma.call.findFirst({ where: { id: callId, tenantId: viewer.tenantId }, select: RECORDING_CALL_SELECT });
  if (!call?.recordingProviderId) return null;
  return (await canListenToRecording(viewer, call)) ? { ...call, recordingProviderId: call.recordingProviderId } : null;
}

/** Of these call ids, the ones with a recording the viewer may hear. Lead access is decided once per lead. */
export async function listenableCallIds(viewer: SessionUser & { tenantId: string }, callIds: string[]): Promise<Set<string>> {
  if (callIds.length === 0) return new Set();
  const calls = await prisma.call.findMany({
    where: { id: { in: callIds }, tenantId: viewer.tenantId, recordingProviderId: { not: null } },
    select: RECORDING_CALL_SELECT,
    take: callIds.length,
  });
  const perLead = new Map<string, Promise<boolean>>();
  const leadAccess =
    (call: { leadId: string | null }): LeadAccessCheck =>
    (lead) => {
      const key = call.leadId ?? `${lead.assignedToId}:${lead.campaignId}`;
      let result = perLead.get(key);
      if (!result) {
        result = canAccessLead(viewer, lead);
        perLead.set(key, result);
      }
      return result;
    };
  const allowed = new Set<string>();
  for (const call of calls) if (await canListenToRecording(viewer, call, leadAccess(call))) allowed.add(call.id);
  return allowed;
}
