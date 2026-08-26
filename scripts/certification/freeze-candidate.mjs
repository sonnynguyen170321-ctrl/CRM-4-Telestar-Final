#!/usr/bin/env node
/**
 * Freeze a certification candidate.
 *
 * Thirty-one candidates have been frozen in this repository and every one of them was
 * declared by hand-editing certification.config.json. That is the same shape as every
 * defect this program has found: a value that decides the verdict, typed by a person,
 * checked by nothing. A typo in the SHA points certification at a commit nobody built; a
 * forgotten `previousCandidates` entry loses the record of what was superseded; and there
 * was no written procedure at all, so each freeze depended on remembering all of it.
 *
 * This does the whole act, refuses the states that make it meaningless, and says plainly
 * what it invalidated.
 *
 *   node scripts/certification/freeze-candidate.mjs --reason "why this candidate"
 *   node scripts/certification/freeze-candidate.mjs --sha <40-hex> --reason "..."
 *   node scripts/certification/freeze-candidate.mjs --reason "..." --dry-run
 *
 * WHAT FREEZING COSTS. Every evidence record names the candidate it belongs to, so a new
 * candidate voids all of them at once: `certify:validate` will report each requirement
 * unverified until the ladder has run again on the new SHA. That is the point of freezing
 * rather than a side effect of it, and the summary says so before it writes anything.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import { CONFIG_PATH, EVIDENCE_DIR } from './lib/paths.mjs';
import { readdirSync } from 'node:fs';

const SHA_RE = /^[0-9a-f]{40}$/;

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function fail(message, detail = []) {
  console.error(`REFUSED: ${message}`);
  for (const line of detail) console.error(`  ${line}`);
  process.exitCode = 2;
  return false;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const reason = arg('reason');
  const requested = arg('sha') || git(['rev-parse', 'HEAD']);

  if (!reason) {
    return fail('--reason is required.', [
      'The superseded candidate is recorded with the reason it was replaced, and',
      '"superseded" on its own tells the next reader nothing.',
    ]);
  }
  if (!SHA_RE.test(requested ?? '')) {
    return fail(`--sha must be a full 40-character commit SHA (got ${requested ?? 'nothing'}).`, [
      'A short SHA is ambiguous, and a tag can be repointed after the freeze records it.',
    ]);
  }

  // The commit has to be real, and it has to be in the history this tree is on. Freezing a
  // SHA that exists only in someone else's clone produces a candidate nobody can check out.
  if (git(['cat-file', '-t', `${requested}^{commit}`]) !== 'commit') {
    return fail(`${requested.slice(0, 7)} is not a commit in this repository.`);
  }
  if (git(['merge-base', '--is-ancestor', requested, 'HEAD']) === null) {
    return fail(`${requested.slice(0, 7)} is not reachable from HEAD.`, [
      'Freeze a commit that is on this branch. If it is on another branch, check that out first.',
    ]);
  }

  // A dirty tree means the candidate SHA does not describe the files that would be tested.
  const dirty = (git(['status', '--porcelain']) || '')
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  if (dirty.length > 0) {
    return fail('the working tree has uncommitted changes.', [
      'The candidate names a commit; anything not in it would be tested but not certified.',
      ...dirty.slice(0, 5).map((path) => `- ${path}`),
      dirty.length > 5 ? `... and ${dirty.length - 5} more` : '',
    ].filter(Boolean));
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const current = config.candidateSha;

  if (current === requested) {
    return fail(`${requested.slice(0, 7)} is already the frozen candidate.`, [
      'Nothing to do. Re-running the ladder does not require re-freezing.',
    ]);
  }

  const evidenceCount = readdirSync(EVIDENCE_DIR).filter((file) => file.endsWith('.json')).length;

  const next = {
    ...config,
    candidateSha: requested,
    candidateFrozenAt: new Date().toISOString(),
    previousCandidates: [
      ...(config.previousCandidates || []),
      ...(current ? [{ sha: current, invalidatedReason: `superseded: ${reason}` }] : []),
    ],
  };

  console.log('freeze candidate');
  console.log('='.repeat(72));
  console.log(`  from        : ${current ? current : '(none)'}`);
  console.log(`  to          : ${requested}`);
  console.log(`  subject     : ${git(['log', '-1', '--format=%s', requested]) ?? '(unknown)'}`);
  console.log(`  reason      : ${reason}`);
  console.log(`  frozen at   : ${next.candidateFrozenAt}`);
  console.log('');
  console.log(`  This voids all ${evidenceCount} evidence records: every one names ${
    current ? current.slice(0, 7) : 'the old candidate'
  },`);
  console.log('  and certify:validate will report every requirement unverified until the ladder');
  console.log(`  has run again on ${requested.slice(0, 7)}. That is what freezing means.`);
  console.log('');

  if (dryRun) {
    console.log('--dry-run: nothing written.');
    return true;
  }

  writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`wrote ${CONFIG_PATH}`);
  console.log('');
  console.log('Next: commit this, then run the ladder three times on the new candidate:');
  console.log(`  npm run certify:full -- --candidate ${requested} --run 1`);
  return true;
}

main();
