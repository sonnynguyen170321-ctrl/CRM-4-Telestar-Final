import { randomUUID } from 'node:crypto';

import type { Prisma, ResearchDomainClassification } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * Per-tenant cache of "what is this company", keyed by domain and classifier version (2026-10-08).
 *
 * Classifying a company can cost a page fetch and a model call; the same banks, telcos and MROs come
 * back run after run, so a completed classification is reused for 30 days. Two verify slices that meet
 * the same domain must not both pay for it, so work on a domain is claimed first — the same
 * conditional-claim shape the research runner uses for runs. A claim that has gone quiet (a crashed
 * slice) may be taken over; a failed classification is retried by the next claim rather than cached.
 *
 * Never call a provider while holding a transaction: the claim is a single conditional write, the work
 * happens outside, and the result is written with the token that proves the claim is still ours.
 */

export const DOMAIN_CLASSIFICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A claim older than this belongs to a slice that died; another may take the domain. */
export const DOMAIN_CLASSIFICATION_CLAIM_STALE_MS = 5 * 60 * 1000;

export type DomainClassificationClaim =
  | { state: 'fresh'; row: ResearchDomainClassification }
  | { state: 'won'; id: string; token: string }
  | { state: 'busy' };

export async function claimDomainClassification(input: {
  tenantId: string;
  domain: string;
  version: number;
  now?: Date;
}): Promise<DomainClassificationClaim> {
  const { tenantId, domain, version } = input;
  const now = input.now ?? new Date();
  const staleBefore = new Date(now.getTime() - DOMAIN_CLASSIFICATION_CLAIM_STALE_MS);
  const token = randomUUID();

  const existing = await prisma.researchDomainClassification.findFirst({
    where: { tenantId, canonicalDomain: domain, classifierVersion: version },
  });

  if (existing?.status === 'completed' && existing.expiresAt > now) return { state: 'fresh', row: existing };

  if (existing) {
    // Take the row unless someone else holds a live claim on it.
    const taken = await prisma.researchDomainClassification.updateMany({
      where: {
        id: existing.id,
        tenantId,
        OR: [{ status: { not: 'pending' } }, { claimedAt: null }, { claimedAt: { lt: staleBefore } }],
      },
      data: { status: 'pending', claimToken: token, claimedAt: now },
    });
    return taken.count === 1 ? { state: 'won', id: existing.id, token } : { state: 'busy' };
  }

  try {
    const created = await prisma.researchDomainClassification.create({
      data: {
        tenantId,
        canonicalDomain: domain,
        classifierVersion: version,
        status: 'pending',
        claimToken: token,
        claimedAt: now,
        expiresAt: now,
      },
      select: { id: true },
    });
    return { state: 'won', id: created.id, token };
  } catch (error) {
    // Another slice created it between our read and our insert: theirs to finish.
    if ((error as { code?: string } | null)?.code === 'P2002') return { state: 'busy' };
    throw error;
  }
}

export async function completeDomainClassification(input: {
  tenantId: string;
  id: string;
  token: string;
  classificationJson: Prisma.InputJsonValue;
  evidenceJson?: Prisma.InputJsonValue;
  sourcesJson?: Prisma.InputJsonValue;
  confidence: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const written = await prisma.researchDomainClassification.updateMany({
    where: { id: input.id, tenantId: input.tenantId, claimToken: input.token },
    data: {
      status: 'completed',
      classificationJson: input.classificationJson,
      evidenceJson: input.evidenceJson,
      sourcesJson: input.sourcesJson,
      confidence: input.confidence,
      errorCode: null,
      errorMessage: null,
      claimToken: null,
      expiresAt: new Date(now.getTime() + DOMAIN_CLASSIFICATION_TTL_MS),
    },
  });
  // False: the claim was taken over while we worked (we were judged dead). Their result stands.
  return written.count === 1;
}

export async function failDomainClassification(input: {
  tenantId: string;
  id: string;
  token: string;
  errorCode: string;
  errorMessage: string;
  sourcesJson?: Prisma.InputJsonValue;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  await prisma.researchDomainClassification.updateMany({
    where: { id: input.id, tenantId: input.tenantId, claimToken: input.token },
    data: {
      status: 'failed',
      errorCode: input.errorCode,
      errorMessage: input.errorMessage.slice(0, 500),
      sourcesJson: input.sourcesJson,
      claimToken: null,
      expiresAt: now,
    },
  });
}
