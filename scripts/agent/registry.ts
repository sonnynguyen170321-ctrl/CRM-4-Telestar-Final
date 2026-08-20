/**
 * Registry loading and path resolution.
 *
 * The registry YAML is data, not code, so that changing which domain owns a path is a
 * reviewable one-line diff rather than an edit to a classifier. Everything downstream — risk,
 * skills, tests, verification requirement — is derived from the domain a path resolves to.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { load as loadYaml } from 'js-yaml';

const ROOT = process.cwd();

export interface Domain {
  id: string;
  description: string;
  risk: string;
  paths: string[];
  tests?: string[];
  e2e?: string[];
  gates?: string[];
  verification?: string;
  authorization?: string;
  notes?: string;
}

export interface RiskClass {
  id: string;
  name: string;
  scope: string;
  verification: string[];
  skills: string | number;
  independent_verification: boolean;
  operator_authorization?: boolean;
}

export interface Escalator {
  when: string;
  to: string;
  why: string;
}

export interface SkillEntry {
  id: string;
  domain: string;
  risk: string;
  status: string;
  load_when?: string;
  do_not_load_when?: string;
  sources?: string[];
}

function load<T>(file: string): T {
  return loadYaml(readFileSync(path.join(ROOT, '.agent', 'registry', file), 'utf8')) as T;
}

export function domains(): Domain[] {
  return load<{ domains: Domain[] }>('domains.yaml').domains;
}

export function riskClasses(): RiskClass[] {
  return load<{ classes: RiskClass[] }>('risks.yaml').classes;
}

export function escalators(): Escalator[] {
  return load<{ escalators: Escalator[] }>('risks.yaml').escalators ?? [];
}

export function skills(): SkillEntry[] {
  return load<{ skills: SkillEntry[] }>('skills.yaml').skills;
}

/**
 * Glob to RegExp, by single-pass scan.
 *
 * Written as a scanner rather than a chain of `.replace()` calls on purpose: each replacement
 * in such a chain can rewrite the output of the previous one, since the expansions contain the
 * same metacharacters being matched. The first version of this did exactly that and produced
 * an empty pattern that matched every path.
 *
 * Semantics: `**` crosses separators, `*` does not, `**` followed by `/` also matches zero
 * directories so `a/**` + `/b` matches `a/b`.
 */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];

    if (char === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      out += '[^/]';
      continue;
    }

    out += char.replace(/[.+^${}()|[\]\\]/, '\\$&');
  }

  return new RegExp(`^${out}$`);
}

/**
 * How specific a pattern is, so the narrowest owner wins.
 *
 * `lib/ai/**` must beat `lib/**`, and a deep page pattern must beat a bare `app/**`. Literal
 * characters are evidence of specificity; wildcards are the opposite.
 *
 * (Glob examples containing a double-star followed by a slash are written around rather than
 * inline — that sequence closes a block comment.)
 */
function specificity(glob: string): number {
  const wildcards = (glob.match(/\*/g) ?? []).length;
  return glob.replace(/\*/g, '').length - wildcards * 2;
}

export interface PathResolution {
  file: string;
  domain: Domain | null;
  matchedBy: string | null;
}

/** Resolve one repo-relative path to its owning domain, most-specific pattern first. */
export function resolvePath(file: string, all: Domain[] = domains()): PathResolution {
  const normalized = file.split(path.sep).join('/');
  let best: { domain: Domain; glob: string; score: number } | null = null;

  for (const domain of all) {
    for (const glob of domain.paths ?? []) {
      if (!globToRegExp(glob).test(normalized)) continue;
      const score = specificity(glob);
      if (!best || score > best.score) best = { domain, glob, score };
    }
  }

  return best
    ? { file: normalized, domain: best.domain, matchedBy: best.glob }
    : { file: normalized, domain: null, matchedBy: null };
}

const RISK_ORDER = ['R0', 'R1', 'R2', 'R3', 'R4'];

/** A change is as risky as its riskiest domain — never the average, never the majority. */
export function maxRisk(levels: string[]): string {
  let index = 0;
  for (const level of levels) {
    const at = RISK_ORDER.indexOf(level);
    if (at > index) index = at;
  }
  return RISK_ORDER[index];
}

export function riskAtLeast(a: string, b: string): boolean {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b);
}
