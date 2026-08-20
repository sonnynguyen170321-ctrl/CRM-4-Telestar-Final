import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { skills as registrySkills, domains as registryDomains } from '@/scripts/agent/registry';
import { audit } from '@/scripts/agent/contextAudit';

/**
 * Skill registry integrity (§VII, §VIII, §XX).
 *
 * A registry entry pointing at a skill that does not exist routes an agent to nothing, and it
 * fails silently — `brief` names the skill, the agent cannot load it, and the turn proceeds
 * with less context than the router believed it had. The reverse is worse in a quieter way: a
 * skill nobody routes to is knowledge that will drift unread.
 */

const SKILLS_DIR = path.join(process.cwd(), '.agent', 'skills');

function skillFile(id: string): string {
  return path.join(SKILLS_DIR, id, 'SKILL.md');
}

describe('skill registry', () => {
  it('has a file for every active entry', () => {
    for (const skill of registrySkills()) {
      if (skill.status !== 'active') continue;
      expect(existsSync(skillFile(skill.id)), `${skill.id} is active but has no SKILL.md`).toBe(true);
    }
  });

  it('has a registry entry for every file on disk', () => {
    const registered = new Set(registrySkills().map((s) => s.id));
    for (const entry of readdirSync(SKILLS_DIR)) {
      if (!existsSync(skillFile(entry))) continue;
      expect(registered.has(entry), `${entry} exists but is unrouted — nothing will ever load it`).toBe(true);
    }
  });

  it('names a domain that exists', () => {
    const domainIds = new Set(registryDomains().map((d) => d.id));
    for (const skill of registrySkills()) {
      expect(domainIds.has(skill.domain), `${skill.id} -> unknown domain ${skill.domain}`).toBe(true);
    }
  });

  it('gives every domain at most one skill', () => {
    // Two skills for one domain makes selection ambiguous, and the router would have to pick
    // arbitrarily. If a domain needs two, it is two domains.
    const seen = new Map<string, string>();
    for (const skill of registrySkills()) {
      const previous = seen.get(skill.domain);
      expect(previous, `${skill.domain} claimed by both ${previous} and ${skill.id}`).toBeUndefined();
      seen.set(skill.domain, skill.id);
    }
  });
});

describe('skill content contract', () => {
  const activeSkills = registrySkills().filter((s) => s.status === 'active');

  for (const skill of activeSkills) {
    describe(skill.id, () => {
      const source = existsSync(skillFile(skill.id)) ? readFileSync(skillFile(skill.id), 'utf8') : '';

      it('declares when to load and what it is for', () => {
        expect(source).toMatch(/\*\*LOAD WHEN\*\*/);
      });

      it('names required tests', () => {
        // A skill that describes invariants without naming what protects them leaves the
        // reader to guess which suite to run.
        expect(source).toMatch(/## Required tests/);
      });

      it('carries eval cases so its routing can be checked', () => {
        expect(source).toMatch(/## Eval cases/);
      });

      it('declares its front matter identity', () => {
        expect(source).toMatch(new RegExp(`^---[\\s\\S]*?id: ${skill.id}`));
        expect(source).toMatch(/^---[\s\S]*?risk: R[0-4]/);
      });
    });
  }
});

describe('skill budget', () => {
  it('keeps every skill under the hard review threshold', () => {
    // §VII: core content targets 800 tokens, hard review at ~1200. Over that, supporting
    // reference material should be split out of the core rather than carried on every load.
    const over = audit()
      .filter((item) => item.label.startsWith('skill: '))
      .filter((item) => item.status === 'over');
    expect(over.map((o) => `${o.label} ${o.tokens}t`)).toEqual([]);
  });
});
