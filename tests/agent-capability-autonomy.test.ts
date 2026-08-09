import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ALL_CAPABILITIES,
  CAPABILITY_CEILING,
  DEFAULT_AUTONOMY,
  WRITE_CAPABILITIES,
  strictest,
  type AgentCapability,
  type AutonomyMode,
} from '@/lib/agent/capabilities';
import { decideCapability, resolveMode } from '@/lib/agent/authorization';
import { TOOL_CAPABILITY, capabilityForTool } from '@/lib/agent/toolCapabilities';
import { AI_TOOLS } from '@/lib/ai/tools';

/**
 * Capability-based autonomy (Revenue AI Phase 2).
 *
 * The rule this phase exists to enforce: autonomy is per capability, it layers on top of CRM
 * role authorization rather than replacing it, and no write-capable tool runs outside it.
 */

const SDR = { role: 'sdr' as const };
const DIRECTOR = { role: 'director' as const };
const FLOOR_MANAGER = { role: 'floor_manager' as const };

const ALL_MODES: AutonomyMode[] = ['auto', 'approval', 'manager_approval', 'human_only'];

describe('capability vocabulary', () => {
  it('every capability has a default', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(DEFAULT_AUTONOMY[capability], `no default for ${capability}`).toBeDefined();
    }
  });

  it('no default is looser than its ceiling', () => {
    // A default above the ceiling would be dead configuration that reads as permission.
    for (const [capability, ceiling] of Object.entries(CAPABILITY_CEILING)) {
      const def = DEFAULT_AUTONOMY[capability as AgentCapability];
      expect(strictest(def, ceiling as AutonomyMode)).toBe(
        resolveMode(capability as AgentCapability, def)
      );
    }
  });

  it('strictest() never returns the looser of two modes', () => {
    expect(strictest('auto', 'human_only')).toBe('human_only');
    expect(strictest('human_only', 'auto')).toBe('human_only');
    expect(strictest('approval', 'manager_approval')).toBe('manager_approval');
    expect(strictest('auto', 'auto')).toBe('auto');
  });
});

describe('prospect_reply is unreachable at every setting', () => {
  it.each(ALL_MODES)('stored mode %s still denies', (mode) => {
    // Level 4 autonomy is out of scope for the whole plan. A policy row is not the place to
    // reopen that decision, so the ceiling wins over anything stored.
    const decision = decideCapability(DIRECTOR, 'prospect_reply', mode);
    expect(decision.outcome).toBe('DENY');
    expect(decision.reason).toBe('capability_is_human_only');
  });

  it('denies for every role', () => {
    for (const role of ['director', 'floor_manager', 'team_lead', 'sdr', 'leadgen_manager', 'leadgen'] as const) {
      expect(decideCapability({ role }, 'prospect_reply', 'auto').outcome).toBe('DENY');
    }
  });
});

describe('ceilings cap what a stored policy may loosen', () => {
  it('send_window_change cannot be dropped below manager approval', () => {
    expect(resolveMode('send_window_change', 'auto')).toBe('manager_approval');
    expect(resolveMode('send_window_change', 'approval')).toBe('manager_approval');
    // Stricter than the ceiling is allowed — a tenant may always tighten.
    expect(resolveMode('send_window_change', 'human_only')).toBe('human_only');
  });

  it('sequence_enroll and reengagement_activate cannot become automatic', () => {
    expect(resolveMode('sequence_enroll', 'auto')).toBe('approval');
    expect(resolveMode('reengagement_activate', 'auto')).toBe('approval');
  });

  it('a capability with no ceiling honours the stored mode', () => {
    expect(resolveMode('research', 'human_only')).toBe('human_only');
    expect(resolveMode('notes', 'approval')).toBe('approval');
  });
});

describe('autonomy layers on top of CRM role authorization', () => {
  it('cannot grant an SDR a right the role does not have', () => {
    // send_window_change belongs to the roles that answer for domain reputation. Setting the
    // capability to auto for an SDR must not become a way around lib/sequences/permissions.ts.
    const decision = decideCapability(SDR, 'send_window_change', 'auto');
    expect(decision.outcome).toBe('DENY');
    expect(decision.reason).toBe('role_not_permitted');
  });

  it('still applies the mode for a role that does hold the right', () => {
    const decision = decideCapability(FLOOR_MANAGER, 'send_window_change', 'auto');
    expect(decision.outcome).toBe('REQUIRE_MANAGER_APPROVAL');
    expect(decision.reason).toBe('policy_requires_manager_approval');
  });

  it('role denial beats a permissive policy in both directions', () => {
    for (const mode of ALL_MODES) {
      expect(decideCapability(SDR, 'send_window_change', mode).outcome).toBe('DENY');
    }
  });
});

describe('defaults keep the agent usable without making it dangerous', () => {
  it('assistance and low-risk writes are automatic', () => {
    for (const capability of ['research', 'summarize', 'draft_reply', 'objection_help', 'meeting_prep', 'notes', 'tasks', 'reminders'] as const) {
      expect(decideCapability(SDR, capability, null).outcome, capability).toBe('ALLOW');
    }
  });

  it('anything that reaches a prospect requires a human', () => {
    expect(decideCapability(SDR, 'sequence_enroll', null).outcome).toBe('REQUIRE_USER_APPROVAL');
    expect(decideCapability(SDR, 'reengagement_activate', null).outcome).toBe('REQUIRE_USER_APPROVAL');
    expect(decideCapability(SDR, 'prospect_reply', null).outcome).toBe('DENY');
  });

  it('a tenant may always tighten a default', () => {
    expect(decideCapability(SDR, 'notes', 'approval').outcome).toBe('REQUIRE_USER_APPROVAL');
    expect(decideCapability(SDR, 'research', 'human_only').outcome).toBe('DENY');
  });
});

describe('tool registry', () => {
  it('every declared tool maps to a capability', () => {
    // A tool with no entry is refused at runtime, but an unmapped tool is still a bug — it
    // means someone shipped a capability nobody classified.
    for (const tool of AI_TOOLS) {
      expect(capabilityForTool(tool.function.name), `unmapped tool ${tool.function.name}`).toBeDefined();
    }
  });

  it('has no entries for tools that do not exist', () => {
    const declared = new Set(AI_TOOLS.map((t) => t.function.name));
    for (const name of Object.keys(TOOL_CAPABILITY)) {
      expect(declared.has(name), `stale mapping for ${name}`).toBe(true);
    }
  });

  it('create_task is mapped to a write capability, not grandfathered', () => {
    // It predates this phase and already wrote to the CRM. "It was here first" is not an
    // exemption from the policy the phase exists to establish.
    const capability = capabilityForTool('create_task');
    expect(capability).toBe('tasks');
    expect(WRITE_CAPABILITIES.has(capability!)).toBe(true);
  });

  it('an unregistered tool resolves to undefined so the caller can fail closed', () => {
    expect(capabilityForTool('delete_everything')).toBeUndefined();
  });
});

describe('executeTool enforcement', () => {
  const mockFindUnique = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    mockFindUnique.mockReset();
    mockFindUnique.mockResolvedValue(null);
  });

  async function loadTools(policyMode: AutonomyMode | null) {
    mockFindUnique.mockResolvedValue(policyMode ? { mode: policyMode } : null);
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        autonomyPolicy: { findUnique: (...a: unknown[]) => mockFindUnique(...a) },
        aiCall: { create: vi.fn().mockResolvedValue({}) },
      },
    }));
    return import('@/lib/ai/tools');
  }

  it('refuses an unregistered tool without executing anything', async () => {
    const { executeTool } = await loadTools(null);
    const result = await executeTool('drop_database', {}, {
      userId: 'u1',
      today: '2026-08-10',
      role: 'director',
      tenantId: 't1',
    });
    expect(result).toMatch(/not registered/i);
  });

  it('refuses a write-capable tool when the role is missing from context', async () => {
    const { executeTool } = await loadTools(null);
    const result = await executeTool('create_task', { title: 'x', channel: 'email', dueDate: '2026-08-11' }, {
      userId: 'u1',
      today: '2026-08-10',
      tenantId: 't1',
    });
    // Unknown role must not resolve more permissively than a known one.
    expect(result).toMatch(/role/i);
    expect(result).toMatch(/no changes were made/i);
  });

  it('blocks a write tool when policy requires approval, and says so rather than implying success', async () => {
    const { executeTool } = await loadTools('approval');
    const result = await executeTool('create_task', { title: 'x', channel: 'email', dueDate: '2026-08-11' }, {
      userId: 'u1',
      today: '2026-08-10',
      role: 'sdr',
      tenantId: 't1',
    });
    expect(result).toMatch(/needs approval/i);
    expect(result).toMatch(/do not describe it as done/i);
  });

  it('blocks a read tool too when its capability is set to human_only', async () => {
    const { executeTool } = await loadTools('human_only');
    const result = await executeTool('search_web', { query: 'acme' }, {
      userId: 'u1',
      today: '2026-08-10',
      role: 'sdr',
      tenantId: 't1',
    });
    expect(result).toMatch(/reserved for a human/i);
  });
});
