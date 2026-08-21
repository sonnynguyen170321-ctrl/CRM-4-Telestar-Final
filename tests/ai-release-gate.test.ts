import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * The deployment path must not be able to conclude "deployed successfully" while Telestar AI
 * is unable to answer.
 *
 * This is not hypothetical. On 2026-08-21 the three provider credentials were all present and
 * all rejected — `OPENAI_API_KEY: SET` beside `HTTP 401 Incorrect API key provided`, on every
 * one of the three providers. Every presence-based check in the repository passed. The only
 * thing that would have caught it is a real call, which nothing in `deploy.sh` or either CI
 * workflow made.
 *
 * So these tests assert on the deploy script's text. That is a blunt instrument, and it is the
 * right one here: the alternative is executing a deployment, and a test that deploys is not a
 * test. What is being protected is the *presence and ordering* of gates, which is exactly what
 * the text can prove.
 */

const deploySh = readFileSync('scripts/deploy.sh', 'utf8');
const verifySecretsSh = readFileSync('scripts/verify-container-secrets.sh', 'utf8');
const healthRoute = readFileSync('app/api/health/route.ts', 'utf8');

/** Index of the first line matching `pattern`, or -1. Used to assert gate ordering. */
function lineOf(source: string, pattern: RegExp): number {
  return source.split('\n').findIndex((line) => pattern.test(line));
}

describe('deploy.sh runs the Telestar AI release gates', () => {
  it('declares a gate helper that aborts the deployment on failure', () => {
    // Every AI gate goes through one helper, so "did someone add `|| true`" is a question
    // about one function rather than about four scattered command invocations.
    expect(deploySh).toMatch(/ai_gate\(\)\s*\{/);
    const helper = deploySh.slice(deploySh.indexOf('ai_gate()'));
    expect(helper.slice(0, helper.indexOf('\n}'))).toMatch(/fail /);
  });

  it('verifies the environment contract before anything is changed', () => {
    const gate = lineOf(deploySh, /ai_gate .*env-contract/);
    const backup = lineOf(deploySh, /Back up before any migration/);
    expect(gate).toBeGreaterThan(-1);
    // Before the backup prompt, so a missing key costs an operator nothing but a re-run.
    expect(gate).toBeLessThan(backup);
  });

  it('confirms the running containers received the credentials, after the swap', () => {
    const swap = lineOf(deploySh, /Starting web and worker on the new digest/);
    const gate = lineOf(deploySh, /ai_gate .*container-secrets/);
    expect(gate).toBeGreaterThan(swap);
    expect(deploySh).toMatch(/verify-container-secrets\.sh/);
  });

  it('makes a real provider call from inside the image that will serve traffic', () => {
    // The gate this whole file exists for. A key that parses is not a key that works.
    // Asserted as two halves rather than one dotAll regex: the `s` flag needs an es2018 lib
    // target this project does not set, and the split reads as the clearer statement anyway.
    expect(deploySh).toMatch(/ai_gate [^\n]*provider-smoke/);
    expect(deploySh).toContain('scripts/ai-provider-smoke.ts');
  });

  it('proves the worker can reach the providers, not only web', () => {
    // A worker without credentials fails every background AI job while the chatbox looks
    // perfectly healthy. Web passing is not evidence about the worker.
    const gates = deploySh.match(/ai_gate [^\n]*provider-smoke[^\n]*/g) ?? [];
    expect(gates.some((g) => /\bweb\b/.test(g))).toBe(true);
    expect(gates.some((g) => /\bworker\b/.test(g))).toBe(true);
  });

  it('exercises the gateway — routing, failover and streaming — not just raw providers', () => {
    expect(deploySh).toMatch(/ai_gate [^\n]*gateway-smoke/);
    expect(deploySh).toContain('scripts/ai-gateway-smoke.ts');
  });

  it('runs every AI gate before the application smoke test', () => {
    const lastAiGate = deploySh.split('\n').reduce(
      (acc, line, i) => (/ai_gate /.test(line) ? i : acc),
      -1,
    );
    const appSmoke = lineOf(deploySh, /post-deploy-smoke\.sh/);
    expect(lastAiGate).toBeGreaterThan(-1);
    expect(lastAiGate).toBeLessThan(appSmoke);
  });

  it('records the AI gate outcome in the deployment record', () => {
    // A release record that cannot say whether AI worked is how "deployment green, AI broken"
    // became invisible for as long as it did.
    expect(deploySh).toMatch(/AI_GATE_RESULTS/);
    expect(deploySh).toMatch(/aiGates/);
  });

  it('never lets an AI gate be skipped by an environment variable', () => {
    // A `SKIP_AI_GATES=1` escape hatch is how a mandatory gate becomes optional in a hurry.
    expect(deploySh).not.toMatch(/SKIP_AI|AI_GATES?_(SKIP|DISABLED|OPTIONAL)/i);
  });
});

describe('verify-container-secrets.sh works where deploy.sh runs it', () => {
  it('honours the DOCKER override deploy.sh uses', () => {
    // deploy.sh defaults DOCKER to `sudo docker`. A hard-coded `docker compose` here fails on
    // the VM with a permission error, which reads exactly like a missing credential.
    expect(verifySecretsSh).toMatch(/DOCKER="\$\{DOCKER:-/);
    expect(verifySecretsSh).not.toMatch(/^\s*if docker compose /m);
  });

  it('still reports presence only, never key material', () => {
    expect(verifySecretsSh).toMatch(/SET/);
    for (const leak of [/\$\{?OPENAI_API_KEY\}?"/, /cut -c/, /\$\{#/, /head -c/]) {
      expect(verifySecretsSh).not.toMatch(leak);
    }
  });
});

describe('the load-balancer health endpoint stays free of provider calls', () => {
  it('does not reach a provider, a gateway or a circuit breaker', () => {
    // Directive §1: an external provider outage must not trigger infrastructure restarts.
    // AI health belongs on /api/ai/status, which is authenticated and ledger-derived.
    expect(healthRoute).not.toMatch(/ai\/gateway|ai\/router|ai\/circuitBreaker|openai|groq-sdk|generative-ai/);
  });
});
