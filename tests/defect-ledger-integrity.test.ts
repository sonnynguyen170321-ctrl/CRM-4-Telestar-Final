import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * What a `VERIFIED` defect has to be able to show (directive §48).
 *
 * `tests/defect-ledger-consistency.test.ts` holds the rendered document to the ledger — that
 * the published counts are the counts in the authoritative source. This holds the ledger to
 * reality: that a closed defect names a root cause, an identifier that resolves to something
 * real, and a test result somebody actually observed.
 *
 * Three specific ways the ledger has lied, each now a test:
 *
 * 1. **Closure with nothing behind it.** Fifty-two of sixty-four entries sat in
 *    `FIXED_PENDING_VERIFICATION` with an empty `fixSha` and an empty `verificationEvidence`.
 *
 * 2. **A `fixSha` that is not a SHA.** Six entries carried a timestamp, a container id, a
 *    Cloud SQL backup id or a GitHub Actions run id in a field named `fixSha`. Each identifier
 *    was real and the remediation genuinely was not a commit — a rotated credential changes no
 *    source — but a field that sometimes means "commit" and sometimes means "something else"
 *    cannot be checked. `fixKind` now says which, and this test resolves the ones that claim
 *    to be commits.
 *
 * 3. **Closure against a commit that says it is partial.** `TEL-P1-038` was closed because
 *    `a3deba3` names it and `tests/rls.test.ts` passes. That commit reads *"Half of
 *    TEL-P1-038 … still the operator's and is untouched"*, and it is the commit that **renamed**
 *    that test to say it covers application-level scoping rather than RLS. `TEL-P0-005` was
 *    closed against a commit ending *"Remaining before VERIFIED: exercise through the real HTTP
 *    surface with a live SDR-minted key."* Both are reopened; this stops them closing again.
 */

const REPO_ROOT = process.cwd();
const LEDGER = path.join(REPO_ROOT, 'docs', 'production-certification', 'defects.json');

type Defect = {
  id: string;
  severity: string;
  state: string;
  title: string;
  rootCause: string;
  fixSha: string;
  fixKind?: string;
  fixReference?: string;
  partialFixDischargedBy?: string;
  verificationEvidence: string;
  acceptedRisk: string | null;
  owner: string;
};

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8')) as { defects: Defect[] };
const defects = ledger.defects;

const CLOSED = ['VERIFIED', 'ACCEPTED_RISK'];
const CRITICAL = ['P0', 'P1'];
const FIX_KINDS = ['commit', 'credential-rotation', 'container', 'cloudsql-backup', 'ci-run', 'infrastructure'];

/**
 * Signals a commit gives that it does not close what it names. Mirrors reconcile-defects.mjs.
 *
 * A bare `untouched` was on this list and had to come off. `99f6b8d` fixed TEL-P1-022 in full
 * and its message reads "ordinary activities — dozens of email_sent rows on one lead — are
 * untouched, while a keyed write is guaranteed once by the database". That describes the blast
 * radius of the fix, not work left undone, and the guard blocked a legitimate closure.
 *
 * Removing it costs nothing: `a3deba3`, the commit the word was added for, is still matched by
 * `half of` and by `still the operator`, and the case below asserts exactly that so this cannot
 * silently stop catching it. A signal that fires on the wrong sentence is worse than one fewer
 * signal — it teaches the reader to override the guard.
 */
const INCOMPLETE_SIGNALS = [
  /remaining before verified/i,
  /\bhalf of\b/i,
  /\bpart of (?:TEL|DEPLOY)-/i,
  /still the operator/i,
  /does not close/i,
  /remains? open/i,
  /not yet verified/i,
  /independent verification required/i,
  /still needs/i,
];

/**
 * These assertions need real history.
 *
 * The first version of this suite failed in CI, reporting 39 genuine commits as "not a
 * commit", because the quality job checked out at depth 100 and the deepest reference is 261
 * commits behind main. The second version skipped those assertions on a shallow clone, which
 * this repository forbids for exactly the right reason: a check that skips is a check that
 * quietly stopped running, and `No test was skipped` failed the build.
 *
 * The repair belongs in CI, not here — the quality job now fetches full history (762 commits),
 * so these run everywhere and nothing is conditional. A shallow clone will fail them, and the
 * message says why.
 */
function resolvesToCommit(ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * A commit message, with inline code spans removed.
 *
 * A signal inside backticks is being *named*, not asserted. The commit that narrowed this very
 * list said "a3deba3 … is still matched by `half of` and `still the operator`" — prose about
 * the guard, which the guard then matched, blocking a closure that had nothing to do with a
 * partial fix. Quoting a pattern must not trip it.
 */
function commitMessage(ref: string): string {
  try {
    const raw = execFileSync('git', ['show', '--format=%s%n%b', '--no-patch', ref], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    return raw.replace(/`[^`\n]*`/g, ' ');
  } catch {
    return '';
  }
}

const closedCritical = defects.filter((d) => CLOSED.includes(d.state) && CRITICAL.includes(d.severity));

describe('a closed P0 or P1 can show its work (§48)', () => {
  it('there are closed critical defects to check, so these assertions are not vacuous', () => {
    expect(closedCritical.length).toBeGreaterThan(0);
  });

  it.each(CLOSED)('every %s critical defect names a root cause', (state) => {
    const offenders = defects
      .filter((d) => d.state === state && CRITICAL.includes(d.severity))
      .filter((d) => !d.rootCause || d.rootCause.trim().length < 20)
      .map((d) => d.id);
    expect(offenders, `closed with no root cause: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every VERIFIED critical defect names what fixed it', () => {
    // A commit SHA, or — where the remediation genuinely was not a commit — the kind of thing
    // it was and its identifier. `TEL-P1-027` was closed by enabling point-in-time recovery on
    // the Cloud SQL instance: that changed no source, and inventing a SHA for it would be a
    // worse record than admitting there is none.
    const offenders = defects
      .filter((d) => d.state === 'VERIFIED' && CRITICAL.includes(d.severity))
      .filter((d) => {
        const hasSha = Boolean(d.fixSha && d.fixSha.trim());
        const hasNonCommitReference =
          Boolean(d.fixKind) && d.fixKind !== 'commit' && Boolean(d.fixReference && d.fixReference.trim());
        return !hasSha && !hasNonCommitReference;
      })
      .map((d) => d.id);
    expect(offenders, `VERIFIED with no fix reference: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every VERIFIED critical defect carries an observed test result, not an empty string', () => {
    const offenders = defects
      .filter((d) => d.state === 'VERIFIED' && CRITICAL.includes(d.severity))
      .filter((d) => !d.verificationEvidence || d.verificationEvidence.trim().length < 20)
      .map((d) => d.id);
    expect(offenders, `VERIFIED with no evidence: ${offenders.join(', ')}`).toEqual([]);
  });

  it('an ACCEPTED_RISK defect records who accepted it and why', () => {
    const offenders = defects
      .filter((d) => d.state === 'ACCEPTED_RISK')
      .filter((d) => !d.acceptedRisk || d.acceptedRisk.trim().length < 20)
      .map((d) => d.id);
    expect(offenders, `accepted with no stated rationale: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('a fix reference resolves to something real', () => {
  it('every defect with a fixSha declares what kind of thing it is', () => {
    const offenders = defects.filter((d) => d.fixSha && !d.fixKind).map((d) => d.id);
    expect(offenders, `fixSha with no fixKind: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every fixKind is one the ledger recognises', () => {
    const offenders = defects
      .filter((d) => d.fixKind && !FIX_KINDS.includes(d.fixKind))
      .map((d) => `${d.id}=${d.fixKind}`);
    expect(offenders, `unrecognised fixKind: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every fixKind "commit" is at least shaped like one', () => {
    // The check the ledger never had: six entries claimed to be SHAs and were a timestamp,
    // a container id, a backup id and three workflow run ids. None of those match this, and
    // it holds on a shallow clone where resolution cannot be attempted.
    const offenders = defects
      .filter((d) => d.fixKind === 'commit' && d.fixSha)
      .filter((d) => !/^[0-9a-f]{7,40}$/.test(d.fixSha))
      .map((d) => `${d.id}=${d.fixSha}`);
    expect(offenders, `fixKind "commit" that is not a SHA: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every fixKind "commit" resolves to a commit in this repository', () => {
    const offenders = defects
      .filter((d) => d.fixKind === 'commit' && d.fixSha)
      .filter((d) => !resolvesToCommit(d.fixSha))
      .map((d) => `${d.id}=${d.fixSha}`);
    expect(offenders, `fixKind "commit" that is not a commit: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every non-commit remediation says what the identifier is', () => {
    const offenders = defects
      .filter((d) => d.fixKind && d.fixKind !== 'commit')
      .filter((d) => !d.fixReference || d.fixReference.trim().length < 20)
      .map((d) => d.id);
    expect(offenders, `non-commit fix with no explanation: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('no defect is closed against a commit that says it is partial', () => {
  it('finds no VERIFIED defect whose own fix commit declares work remaining', () => {
    // A commit saying "Remaining before VERIFIED: …" describes the moment it was written, and
    // the remainder can genuinely be supplied later. What must not happen is the defect closing
    // while nobody says where. So the rule is not "never close against such a commit" — it is
    // "never close against one silently": `partialFixDischargedBy` has to name the work that
    // supplied the remainder, in the ledger, where a reader will find it.
    const offenders: string[] = [];
    for (const defect of defects) {
      if (defect.state !== 'VERIFIED') continue;
      if (defect.fixKind !== 'commit' || !defect.fixSha) continue;
      const message = commitMessage(defect.fixSha);
      for (const pattern of INCOMPLETE_SIGNALS) {
        const match = message.match(pattern);
        if (!match) continue;
        if ((defect.partialFixDischargedBy ?? '').trim().length < 20) {
          offenders.push(
            `${defect.id} (${defect.fixSha.slice(0, 7)} says "${match[0]}") — ` +
              'no partialFixDischargedBy naming what supplied the remainder'
          );
        }
        break;
      }
    }
    expect(offenders, `closed against a self-declared partial fix:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('a discharged partial fix names evidence, not a promise', () => {
    // The escape hatch must not become a comment box: whatever discharged the remainder has to
    // point at something runnable or something committed.
    for (const defect of defects.filter((d) => (d.partialFixDischargedBy ?? '').trim())) {
      expect(
        /tests\/[\w.-]+\.test\.ts|\b[0-9a-f]{7,40}\b/.test(defect.partialFixDischargedBy!),
        `${defect.id}: partialFixDischargedBy names no test file and no commit`
      ).toBe(true);
    }
  });

  it('still recognises the two commits that state their own limits', () => {
    // If the signal list stopped matching, the test above would pass for the wrong reason.
    expect(commitMessage('a3deba3')).toMatch(/half of/i);
    expect(commitMessage('1d41ea1')).toMatch(/remaining before verified/i);
  });
});

describe('the ledger is internally well formed', () => {
  const LIFECYCLE = ['OPEN', 'IN_PROGRESS', 'FIXED_PENDING_VERIFICATION', 'VERIFIED', 'ACCEPTED_RISK'];

  it('every defect carries a state the protocol defines', () => {
    const offenders = defects.filter((d) => !LIFECYCLE.includes(d.state)).map((d) => `${d.id}=${d.state}`);
    expect(offenders).toEqual([]);
  });

  it('every defect id is unique', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const d of defects) {
      if (seen.has(d.id)) duplicates.push(d.id);
      seen.add(d.id);
    }
    expect(duplicates).toEqual([]);
  });

  it('every severity is one the risk policy uses', () => {
    const offenders = defects.filter((d) => !['P0', 'P1', 'P2'].includes(d.severity)).map((d) => d.id);
    expect(offenders).toEqual([]);
  });
});
