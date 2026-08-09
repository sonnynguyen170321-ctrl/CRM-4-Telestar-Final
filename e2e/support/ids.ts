import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Unique suffixes and passwords for disposable test data.
 *
 * These used to be built from `Math.random()`. CodeQL flagged six of them under
 * `js/insecure-randomness`, and it was right: every flagged line fed a **password** for an
 * account the specs then create — `pw-audit-xfer-${s}`, `pw-audit-member-${s}`,
 * `pw-audit-kpi-${s}`. "It is only a test account" is not an answer, because those are real
 * rows in a real database that can really sign in.
 *
 * `Math.random()` is seeded per process and its output is predictable from previous values, so
 * a credential derived from it is guessable by anyone who can observe one. A CSPRNG costs
 * nothing here.
 */

/** A collision-resistant suffix for names, emails and ids. Not a secret. */
export function uniqueSuffix(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

/**
 * A password for a disposable account. 24 random bytes, hex-encoded.
 *
 * Deliberately not derived from `E2E_PASSWORD`: these accounts are created and deactivated
 * within a single test, and giving them their own unrelated secret means a leaked fixture
 * password reveals nothing about the audit's own credentials.
 */
export function disposablePassword(): string {
  return `pw-audit-${randomBytes(24).toString('hex')}`;
}
