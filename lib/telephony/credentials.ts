import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { getTelephonyProvider } from './index';
import type { ProviderToken } from './provider';

/**
 * A rep's softphone identity, and the short-lived token their browser logs in with.
 *
 * One provider credential per rep, created the first time they need one; concurrent first requests
 * share one creation. A credential whose create succeeded at the provider but whose answer was lost
 * is adopted by its name on the next request; one whose row could not be saved is removed again, so
 * nothing is left registered at the provider without a row (`@@unique([userId, tenantId])`).
 *
 * Tokens are minted on demand and never stored. At most one per rep every `TOKEN_MIN_INTERVAL_MS`,
 * enforced by a compare-and-set on `lastTokenAt` — the browser keeps its token for 24 hours and only
 * asks again when Telnyx warns it is expiring, so more than that is a loop or an attack.
 */

export const TOKEN_MIN_INTERVAL_MS = 10_000;

export type RepToken = ProviderToken & { sipUsername: string };

export class TokenRateLimitedError extends Error {
  constructor() {
    super('A softphone token was issued for this user moments ago');
    this.name = 'TokenRateLimitedError';
  }
}

export class CredentialRevokedError extends Error {
  constructor() {
    super('This user\'s softphone credential has been revoked');
    this.name = 'CredentialRevokedError';
  }
}

export function credentialLabel(tenantId: string, userId: string): string {
  return `crm:${tenantId}:${userId}`;
}

type CredentialRow = Awaited<ReturnType<typeof prisma.telephonyCredential.findFirstOrThrow>>;

/**
 * First-credential creations in flight in this process, by rep. Concurrent first requests share one
 * creation instead of each paying for a credential at the provider. Deliberately not a database
 * lock: the provider call can take seconds, and holding a pooled connection (or a transaction) for
 * it would let a roll-out morning's first logins starve every other request of connections.
 * Across processes the bound is one creation per process, and the unique row + revoke below cleans up.
 */
const creationsInFlight = new Map<string, Promise<CredentialRow>>();

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function revokeQuietly(providerCredentialId: string, context: { tenantId: string; userId: string }) {
  await getTelephonyProvider()
    .revokeCredential(providerCredentialId)
    .catch((revokeError) => console.error('[telephony] could not remove an unsaved credential', { ...context, revokeError }));
}

async function createCredentialRow(tenantId: string, userId: string): Promise<CredentialRow> {
  const provider = getTelephonyProvider();
  const label = credentialLabel(tenantId, userId);
  const created = (await provider.findCredentialByName(label)) ?? (await provider.createCredential({ label, tag: `tenant:${tenantId}` }));

  try {
    return await prisma.telephonyCredential.create({
      data: { tenantId, userId, provider: provider.name, providerCredentialId: created.providerCredentialId, sipUsername: created.sipUsername },
    });
  } catch (error) {
    const winner = await prisma.telephonyCredential.findFirst({ where: { tenantId, userId } });
    if (winner) {
      // Another process saved this rep's credential first. Keep theirs; remove ours unless it is the
      // same credential (both adopted it by name).
      if (winner.providerCredentialId !== created.providerCredentialId) await revokeQuietly(created.providerCredentialId, { tenantId, userId });
      return winner;
    }
    // No row for this rep. A unique violation then means the id is already some other row's — it is
    // in use, so it must not be revoked. Any other failure leaves it unsaved: remove it.
    if (!isUniqueViolation(error)) await revokeQuietly(created.providerCredentialId, { tenantId, userId });
    throw error;
  }
}

async function ensureCredential(tenantId: string, userId: string): Promise<CredentialRow> {
  const existing = await prisma.telephonyCredential.findFirst({ where: { tenantId, userId } });
  if (existing) return existing;

  const key = `${tenantId}:${userId}`;
  const inFlight = creationsInFlight.get(key);
  if (inFlight) return inFlight;
  const creation = createCredentialRow(tenantId, userId).finally(() => creationsInFlight.delete(key));
  creationsInFlight.set(key, creation);
  return creation;
}

export async function issueRepToken(input: { tenantId: string; userId: string; now?: Date }): Promise<RepToken> {
  const now = input.now ?? new Date();
  const credential = await ensureCredential(input.tenantId, input.userId);
  if (credential.status !== 'active' || credential.revokedAt) throw new CredentialRevokedError();

  const claimed = await prisma.telephonyCredential.updateMany({
    where: {
      id: credential.id,
      tenantId: input.tenantId,
      OR: [{ lastTokenAt: null }, { lastTokenAt: { lt: new Date(now.getTime() - TOKEN_MIN_INTERVAL_MS) } }],
    },
    data: { lastTokenAt: now },
  });
  if (claimed.count === 0) throw new TokenRateLimitedError();

  try {
    const token = await getTelephonyProvider().mintToken(credential.providerCredentialId);
    return { ...token, sipUsername: credential.sipUsername };
  } catch (error) {
    // No token was issued, so give the slot back: a provider hiccup must not also lock the rep out
    // for the next ten seconds. Only our own claim is undone — a newer one is left alone.
    await prisma.telephonyCredential
      .updateMany({ where: { id: credential.id, tenantId: input.tenantId, lastTokenAt: now }, data: { lastTokenAt: credential.lastTokenAt } })
      .catch((releaseError) => console.error('[telephony] could not release a token slot', { userId: input.userId, releaseError }));
    throw error;
  }
}
