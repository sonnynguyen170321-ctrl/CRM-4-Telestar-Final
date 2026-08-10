import { describe, it, expect } from 'vitest';
import type { Role } from '@prisma/client';

import {
  ALL_CAPABILITIES,
  CAPABILITY_CEILING,
  DEFAULT_AUTONOMY,
  type AgentCapability,
  type AutonomyMode,
} from '@/lib/agent/capabilities';
import { decideCapability } from '@/lib/agent/authorization';
import {
  ALL_WORK_ORDER_TYPES,
  BUDGET_BOUNDS,
  CAPABILITY_PROSPECT_EFFECT,
  DEFAULT_BUDGETS,
  humanOnlyCapabilities,
  isProspectTouching,
  isWorkOrderType,
  leaseModeForType,
  PROSPECT_TOUCHING_CAPABILITIES,
  validateBudgets,
  withBudgetDefaults,
  WORK_ORDER_CAPABILITIES,
  workOrderTypePermits,
  type WorkOrderType,
} from '@/lib/workorders/types';
import {
  decideWorkOrderCapability,
  isNoMorePermissiveThan,
} from '@/lib/workorders/authorization';

/**
 * Work order bounds and budgets (Revenue AI Phase 6a).
 *
 * Pure: no database, no mocks. Everything here is a property of the vocabulary and the
 * composition, and both were written to be checkable without infrastructure precisely so the
 * matrix below can be exhaustive rather than illustrative.
 *
 * Covers Phase 6a acceptance 1, 2, 3 and 9.
 */

const ALL_ROLES: readonly Role[] = [
  'director',
  'floor_manager',
  'team_lead',
  'sdr',
  'leadgen_manager',
  'leadgen',
];

const ALL_MODES: readonly (AutonomyMode | null)[] = [
  null,
  'auto',
  'approval',
  'manager_approval',
  'human_only',
];

describe('every work order type declares an explicit capability set', () => {
  it('covers all nine types with no extras and no gaps', () => {
    expect(ALL_WORK_ORDER_TYPES).toHaveLength(9);
    expect(Object.keys(WORK_ORDER_CAPABILITIES).sort()).toEqual([...ALL_WORK_ORDER_TYPES].sort());
  });

  it('gives every type a non-empty set of real capabilities', () => {
    for (const type of ALL_WORK_ORDER_TYPES) {
      const declared = WORK_ORDER_CAPABILITIES[type];
      expect(declared.length, `${type} declares no capabilities`).toBeGreaterThan(0);
      for (const capability of declared) {
        expect(ALL_CAPABILITIES, `${type} declares unknown "${capability}"`).toContain(capability);
      }
    }
  });

  it('declares no capability twice within a type', () => {
    for (const type of ALL_WORK_ORDER_TYPES) {
      const declared = WORK_ORDER_CAPABILITIES[type];
      expect(new Set(declared).size, `${type} repeats a capability`).toBe(declared.length);
    }
  });

  it('treats an unknown type as permitting nothing rather than everything', () => {
    expect(isWorkOrderType('not_a_type')).toBe(false);
    for (const capability of ALL_CAPABILITIES) {
      expect(workOrderTypePermits('not_a_type' as WorkOrderType, capability)).toBe(false);
    }
  });
});

describe('human-only capabilities appear in no work order type', () => {
  it('excludes every capability the ceiling pins to human_only', () => {
    const humanOnly = humanOnlyCapabilities();
    expect(humanOnly).toContain('prospect_reply');
    expect(humanOnly).toContain('place_call');

    for (const type of ALL_WORK_ORDER_TYPES) {
      for (const capability of humanOnly) {
        expect(
          workOrderTypePermits(type, capability),
          `${type} must not declare human-only "${capability}"`
        ).toBe(false);
      }
    }
  });

  it('keeps place_call impossible for every type, role and stored policy', () => {
    for (const type of ALL_WORK_ORDER_TYPES) {
      for (const role of ALL_ROLES) {
        for (const mode of ALL_MODES) {
          const decision = decideWorkOrderCapability(type, { role }, 'place_call', mode);
          expect(decision.outcome, `${type}/${role}/${mode} let place_call through`).toBe('DENY');
        }
      }
    }
  });

  it('keeps prospect_reply impossible for every type, role and stored policy', () => {
    for (const type of ALL_WORK_ORDER_TYPES) {
      for (const role of ALL_ROLES) {
        for (const mode of ALL_MODES) {
          const decision = decideWorkOrderCapability(type, { role }, 'prospect_reply', mode);
          expect(decision.outcome, `${type}/${role}/${mode} let prospect_reply through`).toBe(
            'DENY'
          );
        }
      }
    }
  });
});

describe('a type cannot invoke a capability outside its set', () => {
  it('denies every undeclared capability, naming the work order as the reason', () => {
    for (const type of ALL_WORK_ORDER_TYPES) {
      const declared = new Set(WORK_ORDER_CAPABILITIES[type]);
      for (const capability of ALL_CAPABILITIES) {
        if (declared.has(capability)) continue;
        const decision = decideWorkOrderCapability(type, { role: 'director' }, capability, 'auto');
        expect(decision.outcome).toBe('DENY');
        expect(decision.reason).toBe('not_permitted_by_work_order_type');
      }
    }
  });

  it('does not consult the agent policy at all when the type forbids the capability', () => {
    // `sequence_design` may draft but never enroll. Even a tenant that set enrollment to `auto`
    // gets a refusal that never reached the policy — which is why `capabilityDecision` is null.
    const decision = decideWorkOrderCapability(
      'sequence_design',
      { role: 'director' },
      'sequence_enroll',
      'auto'
    );
    expect(decision.outcome).toBe('DENY');
    expect(decision.reason).toBe('not_permitted_by_work_order_type');
    expect(decision.capabilityDecision).toBeNull();
  });

  it('keeps campaign_analysis read-only — it may not create tasks or notes', () => {
    for (const capability of ['tasks', 'notes', 'sequence_enroll'] as AgentCapability[]) {
      expect(workOrderTypePermits('campaign_analysis', capability)).toBe(false);
    }
  });
});

describe('work order bounds cannot widen agent capability policy', () => {
  it('covers the complete current vocabulary on every axis', () => {
    // The matrix below is only as strong as its dimensions. Pin each one to the authoritative
    // source so a capability, role or type added later widens the matrix instead of silently
    // leaving a hole in it.
    expect(ALL_WORK_ORDER_TYPES).toHaveLength(9);
    expect(ALL_CAPABILITIES).toHaveLength(16);
    expect([...ALL_ROLES].sort()).toEqual(
      ['director', 'floor_manager', 'leadgen', 'leadgen_manager', 'sdr', 'team_lead'].sort()
    );
    // Five, not four: `null` is "this tenant has stored no policy", which is the state every
    // tenant starts in and therefore the one most worth covering.
    expect(ALL_MODES).toHaveLength(5);
    expect(ALL_MODES).toContain(null);
  });

  it('is never more permissive than the policy alone, across every combination', () => {
    let compared = 0;

    for (const type of ALL_WORK_ORDER_TYPES) {
      for (const capability of ALL_CAPABILITIES) {
        for (const role of ALL_ROLES) {
          for (const mode of ALL_MODES) {
            const underlying = decideCapability({ role }, capability, mode);
            const composed = decideWorkOrderCapability(type, { role }, capability, mode);

            expect(
              isNoMorePermissiveThan(composed.outcome, underlying.outcome),
              `${type}/${capability}/${role}/${mode}: work order widened ${underlying.outcome} to ${composed.outcome}`
            ).toBe(true);
            compared += 1;
          }
        }
      }
    }

    // Guard the guard: a matrix that silently stopped iterating would pass vacuously.
    expect(compared).toBe(
      ALL_WORK_ORDER_TYPES.length * ALL_CAPABILITIES.length * ALL_ROLES.length * ALL_MODES.length
    );
  });

  it('passes an allowed capability through with the policy decision verbatim', () => {
    const underlying = decideCapability({ role: 'sdr' }, 'research', null);
    const composed = decideWorkOrderCapability('research_batch', { role: 'sdr' }, 'research', null);

    expect(composed.outcome).toBe(underlying.outcome);
    expect(composed.mode).toBe(underlying.mode);
    expect(composed.reason).toBe(underlying.reason);
    expect(composed.capabilityDecision).toEqual(underlying);
  });

  it('still refuses a role that lacks the underlying CRM right, inside a permitting type', () => {
    // `outreach_launch` declares `send_window_change`, and the SDR role may not change send
    // windows. Declaring it in the type must not become a grant.
    expect(workOrderTypePermits('outreach_launch', 'send_window_change')).toBe(true);
    const decision = decideWorkOrderCapability(
      'outreach_launch',
      { role: 'sdr' },
      'send_window_change',
      'auto'
    );
    expect(decision.outcome).toBe('DENY');
    expect(decision.reason).toBe('role_not_permitted');
  });

  it('preserves the approval distinction rather than collapsing it to a refusal', () => {
    const decision = decideWorkOrderCapability(
      'outreach_launch',
      { role: 'director' },
      'sequence_enroll',
      null
    );
    expect(DEFAULT_AUTONOMY.sequence_enroll).toBe('approval');
    expect(decision.outcome).toBe('REQUIRE_USER_APPROVAL');
    expect(decision.reason).toBe('policy_requires_approval');
  });

  it('cannot loosen a ceiling by declaring the capability in a type', () => {
    expect(CAPABILITY_CEILING.send_window_change).toBe('manager_approval');
    const decision = decideWorkOrderCapability(
      'outreach_launch',
      { role: 'director' },
      'send_window_change',
      'auto'
    );
    expect(decision.outcome).toBe('REQUIRE_MANAGER_APPROVAL');
  });
});

describe('every capability carries an explicit prospect-effect classification', () => {
  it('classifies the complete capability vocabulary — no gaps, no strays', () => {
    // The ratchet. `CAPABILITY_PROSPECT_EFFECT` is a total `Record<AgentCapability, …>`, so a
    // new capability fails the *build* until it is classified; this asserts the runtime shape
    // too, and catches a stray key that no longer names a real capability.
    expect(Object.keys(CAPABILITY_PROSPECT_EFFECT).sort()).toEqual([...ALL_CAPABILITIES].sort());
  });

  it('uses only the two defined effects', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(
        ['touches_prospect', 'internal'],
        `${capability} has an unrecognised effect`
      ).toContain(CAPABILITY_PROSPECT_EFFECT[capability]);
    }
  });

  it('does not let a new capability default to internal by omission', () => {
    // A capability the classification does not name must read as unclassified rather than as
    // safe. The previous shape was a Set of touching capabilities, which failed open — any
    // future capability was silently `internal`, on the check that decides whether a
    // human-owned prospect can be touched.
    const unclassified = ALL_CAPABILITIES.filter(
      (capability) => CAPABILITY_PROSPECT_EFFECT[capability] === undefined
    );
    expect(unclassified).toEqual([]);
  });

  it('classifies anything the prospect experiences as touching, including place_call', () => {
    for (const capability of [
      'sequence_enroll',
      'send_window_change',
      'reengagement_activate',
      'prospect_reply',
      'place_call',
    ] as AgentCapability[]) {
      expect(CAPABILITY_PROSPECT_EFFECT[capability], `${capability} must touch the prospect`).toBe(
        'touches_prospect'
      );
      expect(PROSPECT_TOUCHING_CAPABILITIES.has(capability)).toBe(true);
    }
  });

  it('keeps drafting and proposing internal — a draft is not a send', () => {
    for (const capability of [
      'draft_reply',
      'sequence_draft',
      'reengagement_propose',
      'call_assistance',
      'summarize',
      'research',
      'notes',
      'tasks',
      'reminders',
      'meeting_prep',
      'objection_help',
    ] as AgentCapability[]) {
      expect(CAPABILITY_PROSPECT_EFFECT[capability], `${capability} should be internal`).toBe(
        'internal'
      );
    }
  });

  it('derives the touching set from the classification rather than restating it', () => {
    const derived = ALL_CAPABILITIES.filter(
      (capability) => CAPABILITY_PROSPECT_EFFECT[capability] === 'touches_prospect'
    );
    expect([...PROSPECT_TOUCHING_CAPABILITIES].sort()).toEqual(derived.sort());
  });
});

describe('prospect-touching and lease mode are derived, not declared', () => {
  it('marks exactly the types whose set can reach the prospect', () => {
    expect(isProspectTouching('outreach_launch')).toBe(true);
    expect(isProspectTouching('reengagement')).toBe(true);

    for (const type of ['research_batch', 'reply_review', 'campaign_analysis'] as WorkOrderType[]) {
      expect(isProspectTouching(type), `${type} should not reach the prospect`).toBe(false);
    }
  });

  it('agrees with the classification it is derived from', () => {
    for (const type of ALL_WORK_ORDER_TYPES) {
      const reaches = WORK_ORDER_CAPABILITIES[type].some((capability) =>
        PROSPECT_TOUCHING_CAPABILITIES.has(capability)
      );
      expect(isProspectTouching(type), `${type} disagrees with its own set`).toBe(reaches);
    }
  });

  it('gives prospect-touching types an exclusive lease and assistance types a shared one', () => {
    for (const type of ALL_WORK_ORDER_TYPES) {
      expect(leaseModeForType(type)).toBe(isProspectTouching(type) ? 'exclusive' : 'shared');
    }
  });
});

describe('budgets are validated and bounded', () => {
  it('accepts a budget set inside the bounds', () => {
    expect(
      validateBudgets({
        researchBudget: 10,
        tokenBudget: 1_000,
        maxToolCalls: 5,
        maxExecutionDuration: 600,
      })
    ).toEqual([]);
  });

  it('rejects a value below the minimum', () => {
    const violations = validateBudgets({ maxToolCalls: 0 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ field: 'maxToolCalls', reason: 'below_minimum' });
  });

  it('rejects a value above the maximum', () => {
    const violations = validateBudgets({ tokenBudget: BUDGET_BOUNDS.tokenBudget.max + 1 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ field: 'tokenBudget', reason: 'above_maximum' });
  });

  it('rejects a non-integer rather than truncating it', () => {
    const violations = validateBudgets({ researchBudget: 1.5 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ field: 'researchBudget', reason: 'not_an_integer' });
  });

  it('reports every violation, not only the first', () => {
    const violations = validateBudgets({
      researchBudget: -1,
      tokenBudget: BUDGET_BOUNDS.tokenBudget.max + 1,
      maxToolCalls: 0,
      maxExecutionDuration: 1,
    });
    expect(violations.map((v) => v.field).sort()).toEqual([
      'maxExecutionDuration',
      'maxToolCalls',
      'researchBudget',
      'tokenBudget',
    ]);
  });

  it('ignores fields the caller did not supply', () => {
    expect(validateBudgets({})).toEqual([]);
  });

  it('bounds every budget field on both sides — none is effectively unlimited', () => {
    for (const [field, bound] of Object.entries(BUDGET_BOUNDS)) {
      expect(Number.isFinite(bound.min), `${field} min is not finite`).toBe(true);
      expect(Number.isFinite(bound.max), `${field} max is not finite`).toBe(true);
      expect(bound.max, `${field} max must exceed min`).toBeGreaterThan(bound.min);
    }
  });

  it('fills unspecified budgets from the defaults, and the defaults are themselves in bounds', () => {
    expect(withBudgetDefaults({ tokenBudget: 42 })).toEqual({
      ...DEFAULT_BUDGETS,
      tokenBudget: 42,
    });
    expect(validateBudgets(DEFAULT_BUDGETS)).toEqual([]);
  });
});
