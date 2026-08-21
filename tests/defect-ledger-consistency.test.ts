import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The defect summary table must agree with the defects it summarises.
 *
 * On 2026-08-22 it did not, in every column: it read `discovered 56 · verified closed 19 ·
 * reopened 7 · active 37` while the file contained `53 · 11 · 8 · 33`. The error compounded
 * because figures were incremented as defects were added without re-deriving the base — so the
 * headline number of open defects, the one every release decision is judged against, was never
 * something anyone had counted.
 *
 * This parses the document the way a reader would and refuses the mismatch.
 */

const LEDGER = join(process.cwd(), 'docs', 'production-certification', 'DEFECTS.md');
const md = readFileSync(LEDGER, 'utf8');

type Entry = { id: string; severity: string; status: string };

/** Section 2 entries: a `### \`ID\` — title` heading plus its Severity and Status lines. */
function activeEntries(): Entry[] {
  const start = md.indexOf('## 2. Active Defects');
  const end = md.indexOf('## 3. Reopened Defects');
  const body = md.slice(start, end > start ? end : undefined);
  const out: Entry[] = [];
  const re = /^### `([A-Z0-9-]+)` — .+$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const window = body.slice(m.index, m.index + 900);
    const severity = window.match(/\*\*Severity\*\*:\s*(P\d)/)?.[1] ?? '?';
    const status = window.match(/\*\*Status\*\*:\s*`?([A-Z_]+)`?/)?.[1] ?? '?';
    out.push({ id: m[1], severity, status });
  }
  return out;
}

/**
 * Every defect id named in the FIRST cell of each row of a table, ranges expanded.
 *
 * Both details are load-bearing, and both were got wrong before:
 *
 * - **Ranges.** Section 4 carries `` `TEL-P2-001`–`TEL-P2-007` `` — seven closures on one line.
 *   Counting rows instead of ids dropped six of them and produced a "correction" to the summary
 *   table that was further from the truth than the figure it replaced.
 * - **First cell only.** Section 3 lists a *successor* id alongside each reopened one, so
 *   scanning whole rows counted every reopening twice, reporting 17 where there are 8.
 *
 * A parser that mis-reads is worse than none: it disagrees with the document while looking
 * authoritative.
 */
function expandIds(cell: string): string[] {
  const ids = new Set<string>();
  for (const m of cell.matchAll(/`([A-Z]+-P\d)-(\d+)`[–-]`([A-Z]+-P\d)-(\d+)`/g)) {
    if (m[1] === m[3]) {
      for (let i = Number(m[2]); i <= Number(m[4]); i += 1) {
        ids.add(`${m[1]}-${String(i).padStart(3, '0')}`);
      }
    }
  }
  for (const m of cell.matchAll(/`([A-Z]+-P\d-\d+)`/g)) ids.add(m[1]);
  return [...ids];
}

function tableIds(sectionHeading: string, nextHeading?: string): string[] {
  const start = md.indexOf(sectionHeading);
  if (start < 0) return [];
  const endIdx = nextHeading ? md.indexOf(nextHeading, start + sectionHeading.length) : -1;
  const body = md.slice(start, endIdx > start ? endIdx : undefined);

  const ids = new Set<string>();
  for (const row of body.matchAll(/^\|\s*`[^|]*\|/gm)) {
    const firstCell = row[0].match(/^\|\s*([^|]+)\|/)?.[1] ?? '';
    for (const id of expandIds(firstCell)) ids.add(id);
  }
  return [...ids];
}

/** The declared summary row for a severity: [discovered, verifiedClosed, reopened, active]. */
function summaryRow(severity: string): number[] {
  const re = new RegExp(
    `\\|\\s*\\*\\*${severity}\\*\\*[^|]*\\|([^|]+)\\|([^|]+)\\|([^|]+)\\|([^|]+)\\|`,
  );
  const m = md.match(re);
  if (!m) throw new Error(`no summary row for ${severity}`);
  return m.slice(1, 5).map((cell) => Number(cell.replace(/\*\*|\s/g, '')));
}

const active = activeEntries();
const reopened = tableIds('## 3. Reopened Defects', '## 4.');
// Section 4 is the last section, so it reads to end of file.
const verified = tableIds('## 4. Retained Verified Defects');

describe('the defect ledger parses at all', () => {
  it('finds active entries', () => {
    expect(active.length).toBeGreaterThan(0);
  });

  it('every active entry declares a severity and a status', () => {
    const malformed = active.filter((e) => e.severity === '?' || e.status === '?');
    expect(malformed.map((e) => e.id)).toEqual([]);
  });

  it('finds the reopened and retained-verified tables', () => {
    expect(reopened.length).toBeGreaterThan(0);
    expect(verified.length).toBeGreaterThan(0);
  });

  it('reads section 4 to the end of the file rather than truncating it', () => {
    // Regression on this file's own parser bug.
    expect(verified).toContain('TEL-P2-011');
  });

  it('expands a range row into every id it covers', () => {
    // `TEL-P2-001`–`TEL-P2-007` is seven closures on one line. Counting the row as one is what
    // made the first attempt at the summary table wrong.
    for (const n of ['001', '002', '003', '004', '005', '006', '007']) {
      expect(verified).toContain(`TEL-P2-${n}`);
    }
  });

  it('counts only the reopened id, not its successor', () => {
    // Section 3 names a successor per row; counting both reported 17 reopenings where there
    // are 8, and the successors are already active entries in their own right.
    expect(reopened).toContain('TEL-P1-009');
    expect(reopened).not.toContain('TEL-P1-018');
    expect(reopened.length).toBe(8);
  });
});

describe('the summary table matches the defects it summarises', () => {
  for (const severity of ['P0', 'P1', 'P2']) {
    describe(`${severity} row`, () => {
      const [declaredDiscovered, declaredVerified, declaredReopened, declaredActive] =
        summaryRow(severity);

      const entries = active.filter((e) => e.severity === severity);
      // A RESOLVED entry keeps its place in section 2 for the reasoning, but is not open work.
      const openEntries = entries.filter((e) => e.status !== 'RESOLVED');
      const resolvedEntries = entries.filter((e) => e.status === 'RESOLVED');
      const verifiedCount = verified.filter((id) => id.includes(`-${severity}-`)).length;
      const reopenedCount = reopened.filter((id) => id.includes(`-${severity}-`)).length;

      it('active count matches the entries', () => {
        expect(declaredActive).toBe(openEntries.length);
      });

      it('verified-closed count matches section 4', () => {
        expect(declaredVerified).toBe(verifiedCount);
      });

      it('reopened count matches section 3', () => {
        expect(declaredReopened).toBe(reopenedCount);
      });

      it('discovered accounts for every id, in exactly one bucket', () => {
        // The identity that was silently violated. `discovered` is not a free-floating tally:
        // every id is active, resolved-in-place, retained-verified, or reopened.
        expect(declaredDiscovered).toBe(
          openEntries.length + resolvedEntries.length + verifiedCount + reopenedCount,
        );
      });
    });
  }

  it('the TOTAL row is the sum of the severity rows', () => {
    const totals = summaryRow('TOTAL');
    const sums = ['P0', 'P1', 'P2']
      .map(summaryRow)
      .reduce((acc, row) => acc.map((v, i) => v + row[i]), [0, 0, 0, 0]);
    expect(totals).toEqual(sums);
  });
});

describe('defect ids are unique across the ledger', () => {
  it('no id appears twice in the active section', () => {
    const seen = new Map<string, number>();
    for (const e of active) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(duplicates).toEqual([]);
  });

  it('no id is both active and retained-verified', () => {
    // A defect cannot be open work and a closed one at the same time.
    const activeIds = new Set(active.map((e) => e.id));
    expect(verified.filter((id) => activeIds.has(id))).toEqual([]);
  });
});
