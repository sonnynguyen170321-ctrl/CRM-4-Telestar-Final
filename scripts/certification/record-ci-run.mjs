#!/usr/bin/env node
/**
 * Records real GitHub Actions evidence for the candidate (`REL-006`).
 *
 * Everything here comes from `gh`. Nothing is invented: if the run cannot be read, the record
 * is written as `BLOCKED_EXTERNAL` rather than filled in optimistically. "CI passed" is never
 * inferred from local tests passing.
 *
 *   node scripts/certification/record-ci-run.mjs [--run <id>]
 *
 * Exits non-zero when the run did not conclude successfully.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CONFIG_PATH, EVIDENCE_DIR, RAW_DIR, REPO_ROOT, repoRelative } from './lib/paths.mjs';

function gh(args) {
  return spawnSync('gh', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function git(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const candidateSha = config.candidateSha;
  if (!candidateSha) {
    console.error('No candidate SHA is frozen.');
    process.exit(2);
  }

  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const now = new Date().toISOString();
  const writeRecord = (record) => {
    writeFileSync(path.join(EVIDENCE_DIR, 'EV-CI-RUN.json'), `${JSON.stringify(record, null, 2)}\n`);
  };

  let runId = arg('run');
  if (!runId) {
    const list = gh([
      'run',
      'list',
      '--branch',
      git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'HEAD',
      '--limit',
      '10',
      '--json',
      'databaseId,workflowName,status,conclusion,headSha',
    ]);
    if (list.status !== 0) {
      writeRecord({
        evidenceId: 'EV-CI-RUN',
        kind: 'ci-run',
        candidateSha,
        environment: 'GitHub Actions',
        command: 'gh run list',
        startedAt: now,
        finishedAt: now,
        exitCode: list.status ?? 127,
        status: 'BLOCKED_EXTERNAL',
        metrics: { reason: `gh could not list runs: ${(list.stderr || '').trim().slice(0, 300)}` },
        artifacts: [],
      });
      console.error('gh could not list workflow runs; recorded BLOCKED_EXTERNAL');
      process.exit(1);
    }
    const runs = JSON.parse(list.stdout);
    const ci = runs.find((run) => run.workflowName === 'CI') ?? runs[0];
    if (!ci) {
      writeRecord({
        evidenceId: 'EV-CI-RUN',
        kind: 'ci-run',
        candidateSha,
        environment: 'GitHub Actions',
        command: 'gh run list',
        startedAt: now,
        finishedAt: now,
        exitCode: 1,
        status: 'BLOCKED_EXTERNAL',
        metrics: { reason: 'no workflow run exists for this branch' },
        artifacts: [],
      });
      console.error('no workflow run found; recorded BLOCKED_EXTERNAL');
      process.exit(1);
    }
    runId = String(ci.databaseId);
  }

  const view = gh([
    'run',
    'view',
    runId,
    '--json',
    'databaseId,workflowName,headSha,headBranch,status,conclusion,createdAt,updatedAt,url,jobs',
  ]);
  if (view.status !== 0) {
    writeRecord({
      evidenceId: 'EV-CI-RUN',
      kind: 'ci-run',
      candidateSha,
      environment: 'GitHub Actions',
      command: `gh run view ${runId}`,
      startedAt: now,
      finishedAt: now,
      exitCode: view.status ?? 127,
      status: 'BLOCKED_EXTERNAL',
      metrics: { runId, reason: (view.stderr || '').trim().slice(0, 300) },
      artifacts: [],
    });
    console.error(`gh could not read run ${runId}; recorded BLOCKED_EXTERNAL`);
    process.exit(1);
  }

  const run = JSON.parse(view.stdout);
  const logPath = path.join(RAW_DIR, `ci-run-${runId}.log`);
  writeFileSync(
    logPath,
    [
      `# gh run view ${runId}`,
      `# capturedAt: ${now}`,
      '',
      JSON.stringify(run, null, 2),
      '',
    ].join('\n'),
  );

  /**
   * CI runs against the branch head, which is a certification-metadata descendant of the
   * frozen candidate. That is the same boundary gate 01 and check N enforce: the application
   * source CI validated is the candidate's, even though the commit id differs.
   */
  const commitsBetween = git(['log', '--format=%H', `${candidateSha}..${run.headSha}`]) ?? '';
  const intermediate = commitsBetween.split('\n').filter(Boolean);
  const nonMetadata = intermediate.filter((commit) => {
    const files = (git(['show', '--name-only', '--format=', commit]) ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return files.some((file) => !file.startsWith('docs/production-certification/'));
  });

  const succeeded = run.conclusion === 'success';
  const sourceMatches = run.headSha === candidateSha || nonMetadata.length === 0;

  writeRecord({
    evidenceId: 'EV-CI-RUN',
    kind: 'ci-run',
    candidateSha,
    environment: 'GitHub Actions',
    command: `gh run view ${runId}`,
    startedAt: run.createdAt,
    finishedAt: run.updatedAt,
    exitCode: succeeded && sourceMatches ? 0 : 1,
    status: succeeded && sourceMatches ? 'PASS' : 'FAIL',
    metrics: {
      runId: String(run.databaseId),
      workflowName: run.workflowName,
      url: run.url,
      headSha: run.headSha,
      headBranch: run.headBranch,
      conclusion: run.conclusion,
      runStatus: run.status,
      commitsBetweenCandidateAndHead: intermediate.length,
      nonMetadataCommitsBetween: nonMetadata.length,
      sourceMatchesCandidate: sourceMatches,
      jobs: (run.jobs ?? []).map((job) => ({
        name: job.name,
        conclusion: job.conclusion,
        status: job.status,
      })),
    },
    artifacts: [
      {
        path: repoRelative(logPath),
        sizeBytes: statSync(logPath).size,
        sha256: createHash('sha256').update(readFileSync(logPath)).digest('hex'),
      },
    ],
  });

  console.log(`EV-CI-RUN: ${succeeded && sourceMatches ? 'PASS' : 'FAIL'}`);
  console.log(`  run ${run.databaseId} (${run.workflowName}) — ${run.status}/${run.conclusion}`);
  console.log(`  head ${String(run.headSha).slice(0, 7)}, candidate ${candidateSha.slice(0, 7)}`);
  console.log(`  non-metadata commits between: ${nonMetadata.length}`);
  process.exit(succeeded && sourceMatches ? 0 : 1);
}

main();
