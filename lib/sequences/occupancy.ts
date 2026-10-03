import type { SequenceEnrollmentStatus } from '@prisma/client';

/**
 * The enrollment occupancy invariant (Revenue AI Phase 8a, widened 2026-10-03).
 *
 * ```text
 * active     → occupancyKey = "<tenantId>:<leadId>:<sequenceId>"
 * paused     → occupancyKey = "<tenantId>:<leadId>:<sequenceId>"
 * completed  → occupancyKey = null
 * unenrolled → occupancyKey = null
 * ```
 *
 * A unique index on `occupancyKey` makes "one occupying enrollment per lead **per sequence**" a
 * database fact rather than a convention every writer has to remember. PostgreSQL's normal UNIQUE
 * semantics allow any number of NULLs, so terminal rows pile up freely.
 *
 * It used to be one per lead. The owner decided (2026-10-02) that a lead may run any number of
 * sequences at once — a LinkedIn cadence beside an email one, or two SDRs' cadences on the same
 * prospect. What the key still forbids is the same sequence twice on one lead, which would send
 * every step twice. What it can no longer guarantee by itself is that a reply stops *every*
 * cadence — that is `lib/sequences/leadStop.ts`, and every reply, bounce, unsubscribe and booked
 * meeting goes through it.
 *
 * **The clear must happen in the same statement as the terminal status.** A crash between
 * `status = 'unenrolled'` and `occupancyKey = null` would leave the lead occupied by a dead
 * enrollment forever, and nothing would ever be able to enrol it in that sequence again.
 */

export const OCCUPYING_STATUSES: readonly SequenceEnrollmentStatus[] = ['active', 'paused'];

export function occupancyKeyFor(tenantId: string, leadId: string, sequenceId: string): string {
  return `${tenantId}:${leadId}:${sequenceId}`;
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
  leadId: string,
  sequenceId: string
): string | null {
  return statusOccupies(status) ? occupancyKeyFor(tenantId, leadId, sequenceId) : null;
}
