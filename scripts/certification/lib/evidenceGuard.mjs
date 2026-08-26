/**
 * The one rule every evidence writer has to obey.
 *
 * Evidence names the candidate it belongs to. A tool that accepts `--candidate` from the
 * command line can therefore be pointed at the wrong release, and on 2026-08-26 one was:
 * running the queue benchmark by hand with `--candidate $(git rev-parse HEAD)` replaced
 * EV-LOAD-QUEUE.json — a measured record for the frozen candidate — with one for a branch
 * commit that will never be released, and rewrote the raw log it cites at the same time.
 * Nothing objected. `git status` caught it.
 *
 * `tests/import-load-benchmark.test.ts` already carried half the answer (de170ac): only a
 * certification run may write, enforced by CERT_CANDIDATE_SHA, which
 * run-full-certification.mjs sets per gate. That stops an ad-hoc run writing at all. It does
 * not stop a certification run pointed at a stale or branch SHA, because such a run sets the
 * variable too.
 *
 * So the rule is both halves, and the tools that read their candidate straight out of
 * certification.config.json — record-deployed-state, verify-release-identity,
 * collect-rls-posture — need neither, because they cannot be misdirected by construction.
 * That is the better design; this exists for the tools that take an argument.
 */
import { readFileSync } from 'node:fs';

import { CONFIG_PATH } from './paths.mjs';

/** The frozen candidate, or '' when the config cannot be read. */
export function frozenCandidateSha() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')).candidateSha || '';
  } catch {
    return '';
  }
}

/**
 * Refuse, loudly, when this invocation must not write evidence.
 *
 * @param candidateSha the candidate this run was told to record against
 * @param options.requireCertRun  demand CERT_CANDIDATE_SHA. Default true. Set false for a
 *   tool an operator legitimately runs by hand outside the ladder — a DR drill, say — where
 *   the frozen-candidate comparison is the meaningful guard on its own.
 * @returns true when writing is allowed; otherwise prints why and returns false.
 */
export function mayWriteEvidence(candidateSha, options = {}) {
  const { requireCertRun = true, toolName = 'this tool' } = options;

  if (requireCertRun && !process.env.CERT_CANDIDATE_SHA) {
    console.error(
      `REFUSED: only a certification run may write into the evidence ledger.\n` +
        `  CERT_CANDIDATE_SHA is unset, so this is an ad-hoc invocation of ${toolName}.`,
    );
    return false;
  }

  const frozen = frozenCandidateSha();
  if (frozen && candidateSha && candidateSha !== frozen) {
    console.error(
      `REFUSED: --candidate ${String(candidateSha).slice(0, 7)} is not the frozen candidate ${frozen.slice(0, 7)}.\n` +
        `  Writing evidence would replace a record belonging to the release under certification.\n` +
        `  Freeze this candidate first, or re-run without recording.`,
    );
    return false;
  }

  return true;
}
