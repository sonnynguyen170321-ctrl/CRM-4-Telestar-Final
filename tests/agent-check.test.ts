import { describe, it, expect } from 'vitest';

import { runChecks, checksExitCode } from '@/scripts/agent/check';

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
