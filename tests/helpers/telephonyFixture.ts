import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { issueCallToken, toClientState } from '@/lib/telephony/authToken';
import { tenantStorage } from '@/lib/tenant-context';

/**
 * Shared fixtures for the dialer's Phase 4 suites: a Telnyx-style signer, event builders, and a
 * tenant with a rep, a lead, a credential and an authorized call.
 */

export const inTenant = <T>(tenantId: string, fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);
export const asSystem = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

/** A fresh Ed25519 key pair in the shapes Telnyx uses: raw 32-byte public key base64, base64 signature. */
export function makeSigner() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return {
    publicKey: raw.toString('base64'),
    headers(rawBody: string, timestamp: number) {
      const signature = sign(null, Buffer.from(`${timestamp}|${rawBody}`, 'utf8'), privateKey).toString('base64');
      return { 'telnyx-signature-ed25519': signature, 'telnyx-timestamp': String(timestamp), 'content-type': 'application/json' };
    },
  };
}

export type EventSpec = {
  id: string;
  type: string;
  sessionId?: string | null;
  controlId?: string | null;
  direction?: 'incoming' | 'outgoing';
  clientState?: string | null;
  from?: string;
  to?: string;
  hangupCause?: string;
  occurredAt?: Date;
  recordingId?: string;
  startTime?: Date;
  endTime?: Date;
};

/** The webhook body Telnyx posts. */
export function eventBody(spec: EventSpec) {
  return {
    data: {
      id: spec.id,
      event_type: spec.type,
      occurred_at: (spec.occurredAt ?? new Date()).toISOString(),
      record_type: 'event',
      payload: {
        call_session_id: spec.sessionId ?? undefined,
        call_control_id: spec.controlId ?? undefined,
        direction: spec.direction,
        client_state: spec.clientState ?? undefined,
        from: spec.from,
        to: spec.to,
        hangup_cause: spec.hangupCause,
        recording_id: spec.recordingId,
        start_time: spec.startTime?.toISOString(),
        end_time: spec.endTime?.toISOString(),
      },
    },
    meta: { attempt: 1 },
  };
}

/** Store an event the way the webhook would, without going through it. */
export async function storeEvent(spec: EventSpec, extra: { receivedAt?: Date; processedAt?: Date | null } = {}) {
  return asSystem(() =>
    prisma.telephonyEvent.create({
      data: {
        providerEventId: spec.id,
        type: spec.type,
        sessionId: spec.sessionId ?? null,
        payload: eventBody(spec),
        ...(extra.receivedAt ? { receivedAt: extra.receivedAt } : {}),
        ...(extra.processedAt !== undefined ? { processedAt: extra.processedAt } : {}),
      },
    })
  );
}

export const deleteEventsWithPrefix = (prefix: string) =>
  asSystem(() => prisma.telephonyEvent.deleteMany({ where: { providerEventId: { startsWith: prefix } } }));

export type DialerWorld = {
  tenantId: string;
  repId: string;
  leadId: string;
  sipUsername: string;
  toE164: string;
};

/** A tenant row's worth of dialer setup: rep, campaign, lead assigned to the rep, credential, enabled settings. */
export async function buildDialerWorld(tenantId: string, options: { phone?: string } = {}): Promise<DialerWorld> {
  const sipUsername = `gencred${randomUUID().slice(0, 8)}`;
  return inTenant(tenantId, async () => {
    const rep = await prisma.user.create({
      data: { tenantId, email: `rep.${randomUUID()}@t.test`, firstName: 'S', lastName: 'R', password: 'x', role: 'sdr' },
    });
    const client = await prisma.client.create({
      data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
    });
    const campaign = await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date() } });
    const lead = await prisma.lead.create({
      data: {
        tenantId,
        firstName: 'Ann',
        lastName: 'L',
        email: `ann.${randomUUID()}@acme.test`,
        company: 'Acme',
        phone: options.phone ?? '0948200638',
        campaignId: campaign.id,
        assignedToId: rep.id,
      },
    });
    await prisma.telephonySettings.create({ data: { tenantId, enabled: true, dryRun: false, allowedCountries: ['VN', 'SG'] } });
    await prisma.telephonyCredential.create({
      data: { tenantId, userId: rep.id, provider: 'fake', providerCredentialId: `cred-${randomUUID()}`, sipUsername },
    });
    return { tenantId, repId: rep.id, leadId: lead.id, sipUsername, toE164: '+84948200638' };
  });
}

export async function makeCall(
  world: DialerWorld,
  data: Partial<{
    status: 'authorized' | 'initiated' | 'ringing' | 'answered' | 'completed' | 'blocked' | 'failed';
    sessionId: string | null;
    controlId: string | null;
    initiatedAt: Date | null;
    answeredAt: Date | null;
    authorizedAt: Date | null;
    createdAt: Date;
  }> = {}
) {
  const status = data.status ?? 'authorized';
  return inTenant(world.tenantId, () =>
    prisma.call.create({
      data: {
        tenantId: world.tenantId,
        direction: 'outbound',
        status,
        userId: world.repId,
        leadId: world.leadId,
        toE164: world.toE164,
        authorizedAt: data.authorizedAt === undefined ? new Date() : data.authorizedAt,
        initiatedAt: data.initiatedAt === undefined ? (status === 'authorized' ? null : new Date()) : data.initiatedAt,
        answeredAt: data.answeredAt ?? null,
        providerSessionId: data.sessionId ?? null,
        providerControlId: data.controlId ?? null,
        ...(data.createdAt ? { createdAt: data.createdAt } : {}),
      },
    })
  );
}

/** The client state the softphone sends: a call token for this call, base64 as Telnyx carries it. */
export function clientStateFor(call: { id: string; tenantId: string; userId: string | null; toE164: string }, nowSeconds?: number) {
  return toClientState(issueCallToken({ callId: call.id, tenantId: call.tenantId, userId: call.userId!, toE164: call.toE164 }, nowSeconds));
}

export const reload = (tenantId: string, id: string) => inTenant(tenantId, () => prisma.call.findFirstOrThrow({ where: { id, tenantId } }));
export const activitiesFor = (tenantId: string, callId: string) =>
  inTenant(tenantId, () => prisma.activity.findMany({ where: { tenantId, idempotencyKey: `call:${callId}:final` } }));
