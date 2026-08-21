/**
 * Commercial memory — the domain service for `CommercialClaim`.
 *
 * Lives outside `lib/ai/` on purpose. `.claude/rules/ai.md` holds the line that nothing under
 * `lib/ai/` reads a CRM table directly: the AI layer asks a domain service, and the domain
 * service is where tenancy, validation and audit are enforced. Memory is CRM data, so it gets
 * the same treatment as every other table.
 *
 * ## The rules this file exists to enforce
 *
 * A prompt cannot be trusted to keep inference separate from fact, because a prompt is advice
 * and this is a constraint. So the separation is enforced at the write:
 *
 *   - `FACTUAL` requires a source. Something said it, somewhere, at a time. A factual claim
 *     with no provenance is refused rather than stored and later presented as established.
 *   - `INFERRED` requires a confidence in [0, 1]. An inference with no strength attached reads
 *     as a fact the moment it is retrieved.
 *   - Correction never rewrites. It supersedes, and the wrong belief keeps its text.
 *
 * ## Tenancy
 *
 * Every function takes `tenantId` as a required argument and every query filters on it. There
 * is no "current tenant" ambient here, because an ambient is exactly how a background job
 * writes into the wrong tenant.
 */

import { prisma } from '@/lib/prisma';
import type { CommercialClaim, Prisma } from '@prisma/client';

/** What a claim can be about. Text, not an enum — adding one is a code change and a test. */
export const CLAIM_SCOPES = [
  'CONVERSATION',
  'CONTACT',
  'COMPANY',
  'CAMPAIGN',
  'CLIENT',
  'USER',
  'TEAM',
  'TENANT',
  'INSTITUTIONAL',
] as const;
export type ClaimScope = (typeof CLAIM_SCOPES)[number];

export const CLAIM_TYPES = ['FACTUAL', 'INFERRED', 'PREFERENCE', 'PLAYBOOK'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_STATUSES = ['active', 'superseded', 'expired', 'retracted'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Scopes that describe the tenant itself, and so carry no scope id. */
const TENANT_WIDE_SCOPES = new Set<ClaimScope>(['TENANT', 'INSTITUTIONAL']);

/**
 * How long a claim stays usable without re-confirmation, by who authored it.
 *
 * AI-authored claims decay fastest. An inference drawn from a conversation six weeks ago is not
 * evidence about today, and the failure mode of leaving it active is the assistant asserting a
 * stale belief with the same confidence as a fresh CRM fact.
 */
export const DEFAULT_TTL_DAYS: Record<ClaimType, number | null> = {
  FACTUAL: 365,
  INFERRED: 30,
  PREFERENCE: 180,
  // Institutional policy expires when it is replaced, not on a clock.
  PLAYBOOK: null,
};

export class ClaimValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaimValidationError';
  }
}

export interface RecordClaimInput {
  tenantId: string;
  scopeType: ClaimScope;
  scopeId?: string | null;
  claimType: ClaimType;
  claimText: string;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceObservedAt?: Date | null;
  confidence?: number | null;
  createdByType: 'user' | 'ai' | 'system';
  createdById?: string | null;
  /** Overrides the type's default TTL. Pass `null` for a claim that does not expire. */
  expiresAt?: Date | null;
  now?: Date;
}

function assertValid(input: RecordClaimInput): void {
  if (!input.tenantId) throw new ClaimValidationError('tenantId is required');
  if (!input.claimText.trim()) throw new ClaimValidationError('claimText cannot be empty');

  if (!CLAIM_SCOPES.includes(input.scopeType)) {
    throw new ClaimValidationError(`unknown scopeType "${input.scopeType}"`);
  }
  if (!CLAIM_TYPES.includes(input.claimType)) {
    throw new ClaimValidationError(`unknown claimType "${input.claimType}"`);
  }

  const tenantWide = TENANT_WIDE_SCOPES.has(input.scopeType);
  if (!tenantWide && !input.scopeId) {
    throw new ClaimValidationError(`scopeType "${input.scopeType}" requires a scopeId`);
  }

  // A factual claim with no provenance is the thing this whole model exists to prevent: it
  // becomes indistinguishable from a sourced fact the moment it is read back.
  if (input.claimType === 'FACTUAL' && !input.sourceType) {
    throw new ClaimValidationError('a FACTUAL claim requires sourceType — provenance or nothing');
  }

  if (input.claimType === 'INFERRED') {
    if (input.confidence === undefined || input.confidence === null) {
      throw new ClaimValidationError('an INFERRED claim requires a confidence');
    }
  }

  if (input.confidence !== undefined && input.confidence !== null) {
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      throw new ClaimValidationError('confidence must be a number in [0, 1]');
    }
  }
}

function defaultExpiry(claimType: ClaimType, now: Date): Date | null {
  const days = DEFAULT_TTL_DAYS[claimType];
  if (days === null) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Writes a new claim. Throws `ClaimValidationError` rather than storing something unsound. */
export async function recordClaim(input: RecordClaimInput): Promise<CommercialClaim> {
  assertValid(input);
  const now = input.now ?? new Date();

  return prisma.commercialClaim.create({
    data: {
      tenantId: input.tenantId,
      scopeType: input.scopeType,
      scopeId: TENANT_WIDE_SCOPES.has(input.scopeType) ? null : (input.scopeId ?? null),
      claimType: input.claimType,
      claimText: input.claimText.trim(),
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      sourceObservedAt: input.sourceObservedAt ?? null,
      confidence: input.confidence ?? null,
      createdByType: input.createdByType,
      createdById: input.createdById ?? null,
      expiresAt: input.expiresAt !== undefined ? input.expiresAt : defaultExpiry(input.claimType, now),
      status: 'active',
      createdAt: now,
    },
  });
}

export interface ReadClaimsInput {
  tenantId: string;
  scopeType: ClaimScope;
  scopeId?: string | null;
  claimTypes?: readonly ClaimType[];
  /** Cap on rows returned. The context compiler has a token budget; memory is not exempt. */
  limit?: number;
  now?: Date;
}

/**
 * Active, unexpired claims about one scoped record, newest first.
 *
 * Expiry is applied in the query rather than by a sweep, so a claim past its date is invisible
 * from the moment it lapses even if no sweep has run. The sweep only tidies status.
 */
export async function readClaims(input: ReadClaimsInput): Promise<CommercialClaim[]> {
  if (!input.tenantId) throw new ClaimValidationError('tenantId is required');
  const now = input.now ?? new Date();

  const where: Prisma.CommercialClaimWhereInput = {
    tenantId: input.tenantId,
    scopeType: input.scopeType,
    scopeId: TENANT_WIDE_SCOPES.has(input.scopeType) ? null : (input.scopeId ?? null),
    status: 'active',
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
  if (input.claimTypes?.length) where.claimType = { in: [...input.claimTypes] };

  return prisma.commercialClaim.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: input.limit ?? 50,
  });
}

export interface CorrectClaimInput {
  tenantId: string;
  claimId: string;
  claimText: string;
  correctionReason: string;
  createdByType: 'user' | 'ai' | 'system';
  createdById?: string | null;
  confidence?: number | null;
  sourceType?: string | null;
  sourceId?: string | null;
  now?: Date;
}

/**
 * Corrects a claim by superseding it.
 *
 * The original row keeps its text and becomes `superseded`; the replacement points back at it.
 * Both halves happen in one transaction, because a superseded claim with no replacement is a
 * silently forgotten belief and a replacement with no superseded original is a duplicate.
 *
 * Scoped by tenant on the read, so a caller cannot correct another tenant's claim by id.
 */
export async function correctClaim(input: CorrectClaimInput): Promise<CommercialClaim> {
  if (!input.tenantId) throw new ClaimValidationError('tenantId is required');
  if (!input.correctionReason.trim()) {
    throw new ClaimValidationError('a correction requires a reason — "why we stopped believing it"');
  }
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const original = await tx.commercialClaim.findFirst({
      where: { id: input.claimId, tenantId: input.tenantId },
    });
    if (!original) {
      // Deliberately the same message whether the claim is absent or belongs to another
      // tenant: the difference is itself information about another tenant's data.
      throw new ClaimValidationError('claim not found');
    }
    if (original.status !== 'active') {
      throw new ClaimValidationError(`claim is ${original.status}, not active — nothing to correct`);
    }

    const claimType = original.claimType as ClaimType;
    assertValid({
      tenantId: input.tenantId,
      scopeType: original.scopeType as ClaimScope,
      scopeId: original.scopeId,
      claimType,
      claimText: input.claimText,
      sourceType: input.sourceType ?? original.sourceType,
      confidence: input.confidence ?? original.confidence,
      createdByType: input.createdByType,
    });

    await tx.commercialClaim.update({
      where: { id: original.id },
      data: { status: 'superseded' },
    });

    return tx.commercialClaim.create({
      data: {
        tenantId: input.tenantId,
        scopeType: original.scopeType,
        scopeId: original.scopeId,
        claimType: original.claimType,
        claimText: input.claimText.trim(),
        sourceType: input.sourceType ?? original.sourceType,
        sourceId: input.sourceId ?? original.sourceId,
        sourceObservedAt: original.sourceObservedAt,
        confidence: input.confidence ?? original.confidence,
        createdByType: input.createdByType,
        createdById: input.createdById ?? null,
        supersedesId: original.id,
        correctionReason: input.correctionReason.trim(),
        expiresAt: defaultExpiry(claimType, now),
        status: 'active',
        createdAt: now,
      },
    });
  });
}

/**
 * Marks lapsed claims `expired`.
 *
 * Reads already exclude them by date, so this changes no answer — it keeps `status` honest for
 * anyone querying the table directly, and bounds the active set. Returns the count changed.
 */
export async function expireLapsedClaims(params: { tenantId: string; now?: Date }): Promise<number> {
  if (!params.tenantId) throw new ClaimValidationError('tenantId is required');
  const now = params.now ?? new Date();

  const result = await prisma.commercialClaim.updateMany({
    where: { tenantId: params.tenantId, status: 'active', expiresAt: { lte: now } },
    data: { status: 'expired' },
  });
  return result.count;
}

/** Withdraws a claim without asserting a replacement. */
export async function retractClaim(params: {
  tenantId: string;
  claimId: string;
  reason: string;
}): Promise<void> {
  if (!params.reason.trim()) throw new ClaimValidationError('a retraction requires a reason');

  const updated = await prisma.commercialClaim.updateMany({
    where: { id: params.claimId, tenantId: params.tenantId, status: 'active' },
    data: { status: 'retracted', correctionReason: params.reason.trim() },
  });
  if (updated.count === 0) throw new ClaimValidationError('claim not found');
}
