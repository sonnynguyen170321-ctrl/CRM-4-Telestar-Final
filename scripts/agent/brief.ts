/**
 * The context compiler (§XIX).
 *
 * Turns "here are the paths I am about to change" into the minimum sufficient context: the
 * domain, the risk, the sources that decide it, the 1–3 skills, the relevant memory, the
 * target tests, and the production implications.
 *
 * What it deliberately does not do is dump the control plane. The agent gets the kernel, a
 * primary skill, at most two secondary, and the files. Everything else is addressable and
 * stays unread until something needs it.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { load as loadYaml } from 'js-yaml';

import { analyze, changedPaths, type Impact } from './impact';
import { skills as loadSkills } from './registry';

const ROOT = process.cwd();

export interface Brief {
  paths: string[];
  impact: Impact;
  sources: Array<{ subject: string; authority: string[] }>;
  adrs: string[];
  lessons: string[];
  skills: Array<{ id: string; status: string; loadWhen?: string; doNotLoadWhen?: string }>;
}

/** Source authorities whose files intersect the change. */
function relevantSources(files: string[]): Array<{ subject: string; authority: string[] }> {
  const file = path.join(ROOT, '.agent', 'registry', 'sources.yaml');
  if (!existsSync(file)) return [];
  const parsed = loadYaml(readFileSync(file, 'utf8')) as {
    authorities?: Array<{ subject: string; authority: string[] }>;
  };

  return (parsed.authorities ?? []).filter((entry) =>
    (entry.authority ?? []).some((auth) => {
      const prefix = auth.replace(/\*+.*$/, '');
      return files.some((f) => f === auth || (prefix.length > 0 && f.startsWith(prefix)));
    }),
  );
}

/**
 * Memory entries worth reading for this change.
 *
 * Matched by the domain each records, so an email-automation change does not arrive carrying
 * the migration-ordering lesson. Untargeted memory is the thing this whole exercise exists to
 * stop shipping.
 */
function relevantMemory(dir: string, domainIds: string[]): string[] {
  const full = path.join(ROOT, '.agent', 'memory', dir);
  if (!existsSync(full)) return [];

  return readdirSync(full)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => {
      const source = readFileSync(path.join(full, f), 'utf8');
      const head = source.slice(0, 400);
      return domainIds.some((id) => head.includes(id) || source.includes(id));
    })
    .map((f) => `.agent/memory/${dir}/${f}`)
    .sort();
}

export function compile(paths: string[]): Brief {
  const impact = analyze(paths);
  const domainIds = impact.domains.map((d) => d.id);
  const registry = loadSkills();

  return {
    paths,
    impact,
    sources: relevantSources(paths),
    adrs: relevantMemory('decisions', domainIds),
    lessons: relevantMemory('lessons', domainIds),
    skills: impact.skills.map((id) => {
      const entry = registry.find((s) => s.id === id);
      return {
        id,
        status: entry?.status ?? 'unknown',
        loadWhen: entry?.load_when,
        doNotLoadWhen: entry?.do_not_load_when,
      };
    }),
  };
}

export function compileFromDiff(base: string): Brief {
  return compile(changedPaths(base));
}

export function renderBrief(brief: Brief): string {
  const lines: string[] = [];
  const { impact } = brief;

  lines.push('TASK BRIEF');
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`Files:   ${impact.files.length}`);
  lines.push(`Domains: ${impact.domains.map((d) => d.id).join(', ') || 'none'}`);
  lines.push(`Risk:    ${impact.risk}`);
  for (const reason of impact.riskReasons) lines.push(`         ${reason}`);
  lines.push('');

  if (brief.skills.length > 0) {
    lines.push('LOAD THESE SKILLS (and no others)');
    for (const skill of brief.skills) {
      lines.push(`  ${skill.id}${skill.status !== 'active' ? `  [${skill.status}]` : ''}`);
      if (skill.doNotLoadWhen) lines.push(`      not for: ${skill.doNotLoadWhen}`);
    }
    lines.push('');
  }

  if (brief.sources.length > 0) {
    lines.push('SOURCE AUTHORITIES — these decide, documents do not');
    for (const source of brief.sources) {
      lines.push(`  ${source.subject}: ${source.authority.join(', ')}`);
    }
    lines.push('');
  }

  if (brief.adrs.length > 0) {
    lines.push('DECISIONS');
    for (const adr of brief.adrs) lines.push(`  ${adr}`);
    lines.push('');
  }

  if (brief.lessons.length > 0) {
    lines.push('LESSONS — failures already paid for here');
    for (const lesson of brief.lessons) lines.push(`  ${lesson}`);
    lines.push('');
  }

  if (impact.tests.length > 0) {
    lines.push('TARGET TESTS');
    for (const test of impact.tests) lines.push(`  ${test}`);
    lines.push('');
  }

  if (impact.gates.length > 0) {
    lines.push('DOMAIN GATES');
    for (const gate of impact.gates) lines.push(`  ${gate}`);
    lines.push('');
  }

  lines.push('VERIFICATION');
  for (const step of impact.verification) lines.push(`  - ${step}`);
  if (impact.independentVerification) {
    lines.push('  - INDEPENDENT VERIFIER REQUIRED (R3/R4)');
  }
  if (impact.operatorAuthorization) {
    lines.push('  - OPERATOR AUTHORIZATION REQUIRED for production mutation — never implied');
  }

  if (impact.unclassified.length > 0) {
    lines.push('');
    lines.push('UNCLASSIFIED PATHS — map these in .agent/registry/domains.yaml');
    for (const file of impact.unclassified) lines.push(`  ${file}`);
  }

  return lines.join('\n');
}
