import { describe, it, expect } from 'vitest';
import {
  TELESTAR_AI_CONSTITUTION,
  compileConstitutionalPrompt,
} from '@/lib/ai/behavior/telestar-ai-constitution';

describe('Telestar AI Constitution', () => {
  it('enforces strictly ordered priority levels 1 through 10', () => {
    expect(TELESTAR_AI_CONSTITUTION).toHaveLength(10);
    const priorities = TELESTAR_AI_CONSTITUTION.map((p) => p.priority);
    expect(priorities).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('compiles constitutional instructions preserving all security rules', () => {
    const prompt = compileConstitutionalPrompt();
    expect(prompt).toContain('=== TELESTAR AI CONSTITUTION');
    expect(prompt).toContain('SECURITY_ISOLATION');
    expect(prompt).toContain('TENANT_AND_RBAC_AUTHORIZATION');
    expect(prompt).toContain('CRM_FACTUAL_GROUNDING');
    expect(prompt).toContain('ANSWER_FIRST_COMMUNICATION');
  });

  it('prohibits human simulation and fake emotion', () => {
    const noHumanPretense = TELESTAR_AI_CONSTITUTION.find(
      (p) => p.name === 'NO_HUMAN_PRETENSE'
    );
    expect(noHumanPretense).toBeDefined();
    expect(noHumanPretense?.rule).toContain('Never fake emotions');
  });
});
