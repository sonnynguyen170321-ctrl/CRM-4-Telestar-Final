import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The defect ledger must agree with the defects it summarises.
 *
 * On 2026-08-22 it did not, in every column: it read `discovered 56 · verified closed 19 ·
 * reopened 7 · active 37` while the file contained `53 · 11 · 8 · 33`. The error compounded
 * because figures were incremented as defects were added without re-deriving the base — so the
 * headline number of open defects, the one every release decision is judged against, was never
 * something anyone had counted.
 *
 * The first version of this test caught that by parsing DEFECTS.md the way a reader would, and
 * re-deriving the counts from the prose. That is now the wrong shape, in two ways.
 *
 * DEFECTS.md is **generated** from `defects.json`, which is the authoritative defect state. A
 * test that re-derives truth by parsing the generated prose treats the rendering as a database:
 * it can only ever say the document agrees with itself, and it goes stale the moment the
 * generator's layout changes — which is exactly what happened. It kept asserting against
 * `## 3. Reopened Defects` and `## 4. Retained Verified Defects`, sections the generator does
 * not emit, so it failed with `expected 0 to be greater than 0` while nothing was wrong with
 * the ledger.
 *
 * What is worth testing is the property the original bug actually violated: that the published
 * numbers are the numbers in the authoritative source. So this reads `defects.json`, derives
 * the counts itself, and holds the rendered document to them.
 */

const CERT_DIR = join(process.cwd(), 'docs', 'production-certification');
const md = readFileSync(join(CERT_DIR, 'DEFECTS.md'), 'utf8');
const ledger = JSON.parse(readFileSync(join(CERT_DIR, 'defects.json'), 'utf8'));

type Defect = {
  id: string;
  severity: string;
  state: string;
  title: string;
};

const defects: Defect[] = ledger.defects;

/** PROTOCOL.md defines the lifecycle; anything else is a synonym some counter will not recognise. */
const LIFECYCLE = ['OPEN', 'IN_PROGRESS', 'FIXED_PENDING_VERIFICATION', 'VERIFIED', 'ACCEPTED_RISK'];
const ACTIVE_STATES = ['OPEN', 'IN_PROGRESS', 'FIXED_PENDING_VERIFICATION'];

function bySeverity(severity: string): Defect[] {
  return defects.filter((d) => d.severity === severity);
}

/** The declared summary row for a severity: [discovered, verifiedClosed, acceptedRisk, active]. */
function summaryRow(severity: string): number[] {
  const re = new RegExp(`\\|\\s*\\*\\*${severity}\\*\\*[^|]*\\|([^|]+)\\|([^|]+)\\|([^|]+)\\|([^|]+)\\|`);
  const m = md.match(re);
  if (!m) throw new Error(`no summary row for ${severity}`);
  return m.slice(1, 5).map((cell) => Number(cell.replace(/\*\*|\s/g, '')));
}

/** Every `### \`ID\` — title` heading the rendered ledger publishes. */
function renderedIds(): string[] {
  return [...md.matchAll(/^### `([A-Z0-9-]+)` — /gm)].map((m) => m[1]);
}

describe('defects.json is a well-formed authoritative ledger', () => {
  it('holds defects at all', () => {
    expect(defects.length).toBeGreaterThan(0);
  });

  it('gives every defect a unique id', () => {
    const seen = new Set<string>();
    const duplicates = defects.filter((d) => (seen.has(d.id) ? true : (seen.add(d.id), false)));
    expect(duplicates.map((d) => d.id)).toEqual([]);
  });

  it('gives every defect a severity, a state and a title', () => {
    const malformed = defects.filter((d) => !d.severity || !d.state || !d.title);
    expect(malformed.map((d) => d.id)).toEqual([]);
  });

  /**
   * A vocabulary nobody enforces grows synonyms, and each synonym is a state some counter does
   * not recognise. Two entries had drifted to `RESOLVED`, which reads as closed to a human and
   * is not closed to any tool: render-tracker.mjs counts everything that is not exactly
   * `VERIFIED` as open, so both were silently inflating the count they appeared to have left.
   */
  it('uses only states the protocol defines', () => {
    const offVocabulary = defects.filter((d) => !LIFECYCLE.includes(d.state)).map((d) => `${d.id}=${d.state}`);
    expect(offVocabulary, 'states outside PROTOCOL.md section on the defect lifecycle').toEqual([]);
  });

  /** Directive section 49: an accepted risk that records no reason is not an accepted risk. */
  it('gives every ACCEPTED_RISK defect a recorded rationale', () => {
    const undocumented = defects.filter((d) => d.state === 'ACCEPTED_RISK' && !(d as any).acceptedRisk);
    expect(undocumented.map((d) => d.id)).toEqual([]);
  });
});

describe('DEFECTS.md is a faithful rendering of defects.json', () => {
  it('names defects.json as the authoritative source', () => {
    // The document must not read as the database. Directive section 8: generate DEFECTS.md
    // from defects.json, and never parse it back into authoritative state.
    expect(md).toContain('docs/production-certification/defects.json');
  });

  it('publishes every defect in the authoritative ledger', () => {
    const rendered = new Set(renderedIds());
    const missing = defects.filter((d) => !rendered.has(d.id)).map((d) => d.id);
    expect(missing, 'defects present in defects.json but absent from DEFECTS.md').toEqual([]);
  });

  it('publishes no defect the authoritative ledger does not hold', () => {
    const known = new Set(defects.map((d) => d.id));
    const invented = renderedIds().filter((id) => !known.has(id));
    expect(invented, 'defects rendered into DEFECTS.md with no entry in defects.json').toEqual([]);
  });
});

describe('the summary table matches the defects it summarises', () => {
  for (const severity of ['P0', 'P1', 'P2', 'P3']) {
    describe(`${severity} row`, () => {
      const [declaredDiscovered, declaredVerified, declaredAccepted, declaredActive] = summaryRow(severity);
      const entries = bySeverity(severity);

      it('discovered matches the number of defects at this severity', () => {
        expect(declaredDiscovered).toBe(entries.length);
      });

      it('verified-closed counts only the VERIFIED terminal state', () => {
        expect(declaredVerified).toBe(entries.filter((d) => d.state === 'VERIFIED').length);
      });

      it('accepted-risk counts only ACCEPTED_RISK', () => {
        expect(declaredAccepted).toBe(entries.filter((d) => d.state === 'ACCEPTED_RISK').length);
      });

      /**
       * FIXED_PENDING_VERIFICATION is unresolved. Directive section 8 is explicit, and it is
       * the state most likely to be quietly counted as closed because the work feels done.
       */
      it('active counts every unresolved state, FIXED_PENDING_VERIFICATION included', () => {
        expect(declaredActive).toBe(entries.filter((d) => ACTIVE_STATES.includes(d.state)).length);
      });

      it('accounts for every defect in exactly one bucket', () => {
        expect(declaredDiscovered).toBe(declaredVerified + declaredAccepted + declaredActive);
      });
    });
  }

  it('the TOTAL row is the sum of the severity rows', () => {
    const totals = summaryRow('TOTAL');
    const sums = ['P0', 'P1', 'P2', 'P3']
      .map(summaryRow)
      .reduce((acc, row) => acc.map((value, index) => value + row[index]), [0, 0, 0, 0]);
    expect(totals).toEqual(sums);
  });

  it('the TOTAL discovered figure is the size of the authoritative ledger', () => {
    expect(summaryRow('TOTAL')[0]).toBe(defects.length);
  });
});
