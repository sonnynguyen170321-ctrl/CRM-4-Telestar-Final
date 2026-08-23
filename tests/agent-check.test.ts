import { describe, it, expect } from 'vitest';

import { runChecks, checksExitCode, isStatusDocument } from '@/scripts/agent/check';

/**
 * The project-truth gate (§LIV).
 *
 * These assert the repository is currently consistent — and, just as importantly, that each
 * check is capable of failing. A gate that cannot fail is decoration, and three of the six
 * here were decoration on their first run: they reported false positives for correct relative
 * links, for a document naming a retired term in order to reject it, and for a glob whose
 * literal prefix ends mid-segment.
 */

describe('project truth', () => {
  it('passes on the current tree', async () => {
    const results = await runChecks();
    const failed = results.filter((r) => !r.ok);
    expect(
      failed.map((f) => `${f.id}: ${f.findings.join('; ')}`),
      'project-truth checks failed — run `npm run agent -- check`',
    ).toEqual([]);
    expect(checksExitCode(results)).toBe(0);
  });

  it('runs every check it claims to', async () => {
    const ids = (await runChecks()).map((r) => r.id).sort();
    expect(ids).toEqual([
      'context-budget',
      'dead-references',
      'document-classification',
      'generated-facts',
      'memory-hygiene',
      'registry-integrity',
      'stale-architecture-language',
    ]);
  });

  it('reports a finding for every failure, so a red gate is actionable', async () => {
    for (const result of await runChecks()) {
      if (result.ok) continue;
      expect(result.findings.length, `${result.id} failed without saying why`).toBeGreaterThan(0);
    }
  });
});

/**
 * The classification gate had a filename allowlist, and it was too narrow to see the documents
 * most likely to go stale.
 *
 * It matched only `STATUS.md` and `RESUME_HERE.md`. So `final-hardening/CURRENT_STATE.md` —
 * a file whose entire title is a claim to be current — carried no classification at all while
 * asserting `OPEN P0: 0`, `OPEN P1: 0`, a branch that had since been deleted, and a Cloud SQL
 * RPO figure that had never been measured. `LIVE_RELEASE_STATE.md`, `MASTER_TRACKER.md` and
 * `FINAL_CERTIFICATE.md` were equally invisible.
 *
 * A gate that cannot see the failure it exists to prevent is decoration. These pin the scope.
 */
describe('status-document detection', () => {
  it('sees the state documents that actually go stale', () => {
    for (const name of [
      'STATUS.md',
      'RESUME_HERE.md',
      'CURRENT_STATE.md',
      'LIVE_RELEASE_STATE.md',
      'RESOURCE_STATE.md',
      'MASTER_TRACKER.md',
      'FINAL_CERTIFICATE.md',
      'BLOCKERS.md',
    ]) {
      expect(isStatusDocument(`docs/production-certification/${name}`), name).toBe(true);
    }
  });

  it('leaves reference and ledger documents alone', () => {
    // These are not claims about "where the release is now", so requiring a currency stamp on
    // them would be noise — and noise is how a gate gets ignored.
    for (const name of ['PROTOCOL.md', 'DEFECTS.md', 'ROLE_MATRIX.md', 'README.md']) {
      expect(isStatusDocument(`docs/production-certification/${name}`), name).toBe(false);
    }
  });
});
