import { describe, it, expect } from 'vitest';
import { GOLDEN_SCENARIOS } from '@/lib/ai/evals/golden-dataset';
import { detectPromptInjection, scrubSecrets } from '@/lib/ai/engine/security-guards';
import { classifyIntent } from '@/lib/ai/engine/intent-engine';

describe('Telestar AI Master Certification — Evaluation Suite', () => {
  describe('Golden Scenario Evaluation', () => {
    it('accurately resolves intents for all golden scenarios', () => {
      for (const scenario of GOLDEN_SCENARIOS) {
        const intent = classifyIntent(scenario.userMessage);
        expect(intent).toBeDefined();
      }
    });

    it('neutralizes all malicious prompt injection attempts in dataset', () => {
      const injectionScenarios = GOLDEN_SCENARIOS.filter((s) => s.family === 'SECURITY');
      for (const s of injectionScenarios) {
        const check = detectPromptInjection(s.userMessage);
        expect(check.isSuspicious).toBe(true);

        const scrubbed = scrubSecrets(s.userMessage);
        for (const forbidden of s.forbiddenClaims) {
          expect(scrubbed).not.toContain(forbidden);
        }
      }
    });
  });
});
