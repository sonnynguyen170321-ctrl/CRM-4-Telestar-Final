import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The merge gate is a shell `require` table inside `CI required checks`, and nothing tested it.
 *
 * Its shape is deliberately asymmetric: repository-owned gates must be `success`, while the
 * platform scanners were allowed to be `failure` on the reasoning that CodeQL needs a GitHub
 * capability this plan might not grant. That reasoning was checkable, and it turned out not to
 * hold — CodeQL runs and succeeds here, on three consecutive `main` runs (f966d0d, 12ea8ae,
 * fa3a54b). With the capability demonstrably present, accepting `failure` means a genuine CodeQL
 * security finding merges silently. PR #93 was sitting at CodeQL=FAILURE when this was written.
 *
 * These tests pin the table so that loosening it has to be deliberate rather than incidental.
 */

const WORKFLOW = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8');

/** Returns the results a given job is allowed to produce, per the `require` table. */
function allowedResults(label: string): string[] {
  const match = WORKFLOW.match(
    // The variable class must include digits: the e2e job reads `"$E2E"`.
    new RegExp(String.raw`require\s+"${label}"\s+"\$[A-Z0-9_]+"\s+([a-z ]+)`),
  );
  if (!match) return [];
  return match[1].trim().split(/\s+/);
}

describe('CI required checks — the merge gate', () => {
  it('demands success from every repository-owned gate', () => {
    // These run repo-owned tooling on every event and every plan. There is no legitimate
    // reason for any of them to produce anything but success on a mergeable commit.
    for (const label of [
      'quality',
      'migrations',
      'e2e',
      'docker',
      'secret-scan',
      'dependency-audit',
    ]) {
      expect(allowedResults(label), `${label} allowances`).toEqual(['success']);
    }
  });

  it('keeps the mandatory dependency-security gate strict', () => {
    // npm audit --audit-level=high is the mandatory dependency gate precisely because it is
    // repo-owned and plan-independent. Softening it would leave dependency security resting on
    // Dependency Review, which does not run on push at all.
    expect(allowedResults('dependency-audit')).toEqual(['success']);
  });

  it('does not accept a CodeQL failure', () => {
    const allowed = allowedResults('codeql');
    expect(allowed.length).toBeGreaterThan(0);
    // `skipped` stays acceptable: forks and path filters legitimately produce it.
    // `failure` does not: on this repository CodeQL runs, so a failure is a finding.
    expect(allowed).not.toContain('failure');
    expect(allowed).toContain('success');
  });

  it('never lets a gate pass through continue-on-error or || true', () => {
    // Named explicitly in the production rules as the forbidden way to make a gate green.
    const gateSection = WORKFLOW.slice(WORKFLOW.indexOf('CI required checks'));
    expect(gateSection).not.toMatch(/continue-on-error:\s*true/);
    expect(gateSection).not.toMatch(/\|\|\s*true/);
  });

  it('still fails the job when any requirement was not met', () => {
    // The table only records findings; this is the line that turns them into a red check.
    expect(WORKFLOW).toMatch(/if \[ "\$failed" -ne 0 \]/);
    expect(WORKFLOW).toMatch(/exit 1/);
  });

  it('runs even when an upstream job failed, so the gate cannot be skipped into green', () => {
    // Without `if: always()` a failed dependency would leave the aggregate skipped, and a
    // skipped required check is not a failed one.
    const gateSection = WORKFLOW.slice(WORKFLOW.indexOf('CI required checks'));
    expect(gateSection.slice(0, 400)).toMatch(/if:\s*always\(\)/);
  });
});
