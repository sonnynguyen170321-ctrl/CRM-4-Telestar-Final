import { describe, it, expect } from 'vitest';
import {
  TELESTAR_AI_CONSTITUTION,
  TELESTAR_AI_CONSTITUTION_VERSION,
  POLICY_PRECEDENCE,
  policyRank,
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

describe('policy precedence (directive XLI)', () => {
  it('orders authority from security down to general model knowledge', () => {
    expect(POLICY_PRECEDENCE[0]).toBe('SECURITY');
    expect(POLICY_PRECEDENCE[1]).toBe('TENANCY_RBAC');
    expect(POLICY_PRECEDENCE[POLICY_PRECEDENCE.length - 1]).toBe('GENERAL_MODEL_KNOWLEDGE');
  });

  it('ranks campaign policy above runtime skills', () => {
    // The rule that makes the ordering worth having: generic coaching guidance can never
    // override what a client campaign says.
    expect(policyRank('CLIENT_CAMPAIGN_POLICY')).toBeLessThan(policyRank('RUNTIME_SKILLS'));
    expect(policyRank('APPROVED_PLAYBOOK')).toBeLessThan(policyRank('RUNTIME_SKILLS'));
    expect(policyRank('CRM_FACTS')).toBeLessThan(policyRank('CLIENT_CAMPAIGN_POLICY'));
  });

  it('lists each layer exactly once', () => {
    expect(new Set(POLICY_PRECEDENCE).size).toBe(POLICY_PRECEDENCE.length);
  });

  it('carries a version, so a behavioural change is explainable', () => {
    expect(TELESTAR_AI_CONSTITUTION_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(compileConstitutionalPrompt()).toContain(TELESTAR_AI_CONSTITUTION_VERSION);
  });
});
