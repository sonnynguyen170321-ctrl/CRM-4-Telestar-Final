/**
 * Change impact analysis (§XXIII, §XXIV).
 *
 * Given a set of changed paths, decide what the change *is*: which domains it touches, how
 * risky it is, which tests are candidates, and whether it needs an independent verifier.
 *
 * Risk is the maximum across the touched domains, then raised by content escalators. Never
 * averaged: a one-line edit inside an R4 domain is an R4 change, and a change that is mostly
 * documentation plus one migration is a migration.
 */

import { execFileSync } from 'node:child_process';

import {
  domains as loadDomains,
  escalators as loadEscalators,
  riskClasses,
  maxRisk,
  resolvePath,
  riskAtLeast,
  skills as loadSkills,
  type Domain,
} from './registry';

export interface DomainImpact {
  id: string;
  description: string;
  risk: string;
  files: string[];
  tests: string[];
  e2e: string[];
  gates: string[];
}

export interface Impact {
  files: string[];
  unclassified: string[];
  domains: DomainImpact[];
  risk: string;
  riskReasons: string[];
  independentVerification: boolean;
  operatorAuthorization: boolean;
  skills: string[];
  tests: string[];
  e2e: string[];
  gates: string[];
  verification: string[];
}

/** Changed files versus a base ref. Renames report their new path. */
export function changedPaths(base: string): string[] {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
  });
  const staged = execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  });

  return [...new Set([...out.split('\n'), ...staged.split('\n'), ...untracked.split('\n')])]
    .map((f) => f.trim())
    .filter(Boolean)
    .sort();
}

/**
 * Content-based escalators.
 *
 * Path ownership cannot see everything that makes a change dangerous. A new migration file is
 * R4 wherever it lives; removing a test is a change to what every future change is checked
 * against, not merely to this one.
 */
function contentEscalations(files: string[]): Array<{ to: string; why: string }> {
  const hits: Array<{ to: string; why: string }> = [];
  const escalatorList = loadEscalators();
  const find = (needle: string) => escalatorList.find((e) => e.when.includes(needle));

  if (files.some((f) => /^prisma\/migrations\/.+\.sql$/.test(f))) {
    const rule = find('migration');
    hits.push({ to: rule?.to ?? 'R4', why: rule?.why ?? 'A migration is not locally recoverable.' });
  }

  if (files.some((f) => /^(lib\/auth|lib\/podScoping|lib\/admin)/.test(f))) {
    const rule = find('authorization');
    hits.push({
      to: rule?.to ?? 'R4',
      why: rule?.why ?? 'A silent widening grants access nobody reviewed.',
    });
  }

  if (files.some((f) => /^\.github\/workflows\//.test(f) || /^scripts\/check-/.test(f))) {
    const rule = find('weakens or removes a test');
    hits.push({
      to: rule?.to ?? 'R4',
      why:
        rule?.why ??
        'Changing what is checked alters the safety of every future change, not just this one.',
    });
  }

  return hits;
}

export function analyze(files: string[]): Impact {
  const allDomains = loadDomains();
  const byDomain = new Map<string, DomainImpact>();
  const unclassified: string[] = [];

  for (const file of files) {
    const { domain } = resolvePath(file, allDomains);
    if (!domain) {
      unclassified.push(file);
      continue;
    }
    const existing = byDomain.get(domain.id);
    if (existing) {
      existing.files.push(file);
      continue;
    }
    byDomain.set(domain.id, {
      id: domain.id,
      description: domain.description,
      risk: domain.risk,
      files: [file],
      tests: domain.tests ?? [],
      e2e: domain.e2e ?? [],
      gates: domain.gates ?? [],
    });
  }

  const impacted = [...byDomain.values()];

  // Unclassified paths are treated as R2 rather than R0: an unmapped file is unknown, and
  // unknown is not the same as harmless. It also surfaces the registry gap instead of hiding it.
  const domainRisks = impacted.map((d) => d.risk);
  if (unclassified.length > 0) domainRisks.push('R2');

  const escalations = contentEscalations(files);
  const risk = maxRisk([...domainRisks, ...escalations.map((e) => e.to)]);

  const reasons: string[] = [];
  for (const domain of impacted) {
    if (domain.risk === risk) reasons.push(`${domain.id} is ${domain.risk}`);
  }
  for (const escalation of escalations) {
    if (escalation.to === risk) reasons.push(escalation.why);
  }
  if (unclassified.length > 0) {
    reasons.push(`${unclassified.length} path(s) match no domain — treated as R2 until mapped`);
  }

  const riskClass = riskClasses().find((c) => c.id === risk);
  const touched = impacted.map((d) => allDomains.find((x) => x.id === d.id)).filter(Boolean) as Domain[];

  return {
    files,
    unclassified,
    domains: impacted,
    risk,
    riskReasons: [...new Set(reasons)],
    independentVerification:
      riskAtLeast(risk, 'R3') || touched.some((d) => d.verification === 'independent'),
    operatorAuthorization:
      riskClass?.operator_authorization === true || touched.some((d) => d.authorization === 'operator'),
    skills: selectSkills(impacted.map((d) => d.id)),
    tests: [...new Set(impacted.flatMap((d) => d.tests))],
    e2e: [...new Set(impacted.flatMap((d) => d.e2e))],
    gates: [...new Set(impacted.flatMap((d) => d.gates))],
    verification: riskClass?.verification ?? [],
  };
}

/**
 * Skills for the impacted domains, capped at three.
 *
 * The cap is the point of the exercise. A router that returns eight skills has moved the cost
 * from the agent to the context window rather than removing it; more than three impacted
 * domains means the change is really several changes and should be split.
 */
function selectSkills(domainIds: string[]): string[] {
  const registry = loadSkills();
  const selected = domainIds
    .map((id) => registry.find((s) => s.domain === id))
    .filter(Boolean)
    .map((s) => (s as { id: string }).id);
  return [...new Set(selected)].slice(0, 3);
}

export function renderImpact(impact: Impact): string {
  const lines: string[] = [];
  lines.push(`Risk: ${impact.risk}`);
  for (const reason of impact.riskReasons) lines.push(`  - ${reason}`);
  lines.push('');

  lines.push(`Files: ${impact.files.length}`);
  lines.push(`Domains: ${impact.domains.map((d) => `${d.id} (${d.risk})`).join(', ') || 'none'}`);
  if (impact.unclassified.length > 0) {
    lines.push(`Unclassified: ${impact.unclassified.join(', ')}`);
  }
  lines.push('');

  lines.push(`Skills to load (max 3): ${impact.skills.join(', ') || 'none'}`);
  lines.push('');

  if (impact.tests.length > 0) {
    lines.push('Candidate tests:');
    for (const test of impact.tests) lines.push(`  ${test}`);
  }
  if (impact.e2e.length > 0) {
    lines.push('Candidate e2e:');
    for (const spec of impact.e2e) lines.push(`  ${spec}`);
  }
  if (impact.gates.length > 0) {
    lines.push('Domain gates:');
    for (const gate of impact.gates) lines.push(`  ${gate}`);
  }
  lines.push('');

  lines.push('Verification required:');
  for (const step of impact.verification) lines.push(`  - ${step}`);

  if (impact.independentVerification) {
    lines.push('');
    lines.push('INDEPENDENT VERIFICATION REQUIRED — a second agent reviews diff, source and tests.');
  }
  if (impact.operatorAuthorization) {
    lines.push('OPERATOR AUTHORIZATION REQUIRED for any production mutation. It is not implied by the task.');
  }

  return lines.join('\n');
}
