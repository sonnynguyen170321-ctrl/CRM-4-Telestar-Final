import 'server-only';

import { MANAGER_ROLES, canAccessLead, type SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Who may listen to a call recording (docs/dialer/TASKS.md D7.2): the rep who made the call or a
 * manager role, and in both cases only while they can still work the lead. Shared by the playback
 * route and by the activity feed that decides whether to show a "Play recording" control, so the two
 * can never disagree.
 */

export type RecordingCallRef = {
  userId: string | null;
  lead: { assignedToId: string | null; campaignId: string | null } | null;
};

export const RECORDING_CALL_SELECT = {
  id: true,
  userId: true,
  leadId: true,
  recordingProviderId: true,
  lead: { select: { assignedToId: true, campaignId: true } },
} as const;

export async function canListenToRecording(viewer: SessionUser, call: RecordingCallRef): Promise<boolean> {
  const isOwnCall = call.userId !== null && call.userId === viewer.id;
  if (!isOwnCall && !MANAGER_ROLES.includes(viewer.role)) return false;
  return call.lead ? canAccessLead(viewer, call.lead) : true;
}

/** The recorded call, tenant-scoped, or null when it does not exist, has no recording, or is not the viewer's to hear. */
export async function findListenableCall(viewer: SessionUser & { tenantId: string }, callId: string) {
  const call = await prisma.call.findFirst({ where: { id: callId, tenantId: viewer.tenantId }, select: RECORDING_CALL_SELECT });
  if (!call?.recordingProviderId) return null;
  return (await canListenToRecording(viewer, call)) ? { ...call, recordingProviderId: call.recordingProviderId } : null;
}

/** Of these call ids, the ones with a recording the viewer may hear. Bounded by the caller's page size. */
export async function listenableCallIds(viewer: SessionUser & { tenantId: string }, callIds: string[]): Promise<Set<string>> {
  if (callIds.length === 0) return new Set();
  const calls = await prisma.call.findMany({
    where: { id: { in: callIds }, tenantId: viewer.tenantId, recordingProviderId: { not: null } },
    select: RECORDING_CALL_SELECT,
    take: callIds.length,
  });
  const allowed = new Set<string>();
  for (const call of calls) if (await canListenToRecording(viewer, call)) allowed.add(call.id);
  return allowed;
}
