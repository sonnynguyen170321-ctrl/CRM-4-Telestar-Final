/**
 * Deterministic jitter for send-time distribution (spec §10).
 *
 * Given a stable seed (tenantId + sequenceId + stepId + leadId) and a
 * window duration, produces a repeatable minute-offset so that:
 *   - Every lead lands at a different spot inside the send window
 *   - Rebuilding from DB state yields the same timestamp
 *   - No randomness involved
 */
import crypto from 'node:crypto';

/**
 * Produce a deterministic offset in minutes within [0, windowMinutes).
 *
 * Uses the first 4 bytes of a SHA-256 hash of the seed, read as a
 * 32-bit unsigned integer, modulo the window size. Uniform enough for
 * sub-hundred-recipient batches; perfectly repeatable.
 */
export function deterministicOffset(seed: string, windowMinutes: number): number {
  if (windowMinutes <= 0) return 0;
  const hash = crypto.createHash('sha256').update(seed).digest();
  const n = hash.readUInt32BE(0);
  return n % windowMinutes;
}

/**
 * Build the standard jitter seed from durable IDs.
 *
 * The caller should pass whichever IDs are available. Concatenation
 * order is fixed so the same inputs always produce the same seed.
 */
export function buildJitterSeed(parts: {
  tenantId?: string;
  sequenceId?: string;
  sequenceStepId?: string;
  leadId?: string;
}): string {
  return [
    parts.tenantId ?? '',
    parts.sequenceId ?? '',
    parts.sequenceStepId ?? '',
    parts.leadId ?? '',
  ].join(':');
}
