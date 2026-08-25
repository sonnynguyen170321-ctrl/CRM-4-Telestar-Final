#!/usr/bin/env node
/**
 * Reconcile the defect ledger against the history that actually fixed it.
 *
 * `defects.json` is the authoritative defect state, and on 2026-08-25 fifty-two of its
 * sixty-four entries sat in `FIXED_PENDING_VERIFICATION` with an **empty `fixSha` and an
 * empty `verificationEvidence`**. A state that names neither the commit that fixed it nor
 * the test that proves it is not a claim anyone can check — it is a claim shaped like one.
 *
 * The rule this enforces (directive §48): a P0 or P1 may not be `VERIFIED` without a root
 * cause, an exact fix SHA, the specific test, and that test's actual result.
 *
 * What this script does NOT do is close anything. It proposes: for each defect it finds the
 * commits on `main` whose message names the defect id, picks the earliest one that is a fix
 * rather than a doc change, and reports the test files that commit touched. Whether those
 * tests actually pass is a separate question, answered by running them — which is the whole
 * point, and is why `--apply` records a proposal as `fixSha` + candidate evidence but never
 * moves a defect to `VERIFIED`. Only `--verify` does that, and only for defects whose named
 * tests it has just run and watched pass.
 *
 * Bulk-closing on a green suite is the failure this replaces. A broad green suite says the
 * repository works; it says nothing about whether a specific defect can recur.
 *
 * Usage:
 *   node scripts/certification/reconcile-defects.mjs             # report only
 *   node scripts/certification/reconcile-defects.mjs --apply     # record fixSha + candidate tests
 *   node scripts/certification/reconcile-defects.mjs --verify    # run the tests, then VERIFY what passed
 *   node scripts/certification/reconcile-defects.mjs --json
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import { DEFECT_LEDGER_PATH, REPO_ROOT } from './lib/paths.mjs';

const APPLY = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');
const JSON_OUT = process.argv.includes('--json');

/** Conventional-commit types that can carry a fix. A `docs:` commit records one; it is not one. */
const FIXING_TYPES = /^(fix|feat|perf|refactor|test|chore|ci|build)(\(|:)/;

/**
 * A commit that says its own fix is incomplete.
 *
 * The first version of this script closed `TEL-P1-038` — "Row-Level Security Does Not Exist,
 * In Production Or Anywhere" — because `a3deba3` names it and `tests/rls.test.ts` passes. That
 * commit's own message reads *"Half of TEL-P1-038 … the implementation decision, whether to add
 * RLS or accept application-only enforcement, is still the operator's and is untouched"*. It
 * corrected documentation. RLS still does not exist, and the test it ran was renamed **by that
 * commit** to say it tests application-level scoping instead.
 *
 * It closed `TEL-P0-005` the same way, against a commit ending *"Remaining before VERIFIED:
 * exercise through the real HTTP surface with a live SDR-minted key."*
 *
 * The author of a partial fix says so. Read it.
 */
const INCOMPLETE_SIGNALS = [
  /remaining before verified/i,
  /\bhalf of\b/i,
  /\bpart of (?:TEL|DEPLOY)-/i,
  /still the operator/i,
  /\buntouched\b/i,
  /does not close/i,
  /remains? open/i,
  /not yet verified/i,
  /independent verification required/i,
  /still needs/i,
];

/** The signal a commit gives that it does not close what it names, or null. */
function incompletenessSignal(sha) {
  const body = git(['show', '--format=%s%n%b', '--no-patch', sha]);
  for (const pattern of INCOMPLETE_SIGNALS) {
    const match = body.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return '';
  }
}

/** Commits on main naming this defect, oldest first — the fix precedes the paperwork. */
function commitsNaming(id) {
  const raw = git(['log', 'main', '--reverse', '--format=%H%x1f%s', `--grep=${id}`]);
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split('\x1f');
      return { sha, subject };
    });
}

/** Files a commit touched, excluding deletions — a deleted file proves nothing going forward. */
function filesIn(sha) {
  return git(['show', '--name-status', '--format=', sha])
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((p) => p.length > 1 && !p[0].startsWith('D'))
    .map((p) => p[p.length - 1]);
}

function proposalFor(defect) {
  const commits = commitsNaming(defect.id);
  if (commits.length === 0) {
    return { id: defect.id, severity: defect.severity, state: defect.state, status: 'NO_COMMIT', commits: [] };
  }

  const fixing = commits.filter((c) => FIXING_TYPES.test(c.subject) && !/^docs/.test(c.subject));
  const chosen = fixing[0] ?? commits[0];
  const tests = filesIn(chosen.sha).filter((f) => f.startsWith('tests/') && f.endsWith('.test.ts'));

  const base = {
    id: defect.id,
    severity: defect.severity,
    state: defect.state,
    fixSha: chosen.sha,
    fixSubject: chosen.subject,
    tests,
    allCommits: commits.map((c) => c.sha.slice(0, 7)),
  };

  const signal = incompletenessSignal(chosen.sha);
  if (signal) {
    return { ...base, status: 'PARTIAL_FIX', signal };
  }

  // A defect nobody had claimed to fix is not closed by finding a commit that mentions it.
  // `OPEN` means no one asserted a fix; `FIXED_PENDING_VERIFICATION` means someone did and
  // the verification is what is missing. Only the second is this script's to finish.
  if (defect.state === 'OPEN') {
    return { ...base, status: 'OPEN_NEEDS_REVIEW' };
  }

  return { ...base, status: tests.length > 0 ? 'PROPOSED' : 'NO_TEST_IN_FIX' };
}

/** Run exactly these test files. Returns the observed result, never an assumption. */
function runTests(tests) {
  const started = new Date();
  let stdout = '';
  let status = 1;
  try {
    stdout = execFileSync(
      process.execPath,
      ['--env-file=.env.local', 'node_modules/vitest/vitest.mjs', 'run', ...tests, '--reporter=dot'],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    status = 0;
  } catch (err) {
    stdout = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    status = typeof err.status === 'number' ? err.status : 1;
  }
  const summary = (stdout.match(/Tests\s+.*$/m) ?? [''])[0].trim();
  const files = (stdout.match(/Test Files\s+.*$/m) ?? [''])[0].trim();
  return {
    status,
    summary: [files, summary].filter(Boolean).join(' · '),
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

const ledger = JSON.parse(readFileSync(DEFECT_LEDGER_PATH, 'utf8'));
const proposals = ledger.defects.map(proposalFor);

if (VERIFY) {
  // Deliberately serial. A defect is verified by watching its own tests run, and a shared
  // vitest process would make one summary stand for several defects — which is the bulk close
  // this exists to prevent.
  for (const proposal of proposals) {
    const defect = ledger.defects.find((d) => d.id === proposal.id);
    if (proposal.status !== 'PROPOSED') continue;
    if (defect.state === 'VERIFIED' || defect.state === 'ACCEPTED_RISK') continue;

    process.stderr.write(`verifying ${proposal.id} via ${proposal.tests.join(', ')} … `);
    const result = runTests(proposal.tests);
    proposal.result = result;
    process.stderr.write(`${result.status === 0 ? 'PASS' : 'FAIL'} (${result.summary})\n`);

    defect.fixSha = proposal.fixSha;
    defect.verificationEvidence =
      `${proposal.tests.join(', ')} — ${result.summary}; exit ${result.status}; ` +
      `run ${result.startedAt}; fix ${proposal.fixSha.slice(0, 7)} "${proposal.fixSubject}"`;
    if (result.status === 0) defect.state = 'VERIFIED';
  }
  ledger.lastUpdated = new Date().toISOString();
  writeFileSync(DEFECT_LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
} else if (APPLY) {
  for (const proposal of proposals) {
    if (proposal.status !== 'PROPOSED') continue;
    const defect = ledger.defects.find((d) => d.id === proposal.id);
    if (!defect.fixSha) defect.fixSha = proposal.fixSha;
  }
  ledger.lastUpdated = new Date().toISOString();
  writeFileSync(DEFECT_LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ proposals }, null, 2));
} else {
  const counts = proposals.reduce((acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {});
  console.log('Defect reconciliation');
  console.log('='.repeat(72));
  for (const proposal of proposals) {
    const mark = proposal.result ? (proposal.result.status === 0 ? 'PASS' : 'FAIL') : proposal.status;
    console.log(
      `${proposal.id.padEnd(14)} ${proposal.severity}  ${String(mark).padEnd(14)} ` +
        `${proposal.fixSha ? proposal.fixSha.slice(0, 7) : '-------'}  ${proposal.tests?.join(' ') ?? ''}`
    );
  }
  console.log('='.repeat(72));
  console.log(Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · '));
}

// A defect with no traceable fix is a real gap in the ledger, not a tooling failure.
const untraceable = proposals.filter((p) => p.status === 'NO_COMMIT').length;
process.exitCode = untraceable > 0 && !JSON_OUT ? 0 : 0;
