import { describe, it, expect } from 'vitest';

import { analyze } from '@/scripts/agent/impact';
import { compile } from '@/scripts/agent/brief';
import { globToRegExp, resolvePath, maxRisk } from '@/scripts/agent/registry';
import { audit, auditExitCode } from '@/scripts/agent/contextAudit';

/**
 * Routing evals (§XLVIII).
 *
 * Precision matters as much as recall. A router that returns eight skills to be sure it
 * included the two that mattered has not solved the problem — it has moved the cost from the
 * agent to the context window, which is where this repository's 79,000-token startup surface
 * came from in the first place.
 *
 * So every case asserts both halves: the right domain is selected, **and** the wrong ones are
 * not.
 */

describe('glob matching', () => {
  it('treats ** as crossing separators and * as not', () => {
    expect(globToRegExp('lib/ai/**').test('lib/ai/pricing.ts')).toBe(true);
    expect(globToRegExp('lib/ai/**').test('lib/ai/engine/deep/file.ts')).toBe(true);
    expect(globToRegExp('lib/*.ts').test('lib/env.ts')).toBe(true);
    expect(globToRegExp('lib/*.ts').test('lib/ai/registry.ts')).toBe(false);
  });

  it('matches a double-star directory segment with zero directories', () => {
    expect(globToRegExp('app/**/page.tsx').test('app/page.tsx')).toBe(true);
    expect(globToRegExp('app/**/page.tsx').test('app/leads/page.tsx')).toBe(true);
    expect(globToRegExp('app/**/page.tsx').test('app/a/b/page.tsx')).toBe(true);
  });

  it('does not match everything — the failure mode of a broken glob compiler', () => {
    // The first implementation chained .replace() calls whose expansions contained the same
    // metacharacters being matched, and produced a pattern that matched every path.
    expect(globToRegExp('lib/ai/**').test('components/LeadCard.tsx')).toBe(false);
    expect(globToRegExp('workers/**').test('lib/auth.ts')).toBe(false);
    expect(globToRegExp('docker-compose*.yml').test('package.json')).toBe(false);
  });

  it('handles the literal dot in a filename pattern', () => {
    expect(globToRegExp('docker-compose*.yml').test('docker-compose.gcp.yml')).toBe(true);
    expect(globToRegExp('docker-compose*.yml').test('docker-composeXyml')).toBe(false);
  });
});

describe('path ownership resolves to the narrowest domain', () => {
  const cases: Array<[string, string]> = [
    ['lib/ai/registry.ts', 'telestar-ai'],
    ['lib/auth.ts', 'auth-rbac-tenancy'],
    ['prisma/schema.prisma', 'data-prisma'],
    ['workers/sequence.ts', 'workers-durability'],
    ['lib/sequences/engine.ts', 'email-automation'],
    ['components/LeadCard.tsx', 'frontend-role-ux'],
    ['docker-compose.gcp.yml', 'production-release'],
    ['docs/agent-os/STATUS.md', 'documentation'],
    ['AGENTS.md', 'agent-control-plane'],
  ];

  for (const [file, expected] of cases) {
    it(`${file} -> ${expected}`, () => {
      expect(resolvePath(file).domain?.id).toBe(expected);
    });
  }

  it('reports an unmapped path rather than guessing', () => {
    expect(resolvePath('some/unmapped/thing.txt').domain).toBeNull();
  });
});

describe('risk classification', () => {
  it('takes the maximum across domains, never the average', () => {
    expect(maxRisk(['R0', 'R4', 'R1'])).toBe('R4');
    // The property that matters: one dangerous file in a large safe change is a dangerous change.
    const impact = analyze(['docs/agent-os/PLAN.md', 'README.md', 'lib/auth.ts']);
    expect(impact.risk).toBe('R4');
  });

  it('escalates a migration to R4 regardless of its domain risk', () => {
    const impact = analyze(['prisma/migrations/20260101000000_add_thing/migration.sql']);
    expect(impact.risk).toBe('R4');
    expect(impact.riskReasons.join(' ')).toMatch(/not locally recoverable/i);
  });

  it('requires independent verification at R3 and above', () => {
    expect(analyze(['lib/ai/gateway.ts']).independentVerification).toBe(true);
    expect(analyze(['components/LeadCard.tsx']).independentVerification).toBe(false);
  });

  it('never implies operator authorization from an ordinary change', () => {
    expect(analyze(['components/LeadCard.tsx']).operatorAuthorization).toBe(false);
    expect(analyze(['scripts/deploy.sh']).operatorAuthorization).toBe(true);
  });

  it('treats an unmapped path as unknown rather than harmless', () => {
    const impact = analyze(['some/unmapped/thing.txt']);
    expect(impact.risk).toBe('R2');
    expect(impact.unclassified).toEqual(['some/unmapped/thing.txt']);
  });
});

describe('skill selection — recall and precision', () => {
  const expectations: Array<{ what: string; files: string[]; wants: string[]; rejects: string[] }> = [
    {
      what: 'a Prisma transaction race',
      files: ['prisma/schema.prisma', 'lib/prisma.ts'],
      wants: ['data-prisma'],
      rejects: ['telestar-ai', 'frontend-role-ux', 'email-deliverability'],
    },
    {
      what: 'a Floor Manager role bug',
      files: ['lib/podScoping.ts', 'lib/leads/service.ts'],
      wants: ['auth-rbac-tenancy', 'product-workflows'],
      rejects: ['telestar-ai', 'production-release'],
    },
    {
      what: 'a duplicate sequence send',
      files: ['lib/sequences/engine.ts', 'workers/sequence.ts'],
      wants: ['email-automation', 'workers-durability'],
      rejects: ['frontend-role-ux', 'telestar-ai', 'documentation'],
    },
    {
      what: 'an AI chat provider failure',
      files: ['lib/ai/gateway.ts', 'app/api/ai/chat/route.ts'],
      wants: ['telestar-ai'],
      rejects: ['data-prisma', 'email-deliverability', 'frontend-role-ux'],
    },
    {
      what: 'a production digest mismatch',
      files: ['.github/workflows/docker-image.yml', 'scripts/build.cjs'],
      wants: ['production-release'],
      rejects: ['telestar-ai', 'frontend-role-ux'],
    },
  ];

  for (const { what, files, wants, rejects } of expectations) {
    it(`${what} loads ${wants.join(' + ')} and nothing irrelevant`, () => {
      const { skills } = analyze(files);
      for (const want of wants) expect(skills, what).toContain(want);
      for (const reject of rejects) expect(skills, what).not.toContain(reject);
    });
  }

  it('never loads more than three skills', () => {
    const impact = analyze([
      'lib/ai/gateway.ts',
      'lib/auth.ts',
      'prisma/schema.prisma',
      'workers/sequence.ts',
      'components/LeadCard.tsx',
      'docker-compose.gcp.yml',
    ]);
    expect(impact.domains.length).toBeGreaterThan(3);
    expect(impact.skills.length).toBeLessThanOrEqual(3);
  });

  it('loads no skill for a documentation-only change', () => {
    const impact = analyze(['docs/agent-os/PLAN.md', 'README.md']);
    expect(impact.risk).toBe('R0');
    expect(impact.skills).toEqual([]);
  });
});

describe('brief', () => {
  it('carries only the memory relevant to the change', () => {
    const brief = compile(['lib/ai/pricing.ts']);
    expect(brief.impact.risk).toBe('R3');
    expect(brief.skills.map((s) => s.id)).toEqual(['telestar-ai']);
    // The migration lesson belongs to data-prisma and must not ride along.
    expect(brief.lessons.join(' ')).not.toMatch(/migration-sorts-by-name/);
  });

  it('surfaces the source authority when the change touches it', () => {
    const brief = compile(['lib/ai/registry.ts']);
    expect(brief.sources.map((s) => s.subject)).toContain('AI models, limits, pricing and parameters');
  });
});

describe('context budget', () => {
  it('keeps startup context inside the hard-review threshold', () => {
    const items = audit();
    const startup = items.find((i) => i.label === 'startup universal context');
    expect(startup).toBeDefined();
    // The measured regression this guards: ~79,300 tokens across 113 always-loaded files.
    expect(startup!.tokens).toBeLessThanOrEqual(startup!.hardReview);
    expect(auditExitCode(items)).toBe(0);
  });

  it('counts only unscoped rules as startup cost', () => {
    const items = audit();
    const startup = items.find((i) => i.label === 'startup universal context');
    // Every .claude/rules file carries `paths:` frontmatter, so none of them load at startup.
    expect(startup!.files.some((f) => f.startsWith('.claude/rules/'))).toBe(false);
  });
});
