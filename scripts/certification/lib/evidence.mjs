import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { EMPTY_SHA256, EVIDENCE_DIR, REPO_ROOT } from './paths.mjs';

/**
 * An evidence record is the ONLY thing that can make a requirement VERIFIED.
 * It must carry enough information for another engineer to independently
 * reproduce the claim: what ran, where, when, against which SHA, the result,
 * and the raw artifacts.
 */
const REQUIRED_FIELDS = [
  'evidenceId',
  'kind',
  'candidateSha',
  'environment',
  'command',
  'startedAt',
  'finishedAt',
  'exitCode',
  'status',
];

const VALID_STATUS = new Set(['PASS', 'FAIL', 'BLOCKED_EXTERNAL', 'NOT_EXECUTED']);
const SHA256_RE = /^[0-9a-f]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function sha256File(absolutePath) {
  return createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
}

export function loadEvidenceRecords() {
  if (!existsSync(EVIDENCE_DIR)) return [];
  return readdirSync(EVIDENCE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const abs = path.join(EVIDENCE_DIR, f);
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(abs, 'utf8'));
      } catch (error) {
        return { __file: f, __parseError: error.message };
      }
      return { __file: f, ...parsed };
    });
}

/**
 * Structural validation of one evidence record. Returns an array of problem
 * strings; empty means the record is well-formed. Well-formed is not the same
 * as PASS - a record may legitimately record a FAIL or a BLOCKED_EXTERNAL.
 */
export function validateRecordShape(record) {
  const problems = [];
  const where = record.evidenceId || record.__file;

  if (record.__parseError) return [`${where}: not valid JSON - ${record.__parseError}`];

  for (const field of REQUIRED_FIELDS) {
    if (record[field] === undefined || record[field] === null) {
      problems.push(`${where}: missing required field "${field}"`);
    }
  }

  if (record.status && !VALID_STATUS.has(record.status)) {
    problems.push(`${where}: status "${record.status}" is not one of ${[...VALID_STATUS].join(', ')}`);
  }
  if (record.candidateSha && !/^[0-9a-f]{40}$/.test(record.candidateSha)) {
    problems.push(`${where}: candidateSha must be a full 40-character commit SHA`);
  }
  for (const field of ['startedAt', 'finishedAt']) {
    if (record[field] && !ISO_RE.test(record[field])) {
      problems.push(`${where}: ${field} must be an explicit ISO-8601 timestamp with offset`);
    }
  }
  if (record.status === 'PASS' && record.exitCode !== 0) {
    problems.push(`${where}: status PASS with non-zero exitCode ${record.exitCode}`);
  }

  const artifacts = record.artifacts || [];
  if (!Array.isArray(artifacts)) {
    problems.push(`${where}: artifacts must be an array`);
    return problems;
  }
  artifacts.forEach((artifact, index) => {
    const label = `${where}: artifacts[${index}]`;
    if (!artifact.path) problems.push(`${label} missing path`);
    if (typeof artifact.sizeBytes !== 'number') problems.push(`${label} missing numeric sizeBytes`);
    if (!SHA256_RE.test(artifact.sha256 || '')) problems.push(`${label} missing a valid sha256`);
  });

  return problems;
}

/**
 * Confirms every declared artifact exists on disk, is the declared size, and
 * hashes to the declared digest. Fabricated or drifted artifacts fail here.
 */
export function verifyArtifacts(record) {
  const problems = [];
  const where = record.evidenceId || record.__file;

  for (const artifact of record.artifacts || []) {
    if (!artifact.path) continue;
    const abs = path.isAbsolute(artifact.path) ? artifact.path : path.join(REPO_ROOT, artifact.path);

    if (!existsSync(abs)) {
      problems.push(`${where}: artifact "${artifact.path}" does not exist`);
      continue;
    }
    const actualSize = statSync(abs).size;
    if (actualSize !== artifact.sizeBytes) {
      problems.push(
        `${where}: artifact "${artifact.path}" declares ${artifact.sizeBytes} bytes but is ${actualSize}`,
      );
    }
    const actualSha = sha256File(abs);
    if (actualSha !== artifact.sha256) {
      problems.push(
        `${where}: artifact "${artifact.path}" hash mismatch - declared ${artifact.sha256}, actual ${actualSha}`,
      );
    }
    if (artifact.sha256 === EMPTY_SHA256 && artifact.sizeBytes > 0) {
      problems.push(
        `${where}: artifact "${artifact.path}" declares ${artifact.sizeBytes} bytes with the empty-file SHA-256`,
      );
    }
  }

  return problems;
}

export function indexByKind(records) {
  const index = new Map();
  for (const record of records) {
    if (!record.kind) continue;
    if (!index.has(record.kind)) index.set(record.kind, []);
    index.get(record.kind).push(record);
  }
  return index;
}
