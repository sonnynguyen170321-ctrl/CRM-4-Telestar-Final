import 'server-only';

import { countryOfE164 } from '@telestar/core-identity';
import { Prisma } from '@prisma/client';

import { logAdminAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';

import { getTelephonyProvider } from './index';
import { safeError } from './safeError';

/**
 * The team's caller-ID numbers and softphone credentials on settings/telephony
 * (docs/dialer/TASKS.md D9.2). Every lookup is scoped by the session's tenant; a row that belongs to
 * another team is answered exactly like one that does not exist.
 */

export type NumberDto = {
  id: string;
  e164: string;
  country: string;
  label: string | null;
  purpose: string;
  isActive: boolean;
  isDefault: boolean;
  isOverallDefault: boolean;
};

export type CredentialDto = {
  id: string;
  userName: string;
  status: string;
  lastTokenAt: string | null;
  lastRegisteredAt: string | null;
  revokedAt: string | null;
};

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409; error: string };
const fail = (status: 400 | 404 | 409, error: string): { ok: false; status: 400 | 404 | 409; error: string } => ({ ok: false, status, error });

const NUMBER_SELECT = {
  id: true,
  e164: true,
  country: true,
  label: true,
  purpose: true,
  isActive: true,
  isDefault: true,
  isOverallDefault: true,
} as const;

const audit = (tenantId: string, input: Parameters<typeof logAdminAudit>[0]) => tenantStorage.run({ tenantId }, () => logAdminAudit(input));
const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export function listNumbers(tenantId: string): Promise<NumberDto[]> {
  return prisma.telephonyNumber.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' }, take: 200, select: NUMBER_SELECT });
}

export async function listCredentials(tenantId: string): Promise<CredentialDto[]> {
  const rows = await prisma.telephonyCredential.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: {
      id: true,
      status: true,
      lastTokenAt: true,
      lastRegisteredAt: true,
      revokedAt: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    userName: `${row.user.firstName} ${row.user.lastName}`.trim(),
    status: row.status,
    lastTokenAt: row.lastTokenAt?.toISOString() ?? null,
    lastRegisteredAt: row.lastRegisteredAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  }));
}

/** Add a number the account already owns. No provider call: the first outbound call proves it. */
export async function addNumber(tenantId: string, actorId: string, input: { e164: string; label?: string }): Promise<Outcome<NumberDto>> {
  const country = countryOfE164(input.e164);
  if (!country) return fail(400, 'That country calling code is not recognised');

  try {
    const created = await prisma.$transaction(async (tx) => {
      const countryHasDefault = await tx.telephonyNumber.findFirst({ where: { tenantId, country, isDefault: true, isActive: true }, select: { id: true } });
      const hasOverall = await tx.telephonyNumber.findFirst({ where: { tenantId, isOverallDefault: true, isActive: true }, select: { id: true } });
      return tx.telephonyNumber.create({
        data: {
          tenantId,
          e164: input.e164,
          country,
          label: input.label || null,
          purpose: 'outbound',
          isDefault: !countryHasDefault,
          isOverallDefault: !hasOverall,
        },
        select: NUMBER_SELECT,
      });
    });
    await audit(tenantId, {
      actorId,
      action: 'admin.telephony.number',
      tableName: 'TelephonyNumber',
      recordId: created.id,
      changedFields: { operation: 'add', after: created },
    });
    return { ok: true, value: created };
  } catch (error) {
    // The number is unique across the deployment. Whose it is stays unsaid.
    if (isUniqueViolation(error)) return fail(409, 'That number is already registered');
    throw error;
  }
}

type NumberPatch = { label?: string; isActive?: boolean; isDefault?: boolean; isOverallDefault?: boolean };

export async function updateNumber(tenantId: string, actorId: string, id: string, patch: NumberPatch): Promise<Outcome<NumberDto>> {
  const result = await prisma.$transaction(async (tx): Promise<Outcome<{ before: NumberDto; after: NumberDto }>> => {
    const before = await tx.telephonyNumber.findFirst({ where: { id, tenantId }, select: NUMBER_SELECT });
    if (!before) return fail(404, 'Number not found');

    const nextActive = patch.isActive ?? before.isActive;
    if (!nextActive && (patch.isDefault === true || patch.isOverallDefault === true)) {
      return fail(409, 'Turn the number on before making it a default');
    }

    const data: Prisma.TelephonyNumberUpdateInput = {};
    if (patch.label !== undefined) data.label = patch.label || null;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    if (!nextActive) Object.assign(data, { isDefault: false, isOverallDefault: false });

    if (patch.isDefault === true) {
      await tx.telephonyNumber.updateMany({ where: { tenantId, country: before.country, isDefault: true, id: { not: id } }, data: { isDefault: false } });
      data.isDefault = true;
    } else if (patch.isDefault === false) {
      data.isDefault = false;
    }
    if (patch.isOverallDefault === true) {
      await tx.telephonyNumber.updateMany({ where: { tenantId, isOverallDefault: true, id: { not: id } }, data: { isOverallDefault: false } });
      data.isOverallDefault = true;
    } else if (patch.isOverallDefault === false) {
      data.isOverallDefault = false;
    }

    const after = await tx.telephonyNumber.update({ where: { id }, data, select: NUMBER_SELECT });
    return { ok: true, value: { before, after } };
  });
  if (!result.ok) return result;

  const { before, after } = result.value;
  await audit(tenantId, {
    actorId,
    action: 'admin.telephony.number',
    tableName: 'TelephonyNumber',
    recordId: id,
    changedFields: { operation: 'update', before, after },
  });
  return { ok: true, value: after };
}

export async function removeNumber(tenantId: string, actorId: string, id: string): Promise<Outcome<null>> {
  const existing = await prisma.telephonyNumber.findFirst({ where: { id, tenantId }, select: NUMBER_SELECT });
  if (!existing) return fail(404, 'Number not found');
  const { count } = await prisma.telephonyNumber.deleteMany({ where: { id, tenantId } });
  if (count === 0) return fail(404, 'Number not found');
  await audit(tenantId, {
    actorId,
    action: 'admin.telephony.number',
    tableName: 'TelephonyNumber',
    recordId: id,
    changedFields: { operation: 'remove', before: existing },
  });
  return { ok: true, value: null };
}

/**
 * Revoke a rep's softphone credential. Marked revoked here first, so the token route refuses the rep
 * even if the provider cannot be reached; the provider deletion is then attempted and reported. A
 * retry on an already revoked credential repeats the provider deletion (it succeeds when already gone).
 */
export async function revokeCredential(
  tenantId: string,
  actorId: string,
  id: string
): Promise<Outcome<{ revoked: true; providerRevoked: boolean }>> {
  const credential = await prisma.telephonyCredential.findFirst({
    where: { id, tenantId },
    select: { id: true, userId: true, status: true, providerCredentialId: true },
  });
  if (!credential) return fail(404, 'Credential not found');

  const wasActive = credential.status === 'active';
  if (wasActive) {
    await prisma.telephonyCredential.updateMany({ where: { id, tenantId }, data: { status: 'revoked', revokedAt: new Date() } });
  }

  let providerRevoked = false;
  try {
    await getTelephonyProvider().revokeCredential(credential.providerCredentialId);
    providerRevoked = true;
  } catch (error) {
    console.error('[telephony] credential revoked locally but not at the provider', { credentialId: id, error: safeError(error) });
  }

  await audit(tenantId, {
    actorId,
    action: 'admin.telephony.credential_revoke',
    tableName: 'TelephonyCredential',
    recordId: id,
    targetUserId: credential.userId,
    changedFields: { operation: wasActive ? 'revoke' : 'retry_provider_revoke', providerRevoked },
  });
  return { ok: true, value: { revoked: true, providerRevoked } };
}
