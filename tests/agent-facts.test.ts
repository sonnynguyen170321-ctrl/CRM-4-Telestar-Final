import { describe, it, expect } from 'vitest';

import {
  projectFacts,
  roleMap,
  routeMap,
  aiContract,
  envContract,
  queueMap,
} from '@/scripts/agent/facts';
import { MODEL_REGISTRY } from '@/lib/ai/registry';
import { AI_PROVIDER_ENV, PRODUCTION_REQUIRED_ENV } from '@/lib/env-contract';

/**
 * The generators are only worth having if they cannot be confidently empty.
 *
 * That is not hypothetical here: the first queue generator grepped for `new Queue('name')`,
 * found nothing — the names are a `QUEUES` constant and the single `new Queue(` call passes a
 * variable — and wrote `"queues": []` without failing. A generated fact that is silently empty
 * is worse than no generator, because a downstream document can now cite it.
 *
 * So every test below asserts a non-empty result *and* a property tying it to its source.
 */

describe('generated project facts', () => {
  it('lists the stack and every npm script', () => {
    const { data } = projectFacts() as { data: Record<string, unknown> };
    const stack = data.stack as Array<{ package: string }>;
    const scripts = data.scripts as string[];

    expect(stack.map((s) => s.package)).toContain('next');
    expect(stack.map((s) => s.package)).toContain('prisma');
    expect(scripts).toContain('agent');
    expect(scripts.length).toBeGreaterThan(20);
  });
});

describe('generated role map', () => {
  it('finds exactly the six roles', () => {
    const { data } = roleMap() as { data: Record<string, unknown> };
    expect(data.roles).toEqual([
      'director',
      'floor_manager',
      'leadgen',
      'leadgen_manager',
      'sdr',
      'team_lead',
    ]);
    expect(data.count).toBe(6);
  });

  it('is never empty — an empty role map would read as "no roles exist"', () => {
    const { data } = roleMap() as { data: { roles: string[] } };
    expect(data.roles.length).toBeGreaterThan(0);
  });
});

describe('generated route map', () => {
  it('finds pages and API routes', () => {
    const { data } = routeMap() as { data: Record<string, unknown> };
    expect(data.pageCount as number).toBeGreaterThan(10);
    expect(data.apiRouteCount as number).toBeGreaterThan(50);
    expect(data.pages as string[]).toContain('/');
  });
});

describe('generated AI contract', () => {
  it('matches the registry exactly, because it is imported from it', async () => {
    const { data } = (await aiContract()) as { data: Record<string, unknown> };
    const models = data.models as Array<{ modelId: string; contextLimit: number }>;

    expect(models).toHaveLength(Object.keys(MODEL_REGISTRY).length);
    for (const model of models) {
      expect(MODEL_REGISTRY[model.modelId]).toBeDefined();
      expect(model.contextLimit).toBe(MODEL_REGISTRY[model.modelId].contextLimit);
    }
  });

  it('carries the alias invariant', async () => {
    const { data } = (await aiContract()) as { data: Record<string, unknown> };
    const models = data.models as Array<{ aliasEqualsModelId: boolean }>;
    expect(models.every((m) => m.aliasEqualsModelId)).toBe(true);
  });
});

describe('generated environment contract', () => {
  it('requires all three AI providers, not just one', async () => {
    // The drift this pins: lib/env.ts warned about GROQ_API_KEY alone while
    // scripts/prod-check-env.ts required all three, so a deployment missing two providers
    // booted silently and had no failover.
    const { data } = (await envContract()) as { data: Record<string, unknown> };
    expect(data.aiProviders).toEqual([...AI_PROVIDER_ENV]);
    expect((data.aiProviders as string[]).length).toBe(3);

    const groups = data.optionalGroups as Record<string, string[]>;
    expect(groups['Telestar AI providers']).toEqual([...AI_PROVIDER_ENV]);
  });

  it('keeps the production required set and the AI providers consistent', async () => {
    const { data } = (await envContract()) as { data: Record<string, unknown> };
    for (const key of AI_PROVIDER_ENV) {
      expect(data.productionRequired as string[]).toContain(key);
    }
    expect(data.productionRequired).toEqual([...PRODUCTION_REQUIRED_ENV]);
  });

  it('reports names only — no generator may read a credential value', async () => {
    const { data } = (await envContract()) as { data: unknown };
    // Every string in the output is a variable name, a group label or prose. If a generator
    // ever started reading values, a key-shaped string would appear here.
    const serialized = JSON.stringify(data);
    expect(serialized).not.toMatch(/(sk|gsk|AIza)[A-Za-z0-9_-]{10,}/);
  });
});

describe('generated queue map', () => {
  it('finds the real queues, imported rather than pattern-matched', async () => {
    const { data } = (await queueMap()) as { data: Record<string, unknown> };
    const queues = data.queues as string[];

    // The regression: this was [] and nothing failed.
    expect(queues.length).toBeGreaterThan(0);
    expect(queues).toContain('sequence');
    expect(queues).toContain('email');
    expect(data.workerEntrypoints as string[]).toContain('workers/sequence.ts');
    expect((data.jobTypes as string[]).length).toBeGreaterThan(0);
  });
});
