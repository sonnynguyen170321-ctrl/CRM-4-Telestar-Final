import { describe, it, expect } from 'vitest';
import { classifyIntent, categorizeTemporalDelta } from '@/lib/ai/engine/intent-engine';
import { resolveSituation } from '@/lib/ai/engine/situation-engine';

describe('Telestar AI Cognitive Engine', () => {
  describe('Intent & Temporal Classification', () => {
    it('classifies direct action intents with mutation flags', () => {
      const result = classifyIntent('move this lead to Jackie');
      expect(result.intent).toBe('EXECUTE_ACTION');
      expect(result.requiresMutation).toBe(true);
      expect(result.requiredDepth).toBe('ACTION');
    });

    it('classifies diagnostic questions into DIAGNOSE intent', () => {
      const result = classifyIntent("why did the APAC campaign conversion drop yesterday?");
      expect(result.intent).toBe('DIAGNOSE');
      expect(result.temporalFrame).toBe('RECENT');
      expect(result.requiredDepth).toBe('DIAGNOSTIC');
    });

    it('determines relative time frames accurately', () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const delta = categorizeTemporalDelta(twoHoursAgo, now);

      expect(delta.frame).toBe('NOW');
      expect(delta.relativeString).toBe('just now');
    });
  });

  describe('Situation Normalization', () => {
    it('normalizes known CRM surfaces', async () => {
      const situation = await resolveSituation({
        actor: {
          id: 'user_1',
          email: 'director@telestar.io',
          role: 'director',
          tenantId: 'tenant_1',
        },
        surface: '/campaigns/cmp_123',
      });

      expect(situation.surface).toBe('campaigns');
      expect(situation.actor.isManager).toBe(true);
      expect(situation.actor.canExport).toBe(true);
    });
  });
});
