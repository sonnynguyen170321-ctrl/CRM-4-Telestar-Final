#!/usr/bin/env node
/**
 * Renders RUN_1.md … RUN_N.md from the run manifests (order §24).
 *
 * The previous run documents were hand-written, listed four gates, and called themselves full
 * certification runs. A generated document cannot describe gates that did not run, and cannot
 * omit ones that did: it can only report what the manifest recorded.
 *
 *   node scripts/certification/render-runs.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CONFIG_PATH, RUNS_DIR } from './lib/paths.mjs';

const MANIFEST_DIR = path.join(RUNS_DIR, 'manifests');

function badge(status) {
  if (status === 'PASS') return '**PASS**';
  if (status === 'BLOCKED_EXTERNAL') return 'BLOCKED_EXTERNAL';
  return `**${status}**`;
}

function renderRun(manifest, config) {
  const gates = Object.entries(manifest.gates);
  const passed = gates.filter(([, gate]) => gate.status === 'PASS').length;
  const failed = gates.filter(([, gate]) => gate.status === 'FAIL').length;
  const blocked = gates.filter(([, gate]) => gate.status === 'BLOCKED_EXTERNAL').length;

  const verdict =
    manifest.failedGates.length === 0 &&
    manifest.missingGates.length === 0 &&
    manifest.mandatorySkips === 0
      ? 'PASS'
      : 'FAIL';

  const rows = gates.map(([gateId, gate]) => {
    const reason =
      gate.status === 'PASS'
        ? '—'
        : gate.metrics?.reason ?? (gate.metrics?.problems ?? []).join('; ') ?? '';
    return `| \`${gateId}\` | ${badge(gate.status)} | ${gate.exitCode ?? '—'} | ${(gate.durationMs / 1000).toFixed(1)}s | ${reason || '—'} |`;
  });

  return `# Telestar CRM — Certification Run ${manifest.runNumber}

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/runs/manifests/run-${manifest.runNumber}.json
  Regenerate: node scripts/certification/render-runs.mjs
-->

**Verdict**: **${verdict}**
**Candidate SHA**: \`${manifest.candidateSha}\`
**Release tag**: \`${config.releaseTag}\`
**Environment**: ${manifest.environment}
**Ran**: ${manifest.startedAt} → ${manifest.finishedAt} (${(manifest.durationMs / 60000).toFixed(1)} min)

---

## 1. Scope

This run executed **${gates.length} gates**: ${passed} passed, ${failed} failed, ${blocked} blocked externally.
Mandatory skips: **${manifest.mandatorySkips}**.
${manifest.missingGates.length > 0 ? `\n**Gates that did not run**: ${manifest.missingGates.join(', ')}. A run missing a mandatory gate is not a full run.` : '\nNo mandatory gate was omitted.'}

## 2. Gates

| Gate | Status | Exit | Duration | Notes |
|---|---|---:|---:|---|
${rows.join('\n')}

## 3. Test execution

${
  manifest.vitest
    ? `| Measure | Value |
|---|---:|
| Test files | ${manifest.vitest.testFiles} |
| Test files passed | ${manifest.vitest.testFilesPassed} |
| Tests passed | ${manifest.vitest.testsPassed} |
| Tests failed | ${manifest.vitest.testsFailed} |
| Tests skipped | ${manifest.vitest.testsSkipped} |

Counts come from Vitest's JSON reporter. None is typed by hand.`
    : '_Vitest results were not parsed for this run._'
}

## 4. Raw output

Every gate's stdout and stderr was captured while it ran, under
\`evidence/raw/run${manifest.runNumber}-*.log\` and \`evidence/raw/gate-*.log\`, and each file
is hash-verified by \`npm run certify:validate\`.
`;
}

function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  if (!existsSync(MANIFEST_DIR)) {
    console.log('no run manifests to render');
    return;
  }

  mkdirSync(RUNS_DIR, { recursive: true });
  const manifests = readdirSync(MANIFEST_DIR)
    .filter((file) => /^run-\d+\.json$/.test(file))
    .map((file) => JSON.parse(readFileSync(path.join(MANIFEST_DIR, file), 'utf8')))
    .sort((a, b) => a.runNumber - b.runNumber);

  for (const manifest of manifests) {
    writeFileSync(path.join(RUNS_DIR, `RUN_${manifest.runNumber}.md`), renderRun(manifest, config));
    console.log(
      `rendered RUN_${manifest.runNumber}.md — ${manifest.failedGates.length} failed, ${manifest.missingGates.length} missing, ${manifest.mandatorySkips} skips`,
    );
  }
}

main();
