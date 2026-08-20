/**
 * Project-truth CI (§LIV).
 *
 * Deterministic checks that the control plane still describes the repository. Each is cheap,
 * each names what it found, and each can fail — a check that cannot fail is decoration.
 *
 * The checks here are the automated half of the teach-once rule (§LII): when a class of
 * mistake recurs, it should end up as a check in this file rather than as another paragraph in
 * a document nobody re-reads.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { allFacts } from './facts';
import { audit } from './contextAudit';
import { domains, skills } from './registry';

const ROOT = process.cwd();

export interface CheckResult {
  id: string;
  ok: boolean;
  detail: string;
  findings: string[];
}

function walk(dir: string, filter: (f: string) => boolean, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.git')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

/** Surfaces an agent actually reads as current truth. Historical docs are out of scope. */
function currentSurfaces(): string[] {
  const files = ['AGENTS.md', 'CLAUDE.md']
    .map((f) => path.join(ROOT, f))
    .filter((f) => existsSync(f));
  files.push(...walk(path.join(ROOT, '.claude', 'rules'), (f) => f.endsWith('.md')));
  files.push(...walk(path.join(ROOT, '.agent'), (f) => f.endsWith('.md')));
  return files;
}

// ── 1. generated facts match their sources ───────────────────────────────────

async function checkGeneratedFacts(): Promise<CheckResult> {
  const stale: string[] = [];
  for (const fact of await allFacts()) {
    const target = path.join(ROOT, fact.file);
    const next = JSON.stringify(fact.data, null, 2) + '\n';
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (current !== next) stale.push(fact.file);
  }
  return {
    id: 'generated-facts',
    ok: stale.length === 0,
    detail: stale.length === 0 ? 'all generated facts match source' : `${stale.length} stale`,
    findings: stale.map((f) => `${f} — run: npm run agent -- facts`),
  };
}

// ── 2. context budget ────────────────────────────────────────────────────────

function checkContextBudget(): CheckResult {
  const over = audit().filter((item) => item.status === 'over');
  return {
    id: 'context-budget',
    ok: over.length === 0,
    detail: over.length === 0 ? 'within budget' : `${over.length} over the hard threshold`,
    findings: over.map((o) => `${o.label}: ${o.tokens} tokens > ${o.hardReview}`),
  };
}

// ── 3. references to paths that do not exist ─────────────────────────────────

/**
 * A dead path reference is the cheapest drift there is and the most common: a file moves, and
 * every document naming it keeps naming it. Six such pointers were live in `.claude/rules/`
 * before this control plane existed, all aimed at a directory that had never been created.
 */
function checkDeadReferences(): CheckResult {
  const findings: string[] = [];
  // Repo-relative paths with a directory separator and a plausible extension, inside backticks
  // or markdown links. Bare prose words are deliberately not matched.
  const pattern = /[`(]([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+\.(?:ts|tsx|mjs|cjs|json|md|yaml|yml|sql|sh))[`)]/g;

  for (const file of currentSurfaces()) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    // Memory deliberately names files that no longer exist — an ADR explaining why
    // `lib/ai/provider.ts` was deleted has to say its name out loud.
    if (relative.startsWith('.agent/memory/')) continue;

    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      const referenced = match[1];
      if (referenced.includes('*')) continue;
      if (referenced.startsWith('http')) continue;
      if (referenced.startsWith('node_modules/')) continue;
      // A reference resolves either from the repository root or from the file making it.
      // Checking only the former reported every correct relative link as dead.
      if (existsSync(path.join(ROOT, referenced))) continue;
      if (existsSync(path.resolve(path.dirname(file), referenced))) continue;
      findings.push(`${relative} -> ${referenced}`);
    }
  }

  return {
    id: 'dead-references',
    ok: findings.length === 0,
    detail: findings.length === 0 ? 'no dead path references' : `${findings.length} dead`,
    findings,
  };
}

// ── 4. stale architecture language ───────────────────────────────────────────

/**
 * Claims this project has left. Each one, followed as instruction, sends an agent somewhere
 * the product is not.
 */
const FORBIDDEN_LANGUAGE: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /\b(Vercel|Neon)\b/i,
    why: 'production is Docker Compose on GCP with Cloud SQL (ADR-0005)',
  },
  {
    pattern: /four\s+roles|4\s+roles/i,
    why: 'there are six roles (ADR-0004)',
  },
  {
    pattern: /lib\/ai\/(provider|providerRouting)\.ts/,
    why: 'the legacy provider modules were deleted; there is one gateway (ADR-0002)',
  },
  {
    pattern: /prisma\/seed\.ts/,
    why: 'the seed is prisma/seed-demo.ts and is guarded by lib/seed-guard.ts',
  },
];

function checkArchitectureLanguage(): CheckResult {
  const findings: string[] = [];
  for (const file of currentSurfaces()) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    // check.ts declares these patterns; the ADRs quote them to say they are wrong.
    if (relative.startsWith('.agent/memory/decisions/')) continue;
    if (relative.startsWith('.agent/memory/lessons/')) continue;

    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      // A line may name a retired term precisely in order to say it is retired. That is the
      // correction working, not drift. `truth-check: allow` marks it, so the exemption lives
      // visibly in the text rather than hidden in an exclusion list here.
      if (line.includes('truth-check: allow')) return;
      for (const { pattern, why } of FORBIDDEN_LANGUAGE) {
        if (pattern.test(line)) findings.push(`${relative}:${index + 1} — ${why}`);
      }
    });
  }
  return {
    id: 'stale-architecture-language',
    ok: findings.length === 0,
    detail: findings.length === 0 ? 'no stale architecture claims' : `${findings.length} found`,
    findings,
  };
}

// ── 5. memory hygiene ────────────────────────────────────────────────────────

function checkMemoryHygiene(): CheckResult {
  const findings: string[] = [];
  const decisions = path.join(ROOT, '.agent', 'memory', 'decisions');
  const lessons = path.join(ROOT, '.agent', 'memory', 'lessons');

  for (const file of walk(decisions, (f) => f.endsWith('.md'))) {
    const source = readFileSync(file, 'utf8');
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    if (!/^---[\s\S]*?id: ADR-\d+/.test(source)) findings.push(`${relative} — missing ADR id`);
    if (!/## Protection/.test(source)) findings.push(`${relative} — no Protection section`);
    if (!/## Decision/.test(source)) findings.push(`${relative} — no Decision section`);
  }

  for (const file of walk(lessons, (f) => f.endsWith('.md'))) {
    const source = readFileSync(file, 'utf8');
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    // A lesson without permanent protection is a story. The whole point is that the next
    // agent does not need to remember it.
    if (!/\*\*Permanent protection\.\*\*/.test(source)) {
      findings.push(`${relative} — no permanent protection; a lesson must become a check or a test`);
    }
    if (!/\*\*Root cause\.\*\*/.test(source)) findings.push(`${relative} — no root cause`);
  }

  return {
    id: 'memory-hygiene',
    ok: findings.length === 0,
    detail: findings.length === 0 ? 'memory well formed' : `${findings.length} issues`,
    findings,
  };
}

// ── 6. registry integrity ────────────────────────────────────────────────────

function checkRegistryIntegrity(): CheckResult {
  const findings: string[] = [];
  const domainIds = new Set(domains().map((d) => d.id));

  for (const skill of skills()) {
    if (!domainIds.has(skill.domain)) findings.push(`skill ${skill.id} -> unknown domain ${skill.domain}`);
    if (skill.status !== 'active') continue;
    if (!existsSync(path.join(ROOT, '.agent', 'skills', skill.id, 'SKILL.md'))) {
      findings.push(`skill ${skill.id} is active but has no SKILL.md — routing points at nothing`);
    }
  }

  for (const domain of domains()) {
    for (const glob of domain.paths ?? []) {
      // Only a prefix ending on a directory boundary is checkable. `scripts/ai-*.ts` has the
      // partial segment `scripts/ai-`, which is not a path and never will be — asserting it
      // exists reported working patterns as broken.
      const wildcard = glob.indexOf('*');
      if (wildcard === -1) {
        if (!existsSync(path.join(ROOT, glob))) {
          findings.push(`domain ${domain.id} owns ${glob}, which does not exist`);
        }
        continue;
      }
      const prefix = glob.slice(0, wildcard);
      if (!prefix.endsWith('/')) continue;
      const dir = prefix.slice(0, -1);
      if (dir.length > 0 && !existsSync(path.join(ROOT, dir))) {
        findings.push(`domain ${domain.id} owns ${glob}, but ${dir}/ does not exist`);
      }
    }
  }

  return {
    id: 'registry-integrity',
    ok: findings.length === 0,
    detail: findings.length === 0 ? 'registry consistent' : `${findings.length} issues`,
    findings,
  };
}

// ── run ──────────────────────────────────────────────────────────────────────

export async function runChecks(): Promise<CheckResult[]> {
  return [
    await checkGeneratedFacts(),
    checkContextBudget(),
    checkDeadReferences(),
    checkArchitectureLanguage(),
    checkMemoryHygiene(),
    checkRegistryIntegrity(),
  ];
}

export function renderChecks(results: CheckResult[]): string {
  const lines = ['Project truth', ''];
  for (const result of results) {
    lines.push(`  ${result.ok ? 'ok  ' : 'FAIL'} ${result.id.padEnd(28)} ${result.detail}`);
    if (!result.ok) for (const finding of result.findings) lines.push(`         ${finding}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  lines.push('');
  lines.push(failed === 0 ? 'All project-truth checks passed.' : `${failed} check(s) failed.`);
  return lines.join('\n');
}

export function checksExitCode(results: CheckResult[]): number {
  return results.some((r) => !r.ok) ? 1 : 0;
}
