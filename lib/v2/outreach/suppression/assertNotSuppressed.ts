import {
  decideSuppression,
  redactEmail,
  type SuppressionCandidateRow,
  type SuppressionMatch,
} from "./decideSuppression";
import { extractDomainIdentifier, normalizeEmailIdentifier } from "./normalizeIdentifier";

// O2: the suppression gate — the single chokepoint before any send (Invariant 10,
// design B5). `assertNotSuppressed` is the ONLY place that mints a GatePassToken;
// the provider send boundary (O3) requires one, so no code path can reach SMTP
// without passing this gate. Suppressed identifiers throw before any provider call;
// the block is logged redacted (no full email — Invariant 9).

// Module-private brand: a valid GatePassToken can only be created inside this file.
const GATE_BRAND: unique symbol = Symbol("v2.outreach.suppression.gatePass");

export type GatePassToken = {
  readonly [GATE_BRAND]: true;
  readonly organizationId: string;
  readonly toAddressRedacted: string;
  readonly checkedAt: Date;
};

export class SuppressedError extends Error {
  readonly code = "SUPPRESSED";
  readonly match: SuppressionMatch;
  readonly organizationId: string;
  readonly toAddressRedacted: string;

  constructor(organizationId: string, email: string | null | undefined, match: SuppressionMatch) {
    super(
      `Send blocked by suppression (${match.suppressionType} on ${match.matchedOn}) for ${redactEmail(email)}`
    );
    this.name = "SuppressedError";
    this.match = match;
    this.organizationId = organizationId;
    this.toAddressRedacted = redactEmail(email);
  }
}

export type LoadSuppressionCandidates = (input: {
  organizationId: string;
  email: string;
  domain: string | null;
}) => Promise<SuppressionCandidateRow[]>;

async function defaultLoadCandidates(input: {
  organizationId: string;
  email: string;
  domain: string | null;
}): Promise<SuppressionCandidateRow[]> {
  const { prisma } = await import("@/lib/server/prisma");
  const rows = await prisma.v2SuppressionEntry.findMany({
    where: {
      organizationId: input.organizationId,
      deletedAt: null,
      OR: [
        { identifierType: "EMAIL", identifierValueNormalized: input.email },
        ...(input.domain
          ? [{ identifierType: "DOMAIN" as const, identifierValueNormalized: input.domain }]
          : []),
      ],
    },
    select: {
      id: true,
      identifierType: true,
      identifierValueNormalized: true,
      suppressionType: true,
      scopeType: true,
      deletedAt: true,
      expiresAt: true,
    },
  });
  return rows as unknown as SuppressionCandidateRow[];
}

export type AssertNotSuppressedInput = {
  organizationId: string;
  email: string | null | undefined;
  now?: Date;
  // Injectable for tests; defaults to the tenant-scoped prisma query.
  loadCandidates?: LoadSuppressionCandidates;
  // Injectable redacted-block sink; defaults to console.warn.
  onBlocked?: (event: { organizationId: string; toAddressRedacted: string; match: SuppressionMatch }) => void;
};

/**
 * Throws SuppressedError if the email is suppressed for this org; otherwise mints
 * and returns a GatePassToken that the provider send boundary requires. ALWAYS
 * call this synchronously immediately before handing a message to the provider.
 */
export async function assertNotSuppressed(input: AssertNotSuppressedInput): Promise<GatePassToken> {
  const email = normalizeEmailIdentifier(input.email);
  const domain = extractDomainIdentifier(input.email);
  const now = input.now ?? new Date();

  if (!email) {
    // No deliverable address is itself a block — never "send to nothing".
    const match: SuppressionMatch = {
      entryId: "no-address",
      identifierType: "EMAIL",
      suppressionType: "MANUAL",
      matchedOn: "email",
    };
    emitBlocked(input, { organizationId: input.organizationId, toAddressRedacted: redactEmail(input.email), match });
    throw new SuppressedError(input.organizationId, input.email, match);
  }

  const load = input.loadCandidates ?? defaultLoadCandidates;
  const candidates = await load({ organizationId: input.organizationId, email, domain });
  const match = decideSuppression(candidates, { email, now });

  if (match) {
    emitBlocked(input, {
      organizationId: input.organizationId,
      toAddressRedacted: redactEmail(input.email),
      match,
    });
    throw new SuppressedError(input.organizationId, input.email, match);
  }

  return {
    [GATE_BRAND]: true,
    organizationId: input.organizationId,
    toAddressRedacted: redactEmail(input.email),
    checkedAt: now,
  };
}

function emitBlocked(
  input: AssertNotSuppressedInput,
  event: { organizationId: string; toAddressRedacted: string; match: SuppressionMatch }
): void {
  if (input.onBlocked) {
    input.onBlocked(event);
    return;
  }
  // Redacted by construction — never logs the full email or any secret.
  console.warn(
    `[v2.outreach.suppression] BLOCKED org=${event.organizationId} to=${event.toAddressRedacted} type=${event.match.suppressionType} on=${event.match.matchedOn}`
  );
}

/** Type guard the provider boundary uses to confirm a real gate token was passed. */
export function isGatePassToken(value: unknown): value is GatePassToken {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[GATE_BRAND] === true;
}
