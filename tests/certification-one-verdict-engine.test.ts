import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * One verdict engine (directive §14, TEL-P1-043).
 *
 * `generate-certificate.mjs` and `render-tracker.mjs` both computed eligibility as
 *
 *     result.findings.filter((f) => f.check !== 'VERDICT_MISMATCH').length === 0
 *
 * §14 names that exact exclusion. `VERDICT_MISMATCH` fires when the generated documents
 * disagree with each other about the verdict — so with it filtered out, a certificate saying
 * GO while the tracker said NO-GO would have rendered, and the disagreement between them,
 * which is the loudest possible signal that the evidence is not being read consistently,
 * would have stopped blocking the release.
 *
 * The fix landed in `a317d15` and nothing guarded it. This is that guard. It is a source-level
 * property because that is where the defect lives: the renderers must take the validator's
 * verdict whole, and any re-derivation of eligibility from a *subset* of findings is the bug,
 * whichever check happens to be named in the filter.
 */

const REPO_ROOT = process.cwd();
const CERT_SCRIPTS = path.join(REPO_ROOT, 'scripts', 'certification');

const RENDERERS = ['generate-certificate.mjs', 'render-tracker.mjs'];

/** Comments removed — each file documents the removed filter, and prose is not code. */
function code(file: string): string {
  return readFileSync(path.join(CERT_SCRIPTS, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the renderers take the validator verdict whole (TEL-P1-043)', () => {
  it.each(RENDERERS)('%s reads eligibility from the validator, not from a filter', (file) => {
    const source = code(file);
    expect(source, `${file} must consume result.eligible`).toMatch(/result\.eligible/);
  });

  it.each(RENDERERS)('%s never excludes VERDICT_MISMATCH from anything it decides on', (file) => {
    const source = code(file);
    // The literal shape of the defect: a comparison against the check name.
    expect(source).not.toMatch(/check\s*!==\s*['"`]VERDICT_MISMATCH['"`]/);
    expect(source).not.toMatch(/['"`]VERDICT_MISMATCH['"`]\s*!==\s*/);
  });

  it.each(RENDERERS)('%s derives eligibility from no filtered subset of findings at all', (file) => {
    const source = code(file);
    // Broader than the specific check name: re-deriving eligibility by filtering findings is
    // the defect regardless of which check is excluded next time.
    const filteredEligibility =
      /(?:eligible|isEligible)\s*=\s*[^;]*findings\s*\.\s*filter\s*\([^)]*!==/;
    expect(source, `${file} re-derives eligibility from a filtered findings list`).not.toMatch(
      filteredEligibility
    );
  });

  it('the validator still emits VERDICT_MISMATCH, so there is something to not filter', () => {
    // If the check were deleted, every assertion above would pass vacuously.
    const consistency = readFileSync(path.join(CERT_SCRIPTS, 'lib', 'consistency.mjs'), 'utf8');
    const emissions = consistency.match(/finding\(\s*['"`]VERDICT_MISMATCH['"`]/g) ?? [];
    expect(emissions.length).toBeGreaterThanOrEqual(2);
  });

  it('there is one engine: every renderer imports the same validator', () => {
    // §14's claim is singular — not "the renderers agree", but that there is nothing for them
    // to disagree about. A second local implementation of eligibility is the same defect in a
    // new place, so what is asserted is the import, not the answer.
    for (const file of RENDERERS) {
      expect(code(file), `${file} must import the shared validator`).toMatch(
        /import\s*\{[^}]*validateCertification[^}]*\}\s*from\s*['"`]\.\/validate-certification\.mjs['"`]/
      );
    }
  });

  it('no renderer defines an eligibility rule of its own', () => {
    for (const file of RENDERERS) {
      const source = code(file);
      // `verdict` may be *derived* from the shared eligibility, but never computed from the
      // findings list a second time.
      expect(source, `${file} recomputes a verdict from findings`).not.toMatch(
        /verdict\s*=\s*[^;]*findings\s*\.\s*(?:filter|some|every)\s*\(/
      );
    }
  });
});
