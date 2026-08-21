import { describe, it, expect } from 'vitest';
import { GOLDEN_SCENARIOS, EVAL_FAMILIES, type GoldenScenario } from '@/lib/ai/evals/golden-dataset';
import { detectPromptInjection, scrubSecrets } from '@/lib/ai/engine/security-guards';

/**
 * The evaluation suite that certification counts.
 *
 * What this replaced asserted nothing. It called `classifyIntent` and checked the result was
 * `toBeDefined()` — the function returns a non-nullable object, so that check could not fail
 * for any input, including an empty string. `expectedIntent` sat in the dataset unread, and
 * one scenario declared `EXECUTIVE`, which is not a member of `AiIntent` at all; it is a
 * `requiredDepth` value. A single real comparison would have caught that on the first run.
 *
 * The injection test had the same shape: it ran `scrubSecrets` over the *user's own message*
 * and asserted the result did not contain `postgresql://`. The message never contained it. The
 * scrubber's actual job — removing credentials from text on its way *out* — was never exercised.
 *
 * So the rule here is: every field the dataset declares is asserted, or it is deleted from the
 * dataset. A field that is documented but unchecked is worse than an absent one, because it
 * reads as coverage.
 */

describe('Telestar AI evaluation suite — dataset integrity', () => {
  it('gives every scenario a unique id', () => {
    const ids = GOLDEN_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares no family that has no scenarios', () => {
    // `TEAM_LEAD` and `FLOOR_MANAGER` were declared in the union and never populated, so the
    // type promised coverage the dataset did not have.
    const populated = new Set(GOLDEN_SCENARIOS.map((s) => s.family));
    const empty = EVAL_FAMILIES.filter((family) => !populated.has(family));
    expect(empty).toEqual([]);
  });

  it('covers all six roles', () => {
    const roles = new Set(GOLDEN_SCENARIOS.map((s) => s.role));
    const required: Array<GoldenScenario['role']> = [
      'director', 'floor_manager', 'team_lead', 'sdr', 'leadgen_manager', 'leadgen',
    ];
    for (const role of required) {
      expect(roles.has(role)).toBe(true);
    }
  });
});

// The intent block that stood here compared `expectedIntent` against
// `lib/ai/engine/intent-engine.ts`. That module was unreachable from every production
// entry point, so the comparison measured nothing a user could experience — and it
// disagreed with the dataset on three of four scenarios, including one expectation
// (`EXECUTIVE`) that is not a member of `AiIntent` at all. The module is deleted; when a
// real intent stage exists on the live path, its scenarios belong here with it.

describe('Telestar AI evaluation suite — adversarial', () => {
  it('flags every adversarial scenario as suspicious', () => {
    const adversarial = GOLDEN_SCENARIOS.filter((s) => s.family === 'SECURITY');
    expect(adversarial.length).toBeGreaterThan(0);

    const missed: string[] = [];
    for (const s of adversarial) {
      if (!detectPromptInjection(s.userMessage).isSuspicious) missed.push(s.id);
    }
    expect(missed).toEqual([]);
  });

  it('does not flag ordinary CRM questions as injection', () => {
    // A guard that flags everything is not a guard; it is an outage. False positives are the
    // failure mode that gets a security control switched off in production.
    const benign = GOLDEN_SCENARIOS.filter((s) => s.family !== 'SECURITY');
    const falsePositives = benign
      .filter((s) => detectPromptInjection(s.userMessage).isSuspicious)
      .map((s) => s.id);
    expect(falsePositives).toEqual([]);
  });

  it('scrubs credentials out of text that actually contains them', () => {
    // Exercises the scrubber on its real input: model or tool output on the way to a user.
    //
    // Every value below is a syntactically valid but fabricated credential. The three provider
    // formats matter most: they are the credentials this deployment actually holds, and the
    // original pattern list covered none of them.
    const leaky: Array<[label: string, text: string, secret: string]> = [
      [
        'Postgres URL',
        'The connection string is postgresql://crm:hunter2@10.20.30.40:5432/telestar_crm',
        'postgresql://crm:hunter2@10.20.30.40:5432/telestar_crm',
      ],
      [
        'Telestar API token',
        'Token tl_live_abcdef0123456789abcdef0123456789 grants access',
        'tl_live_abcdef0123456789abcdef0123456789',
      ],
      [
        'GitHub PAT',
        'Push with ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      ],
      [
        'OpenAI project key',
        'Use api key sk-proj-abcdEFGH1234ijklMNOP5678qrstUVWX9012yzABcdef for this',
        'sk-proj-abcdEFGH1234ijklMNOP5678qrstUVWX9012yzABcdef',
      ],
      [
        'Google API key',
        'Gemini reads AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R from env',
        'AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R',
      ],
      [
        'Groq key',
        'GROQ_API_KEY=gsk_ABCdef123456GHIjkl789012MNOpqr345678 in the container',
        'gsk_ABCdef123456GHIjkl789012MNOpqr345678',
      ],
      [
        'AWS access key id',
        'Credentials AKIAIOSFODNN7EXAMPLE were rotated',
        'AKIAIOSFODNN7EXAMPLE',
      ],
    ];

    const leaked: string[] = [];
    for (const [label, text, secret] of leaky) {
      if (scrubSecrets(text).includes(secret)) leaked.push(label);
    }
    expect(leaked).toEqual([]);
  });

  it('leaves ordinary text alone while scrubbing', () => {
    // A scrubber that redacts prose is one that gets removed. Both halves are the contract.
    const ordinary = 'Sarah replied yesterday and is overdue for follow-up on the Acme campaign.';
    expect(scrubSecrets(ordinary)).toBe(ordinary);
  });

  it('declares forbidden claims that are usable by the live-model suite', () => {
    // `forbiddenClaims` describes what a *model answer* must not contain, so it cannot be
    // asserted without a model. The version of this test that shipped here checked that the
    // user's own message did not contain the phrase — which it always does, since the phrase
    // is drawn from the request. That assertion could only pass or fail by accident.
    //
    // What this suite can check is that the contract is well-formed for the suite that will
    // consume it: non-empty strings, no duplicates within a scenario.
    for (const scenario of GOLDEN_SCENARIOS) {
      for (const claim of scenario.forbiddenClaims) {
        expect(claim.trim().length).toBeGreaterThan(0);
      }
      expect(new Set(scenario.forbiddenClaims).size).toBe(scenario.forbiddenClaims.length);
    }
  });
});
