import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { CERT_DIR, EMPTY_SHA256, REPO_ROOT } from './paths.mjs';

function relativeTo(scope, absolutePath) {
  return path.relative(scope.repoRoot, absolutePath).split(path.sep).join('/');
}

/**
 * Every check returns findings. A finding is a hard failure unless it is
 * explicitly marked `severity: 'WARN'`.
 *
 * Check identifiers map to the lettered checks in PROTOCOL.md.
 */

function finding(check, message, extra = {}) {
  return { check, message, severity: 'FAIL', ...extra };
}

/**
 * Scope of a validation pass. Tests point this at a fixture tree; the real run
 * points it at the repository. Nothing else about the checks changes.
 */
export function defaultScope() {
  return { certDir: CERT_DIR, repoRoot: REPO_ROOT };
}

function certDocs(scope = defaultScope()) {
  const { certDir } = scope;
  if (!existsSync(certDir)) return [];
  const runsDir = path.join(certDir, 'runs');
  return readdirSync(certDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => path.join(certDir, file))
    .concat(
      existsSync(runsDir)
        ? readdirSync(runsDir)
            .filter((file) => file.endsWith('.md'))
            .map((file) => path.join(runsDir, file))
        : [],
    );
}

const SHA40_RE = /\b[0-9a-f]{40}\b/g;

/** A: every SHA-declaring file must agree with the configured candidate SHA. */
export function checkCandidateShaAgreement(config, scope = defaultScope()) {
  const findings = [];
  const candidate = config.candidateSha;
  const known = new Set([
    ...(config.previousCandidates || []).map((entry) => entry.sha),
    ...(candidate ? [candidate] : []),
  ]);

  for (const relative of config.shaDeclaringFiles || []) {
    const abs = path.join(scope.repoRoot, relative);
    if (!existsSync(abs)) {
      findings.push(finding('A', `SHA-declaring file is missing: ${relative}`));
      continue;
    }
    const content = readFileSync(abs, 'utf8');
    const shas = [...new Set(content.match(SHA40_RE) || [])];
    const foreign = shas.filter((sha) => !known.has(sha));
    for (const sha of foreign) {
      findings.push(finding('A', `${relative} declares unknown SHA ${sha.slice(0, 7)}`));
    }
    if (candidate) {
      const stale = shas.filter((sha) => sha !== candidate);
      for (const sha of stale) {
        findings.push(
          finding('A', `${relative} still references non-candidate SHA ${sha.slice(0, 7)} (candidate is ${candidate.slice(0, 7)})`),
        );
      }
    }
  }
  return findings;
}

/** B: exactly one authoritative test total may exist across the documentation. */
export function checkTestTotalAgreement(scope = defaultScope()) {
  const findings = [];
  const totals = new Map();
  const re = /\*{0,2}([\d,]{3,})\*{0,2}\s+[Tt]ests?\s+[Pp]assed/g;

  for (const doc of certDocs(scope)) {
    const content = readFileSync(doc, 'utf8');
    for (const match of content.matchAll(re)) {
      const value = Number(match[1].replace(/,/g, ''));
      if (!Number.isFinite(value)) continue;
      if (!totals.has(value)) totals.set(value, new Set());
      totals.get(value).add(relativeTo(scope, doc));
    }
  }

  if (totals.size > 1) {
    const detail = [...totals.entries()]
      .map(([value, files]) => `${value} (${[...files].join(', ')})`)
      .join(' vs ');
    findings.push(finding('B', `conflicting authoritative test totals in documentation: ${detail}`));
  }
  return findings;
}

/** C: one 1000-row load result, not two. */
export function checkLoadResultAgreement(scope = defaultScope()) {
  const findings = [];
  const throughputs = new Map();
  const re = /([\d.]+)\s*rows\/s/g;

  for (const doc of certDocs(scope)) {
    // A document that *quotes* a withdrawn figure inside backticks - as the certificate does
    // when recording why it was invalidated - is describing the contradiction, not publishing
    // a second answer to it. `withoutCode` is declared below and hoisted.
    const content = withoutCode(readFileSync(doc, 'utf8'));
    for (const match of content.matchAll(re)) {
      const value = Number(match[1]);
      if (!Number.isFinite(value)) continue;
      if (!throughputs.has(value)) throughputs.set(value, new Set());
      throughputs.get(value).add(relativeTo(scope, doc));
    }
  }

  // Multiple throughputs are legitimate (120/500/1000 scales). The failure is
  // the SAME scale reported with different values in different files, which we
  // detect by any throughput value appearing in the certificate that is absent
  // from the load report.
  const certificate = throughputs.size
    ? [...throughputs.entries()].filter(([, files]) =>
        [...files].some((file) => file.endsWith('FINAL_CERTIFICATE.md')),
      )
    : [];
  for (const [value, files] of certificate) {
    const alsoInLoadReport = [...files].some((file) => file.endsWith('LOAD_TEST.md'));
    if (!alsoInLoadReport) {
      findings.push(
        finding('C', `FINAL_CERTIFICATE.md publishes throughput ${value} rows/s that LOAD_TEST.md does not contain`),
      );
    }
  }
  return findings;
}

/** F: no APPROVED certificate while P0/P1 defects are open. */
export function checkCertificateVersusOpenDefects(certificateText, defectsText) {
  const findings = [];
  const approved = /Certificate Status\*{0,2}:\s*ISSUED\s*&\s*APPROVED/i.test(certificateText);
  if (!approved) return findings;

  const openP0 = (defectsText.match(/`TEL-P0-\d+`/g) || []).length > 0;
  const openBlock = /Status\*{0,2}:\s*`?(OPEN|IN_PROGRESS|FIXED_PENDING_VERIFICATION)`?/g;
  const openCount = (defectsText.match(openBlock) || []).length;

  if (openP0 || openCount > 0) {
    findings.push(
      finding('F', `certificate claims APPROVED while DEFECTS.md carries ${openCount} unclosed defect entr(ies)`),
    );
  }
  return findings;
}

/**
 * Strips fenced blocks and inline code spans. Documentation that *describes* a
 * forbidden pattern inside backticks is not using it, and flagging PROTOCOL.md
 * for naming the rule it enforces is noise, not a finding.
 */
function withoutCode(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

/** I: no file:// references anywhere in certification documentation. */
export function checkNoFileUrls(scope = defaultScope()) {
  const findings = [];
  for (const doc of certDocs(scope)) {
    const content = withoutCode(readFileSync(doc, 'utf8'));
    if (content.includes('file://')) {
      findings.push(finding('I', `${relativeTo(scope, doc)} contains a file:// reference`));
    }
  }
  return findings;
}

/** J: documentation must not reference repository files that do not exist. */
export function checkReferencedFilesExist(config, scope = defaultScope()) {
  const findings = [];
  const allowlist = new Set(
    (config.referencedScriptAllowlist || []).map((entry) =>
      typeof entry === 'string' ? entry : entry.path,
    ),
  );
  const re = /`((?:scripts|tests|lib|workers|app|e2e|prisma|supabase)\/[\w./-]+\.(?:ts|tsx|mjs|cjs|js|sql|sh|yml|yaml))`/g;

  for (const doc of certDocs(scope)) {
    const content = readFileSync(doc, 'utf8');
    const seen = new Set();
    for (const match of content.matchAll(re)) {
      const reference = match[1];
      if (seen.has(reference) || allowlist.has(reference)) continue;
      seen.add(reference);
      if (!existsSync(path.join(scope.repoRoot, reference))) {
        findings.push(finding('J', `${relativeTo(scope, doc)} references nonexistent repository file ${reference}`));
      }
    }
  }
  return findings;
}

/**
 * J2: a requirement may not cite a test file that does not exist. A citation to
 * a nonexistent test can never be satisfied by any run, and silently reads as
 * coverage that was never written.
 */
export function checkRegistryTestFilesExist(registry, scope = defaultScope()) {
  const findings = [];
  for (const requirement of registry.requirements) {
    for (const claim of requirement.evidence) {
      if (claim.kind !== 'vitest' || !claim.testFile) continue;
      if (!existsSync(path.join(scope.repoRoot, claim.testFile))) {
        findings.push(
          finding('J2', `${requirement.id} cites test file ${claim.testFile}, which does not exist in the repository`),
        );
      }
    }
  }
  return findings;
}

/** P + Q: backup artifacts must be non-empty and must not carry the empty-file digest. */
export function checkBackupArtifactSanity(records) {
  const findings = [];
  for (const record of records) {
    if (record.kind !== 'dr-backup') continue;
    const metrics = record.metrics || {};
    if (!(metrics.backupSizeBytes > 0)) {
      findings.push(finding('P', `${record.evidenceId}: declared backup size is not greater than zero`));
    }
    if (metrics.backupSha256 === EMPTY_SHA256) {
      findings.push(finding('Q', `${record.evidenceId}: backup SHA-256 is the empty-file digest`));
    }
  }
  return findings;
}

/** R + S + T: release identity chain must be complete and internally consistent. */
export function checkReleaseIdentity(config, records) {
  const findings = [];
  const identity = records.find((record) => record.kind === 'release-identity');
  if (!identity) {
    findings.push(finding('R', 'no release-identity evidence record: image/web/worker digests are unknown'));
    return findings;
  }

  const metrics = identity.metrics || {};
  for (const key of ['imageDigest', 'webDigest', 'workerDigest', 'healthSha', 'ciRunId']) {
    if (!metrics[key]) findings.push(finding('R', `release-identity evidence is missing ${key}`));
  }
  if (config.candidateSha && metrics.healthSha && metrics.healthSha !== config.candidateSha) {
    findings.push(
      finding('S', `deployed health SHA ${String(metrics.healthSha).slice(0, 7)} differs from candidate ${config.candidateSha.slice(0, 7)}`),
    );
  }
  if (metrics.webDigest && metrics.workerDigest && metrics.webDigest !== metrics.workerDigest && metrics.separateImagesIntentional !== true) {
    findings.push(finding('T', 'web and worker image digests differ without separateImagesIntentional: true'));
  }
  return findings;
}

/** M: the certificate may not predate the third certification run. */
export function checkCertificateOrdering(records, certificateText) {
  const findings = [];
  const approved = /Certificate Status\*{0,2}:\s*ISSUED\s*&\s*APPROVED/i.test(certificateText);
  if (!approved) return findings;

  const runs = records.filter((record) => record.kind === 'certification-run');
  const third = runs.find((record) => record.metrics?.runNumber === 3);
  if (!third) {
    findings.push(finding('M', 'certificate is APPROVED but no run 3 evidence record exists'));
    return findings;
  }
  const certifiedAt = certificateText.match(/Certified At\*{0,2}:\s*([0-9T:+\-.Z]+)/);
  if (certifiedAt && new Date(certifiedAt[1]) < new Date(third.finishedAt)) {
    findings.push(finding('M', 'certificate timestamp precedes the completion of run 3'));
  }
  return findings;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** N + O: no behaviour-changing source commit after the candidate freeze. */
export function checkPostFreezeCommits(config) {
  const findings = [];
  if (!config.candidateSha) return findings;

  const range = git(['log', '--format=%H', `${config.candidateSha}..HEAD`]);
  if (range === null) {
    findings.push(finding('N', `candidate SHA ${config.candidateSha.slice(0, 7)} is not reachable from HEAD`));
    return findings;
  }
  const commits = range.split('\n').filter(Boolean);
  const docOnlyPrefixes = ['docs/production-certification/'];

  for (const commit of commits) {
    const files = (git(['show', '--name-only', '--format=', commit]) || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const behaviourChanging = files.filter(
      (file) => !docOnlyPrefixes.some((prefix) => file.startsWith(prefix)),
    );
    if (behaviourChanging.length > 0) {
      findings.push(
        finding(
          'N',
          `commit ${commit.slice(0, 7)} after candidate freeze touches non-certification file(s): ${behaviourChanging.slice(0, 5).join(', ')}`,
        ),
      );
    }
  }
  return findings;
}

/**
 * 01: the application source is exactly the frozen candidate.
 *
 * Certification metadata is produced *by* a run, so it cannot also be a precondition: the
 * freeze is deliberately followed by metadata commits, and a run writes evidence as it goes.
 * HEAD may therefore move past the candidate, and the tree may be dirty, **only** under
 * `docs/production-certification/`. Anything else means the code under test is not the code
 * that was frozen. Check N enforces the same boundary on the commits themselves.
 */
export function checkSourceIdentity(config) {
  const findings = [];
  if (!config.candidateSha) {
    findings.push(
      finding('01', 'no candidate SHA is frozen in certification.config.json - certification cannot conclude'),
    );
    return findings;
  }

  const head = git(['rev-parse', 'HEAD']);
  if (head !== config.candidateSha) {
    const range = git(['log', '--format=%H', `${config.candidateSha}..HEAD`]);
    if (range === null) {
      findings.push(
        finding('01', `frozen candidate ${config.candidateSha.slice(0, 7)} is not reachable from HEAD`),
      );
    }
    // Commits after the freeze are checked by N, which reports any that touch application code.
  }

  const status = (git(['status', '--porcelain']) ?? '')
    .split('\n')
    .filter((line) => line.trim())
    .filter((line) => !line.slice(3).replace(/^"|"$/g, '').startsWith('docs/production-certification/'));

  if (status.length > 0) {
    findings.push(
      finding(
        '01',
        `working tree has ${status.length} uncommitted non-metadata path(s): ${status.slice(0, 5).map((line) => line.slice(3)).join(', ')}`,
      ),
    );
  }
  return findings;
}
