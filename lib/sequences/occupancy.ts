import type { SequenceEnrollmentStatus } from '@prisma/client';

/**
 * The enrollment occupancy invariant (Revenue AI Phase 8a).
 *
 * ```text
 * active     → occupancyKey = "<tenantId>:<leadId>"
 * paused     → occupancyKey = "<tenantId>:<leadId>"
 * completed  → occupancyKey = null
 * unenrolled → occupancyKey = null
 * ```
 *
 * A unique index on `occupancyKey` then makes "one occupying enrollment per lead" a database
 * fact rather than a convention every writer has to remember. PostgreSQL's normal UNIQUE
 * semantics allow any number of NULLs, so terminal rows pile up freely — no partial index, and
 * therefore no drift between what Prisma describes and what the migration creates.
 *
 * **The clear must happen in the same statement as the terminal status.** A crash between
 * `status = 'unenrolled'` and `occupancyKey = null` would leave the lead occupied by a dead
 * enrollment forever, and nothing would ever be able to enrol it again.
 */

export const OCCUPYING_STATUSES: readonly SequenceEnrollmentStatus[] = ['active', 'paused'];

export function occupancyKeyFor(tenantId: string, leadId: string): string {
  return `${tenantId}:${leadId}`;
}

/** True when this status must hold the lead's occupancy. */
export function statusOccupies(status: SequenceEnrollmentStatus): boolean {
  return OCCUPYING_STATUSES.includes(status);
}

/**
 * Spread into any update that moves an enrollment to a terminal status.
 *
 * ```ts
 * data: { status: 'unenrolled', completedAt: new Date(), ...releaseOccupancy() }
 * ```
 */
export function releaseOccupancy(): { occupancyKey: null } {
  return { occupancyKey: null };
}

/** The occupancy value for a status, for writers that set both at once. */
export function occupancyFor(
  status: SequenceEnrollmentStatus,
  tenantId: string,
  leadId: string
): string | null {
  return statusOccupies(status) ? occupancyKeyFor(tenantId, leadId) : null;
}
