import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { load as loadYaml } from 'js-yaml';

import { analyze } from '@/scripts/agent/impact';
import { compile } from '@/scripts/agent/brief';

/**
 * Golden engineering tasks (§XLIX, §LVII).
 *
 * Each fixture is a defect this repository actually paid for. The question they answer is the
 * one the whole control plane exists for: given the files a fix would touch, does an agent
 * with **no conversation history** arrive at the right domain, risk, skills and tests?
 *
 * Deterministic and cheap — no agent runs here, only the routing. Full agent benchmarks are
 * periodic (§XLIX), not per-commit.
 */

interface GoldenTask {
  id: string;
  title: string;
  paths: string[];
  expects: {
    domains: string[];
    risk: string;
    skills: string[];
    not_skills?: string[];
    independent_verification?: boolean;
    operator_authorization?: boolean;
  };
}

const tasks = (
  loadYaml(
    readFileSync(path.join(process.cwd(), '.agent/evals/golden-tasks/tasks.yaml'), 'utf8'),
  ) as { tasks: GoldenTask[] }
).tasks;

describe('golden tasks', () => {
  it('has fixtures to run', () => {
    // A suite that iterates an empty list passes while proving nothing — the same failure
    // shape as a provider smoke test that probes zero providers.
    expect(tasks.length).toBeGreaterThanOrEqual(8);
  });

  for (const task of tasks) {
    describe(`${task.id} — ${task.title}`, () => {
      const impact = analyze(task.paths);

      it('routes to the expected domains and no others', () => {
        expect(impact.domains.map((d) => d.id).sort()).toEqual([...task.expects.domains].sort());
      });

      it(`classifies as ${task.expects.risk}`, () => {
        expect(impact.risk).toBe(task.expects.risk);
      });

      it('selects the expected skills', () => {
        for (const skill of task.expects.skills) expect(impact.skills).toContain(skill);
        expect(impact.skills.length).toBeLessThanOrEqual(3);
      });

      it('selects no irrelevant skill', () => {
        for (const skill of task.expects.not_skills ?? []) {
          expect(impact.skills, `${task.id} loaded ${skill}`).not.toContain(skill);
        }
      });

      if (task.expects.independent_verification !== undefined) {
        it(`${task.expects.independent_verification ? 'requires' : 'does not require'} an independent verifier`, () => {
          expect(impact.independentVerification).toBe(task.expects.independent_verification);
        });
      }

      if (task.expects.operator_authorization !== undefined) {
        it('flags the production authorization boundary', () => {
          expect(impact.operatorAuthorization).toBe(task.expects.operator_authorization);
        });
      }

      it('names target tests, so the agent knows what to run', () => {
        // A brief that identifies the domain but not what proves the fix leaves the most
        // expensive part of the loop to guesswork.
        expect(impact.tests.length + impact.e2e.length).toBeGreaterThan(0);
      });

      it('compiles a brief that carries only relevant memory', () => {
        const brief = compile(task.paths);
        expect(brief.impact.risk).toBe(task.expects.risk);
        // Memory is matched by domain; an unrelated domain's lesson riding along is exactly
        // the untargeted-context problem this replaced.
        expect(brief.lessons.length + brief.adrs.length).toBeLessThanOrEqual(8);
      });
    });
  }
});

describe('fresh-agent acceptance (§LVII)', () => {
  /**
   * The deterministic half of the acceptance test: seven representative task types, each
   * routed from paths alone. What a *capable* agent then does with that brief cannot be
   * asserted here — but "did it get the right context without reading obsolete history" can,
   * and that is the part the control plane is responsible for.
   */
  const scenarios: Array<{ what: string; paths: string[]; risk: string; domain: string }> = [
    { what: 'normal UI bug', paths: ['components/LeadCard.tsx'], risk: 'R1', domain: 'frontend-role-ux' },
    { what: 'RBAC change', paths: ['lib/podScoping.ts'], risk: 'R4', domain: 'auth-rbac-tenancy' },
    { what: 'worker concurrency issue', paths: ['workers/import.ts'], risk: 'R3', domain: 'workers-durability' },
    { what: 'email automation problem', paths: ['lib/automation/scheduling.ts'], risk: 'R3', domain: 'email-automation' },
    { what: 'AI provider problem', paths: ['lib/ai/router.ts'], risk: 'R3', domain: 'telestar-ai' },
    { what: 'leadgen workflow bug', paths: ['lib/leadgen/pool.ts'], risk: 'R2', domain: 'leadgen-intelligence' },
    { what: 'production release investigation', paths: ['docker-compose.gcp.yml'], risk: 'R4', domain: 'production-release' },
  ];

  for (const scenario of scenarios) {
    it(`${scenario.what} → ${scenario.domain} (${scenario.risk})`, () => {
      const brief = compile(scenario.paths);
      expect(brief.impact.domains.map((d) => d.id)).toContain(scenario.domain);
      expect(brief.impact.risk).toBe(scenario.risk);
      expect(brief.skills.length).toBeGreaterThan(0);
      expect(brief.skills.length).toBeLessThanOrEqual(3);
    });
  }

  it('never loads the whole portfolio for one task', () => {
    for (const scenario of scenarios) {
      expect(compile(scenario.paths).skills.length).toBeLessThanOrEqual(3);
    }
  });
});
