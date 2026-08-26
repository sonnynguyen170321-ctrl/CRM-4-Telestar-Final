/**
 * Repair fixShas that a rebase-merge orphaned.
 *
 * `main` requires a linear history, so every merge rewrites the branch commits. A fixSha
 * recorded on the branch names a commit that exists only in the author's clone afterwards.
 *
 * reconcile-defects.mjs picks the earliest commit on main whose message names the defect
 * id, which is wrong whenever the earliest such commit is the one that FILED the defect
 * rather than the one that fixed it — it proposed 5e9beeb for TEL-P1-052 when 3aa2dab was
 * the fix.
 *
 * A commit subject survives a rebase intact, so this maps old SHA -> subject -> new SHA and
 * refuses to guess when the mapping is not exactly one commit.
 *
 *   node scripts/certification/reconcile-rebased-fix-shas.mjs           # report
 *   node scripts/certification/reconcile-rebased-fix-shas.mjs --apply   # write
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const LEDGER = 'docs/production-certification/defects.json';
const apply = process.argv.includes('--apply');

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
let repaired = 0;
const problems = [];

for (const defect of ledger.defects) {
  if (defect.fixKind !== 'commit' || !defect.fixSha) continue;

  // Reachable from HEAD? Then it landed and there is nothing to do.
  if (git(['merge-base', '--is-ancestor', `${defect.fixSha}^{commit}`, 'HEAD']) !== null) continue;

  const subject = git(['log', '-1', '--format=%s', defect.fixSha]);
  if (!subject) {
    problems.push(`${defect.id}: ${defect.fixSha.slice(0, 7)} is gone from this clone too — cannot map it`);
    continue;
  }

  const matches = (git(['log', 'HEAD', '--format=%H', '--fixed-strings', `--grep=${subject}`]) || '')
    .split('\n')
    .filter(Boolean);

  if (matches.length !== 1) {
    problems.push(
      `${defect.id}: subject "${subject.slice(0, 60)}" matches ${matches.length} commits on HEAD — refusing to guess`,
    );
    continue;
  }

  console.log(`${defect.id}: ${defect.fixSha.slice(0, 7)} -> ${matches[0].slice(0, 7)}  (${subject.slice(0, 60)})`);
  if (apply) defect.fixSha = matches[0];
  repaired += 1;
}

if (problems.length > 0) {
  console.log('');
  for (const problem of problems) console.log(`  ! ${problem}`);
}

if (apply && repaired > 0) {
  ledger.lastUpdated = new Date().toISOString();
  writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`\nwrote ${repaired} repair(s) to ${LEDGER}`);
} else {
  console.log(`\n${repaired} entr(ies) would be repaired. ${apply ? '' : 'Re-run with --apply.'}`);
}

process.exitCode = problems.length > 0 ? 1 : 0;
