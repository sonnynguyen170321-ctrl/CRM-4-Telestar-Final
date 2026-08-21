import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { ROLE_POLICIES, ROLE_POLICY_VERSION, rolePolicyPrompt } from '@/lib/ai/roles/policy';
import { compileConstitutionalPrompt } from '@/lib/ai/behavior/telestar-ai-constitution';

/**
 * Role lists go stale, and this repository has been bitten by it.
 *
 * `AGENTS.md` says six roles, "not four", and that role lists are generated and drift-checked
 * rather than written down. The AI constitution had written one down anyway — "Director, Floor
 * Manager, Team Lead, SDR, Leadgen Manager, Admin" — which invents a role the system does not
 * have and omits one it does. The chat prompt did worse: a ternary that sorted six roles into
 * two buckets and addressed a Leadgen researcher as "This SDR".
 *
 * So the check here is against `.agent/generated/role-map.json`, which is derived from
 * `lib/auth.ts` and friends by `npm run agent -- facts`. If a seventh role is added, or one is
 * renamed, this fails until the policy catches up — which is the point.
 */

const roleMap = JSON.parse(readFileSync('.agent/generated/role-map.json', 'utf8')) as {
  roles: string[];
  count: number;
};

describe('role policy', () => {
  it('covers exactly the roles the generated map declares', () => {
    expect(Object.keys(ROLE_POLICIES).sort()).toEqual([...roleMap.roles].sort());
  });

  it('agrees with the generated count, so "six not four" stays true', () => {
    expect(Object.keys(ROLE_POLICIES)).toHaveLength(roleMap.count);
  });

  it('invents no role the system does not have', () => {
    for (const role of Object.keys(ROLE_POLICIES)) {
      expect(roleMap.roles, `${role} is not a real role`).toContain(role);
    }
  });

  it('gives every role a distinct mandate', () => {
    // The defect this replaced gave a Floor Manager and a Leadgen Manager the same sentence,
    // despite one balancing rep workload and the other managing lead supply.
    const mandates = Object.values(ROLE_POLICIES).map((p) => p.mandate);
    expect(new Set(mandates).size).toBe(mandates.length);
  });

  it('says something concrete for every role', () => {
    for (const [role, policy] of Object.entries(ROLE_POLICIES)) {
      expect(policy.mandate.trim().length, role).toBeGreaterThan(0);
      expect(policy.scope.trim().length, role).toBeGreaterThan(0);
      expect(policy.leadWith.length, role).toBeGreaterThan(0);
      expect(policy.neverOffer.length, role).toBeGreaterThan(0);
    }
  });

  describe('the prompt block', () => {
    it('names the role and carries both halves of the policy', () => {
      const block = rolePolicyPrompt('team_lead');
      expect(block).toContain('[Role: Team Lead]');
      expect(block).toContain('Scope:');
      expect(block).toContain('Lead with:');
      expect(block).toContain('Never offer:');
    });

    it('does not call a Leadgen researcher an SDR', () => {
      // The literal defect.
      const block = rolePolicyPrompt('leadgen');
      expect(block).toContain('Leadgen Researcher');
      expect(block).not.toContain('This SDR');
    });

    it('falls back to the most restricted policy for an unrecognised role', () => {
      // `role` is a String column with no database enum behind it, so an unexpected value is
      // possible. The safe direction is the narrowest policy, never a permissive default, and
      // never a throw that costs the user their chat.
      expect(rolePolicyPrompt('not_a_role')).toBe(rolePolicyPrompt('sdr'));
    });
  });

  it('is versioned, so an answer-quality regression can be tied to a policy', () => {
    expect(ROLE_POLICY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('the AI constitution', () => {
  it('names no role the system does not have', () => {
    // It said "Admin". There is no admin role; there is `leadgen`, which it omitted.
    //
    // Checked against the compiled prompt rather than the source file: the source now carries a
    // comment naming the old list to explain the fix, and a check that cannot tell a comment
    // from a rule would forbid documenting the defect it exists to prevent.
    const prompt = compileConstitutionalPrompt();
    expect(prompt).not.toMatch(/\bAdmin\b/);
    expect(prompt).toContain('Leadgen');
  });
});
