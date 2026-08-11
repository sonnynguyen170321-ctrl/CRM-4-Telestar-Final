import type { AgentCapability } from './capabilities';

/**
 * Which capability each agent tool exercises (Revenue AI Phase 2).
 *
 * Every tool must appear here. A tool with no entry is refused rather than allowed —
 * `tests/agent-capability-autonomy.test.ts` asserts the map covers `AI_TOOLS` exactly, so a
 * new tool cannot ship by being forgotten. Fail-closed is the only safe default for a
 * registry whose whole job is deciding what an agent may do.
 *
 * `create_task` predates this phase and already wrote to the CRM. It is mapped to `tasks`
 * rather than grandfathered: the point of the phase is that no write-capable tool runs
 * outside the policy, and "it was here first" is not an exemption.
 */
export const TOOL_CAPABILITY: Record<string, AgentCapability> = {
  search_web: 'research',
  visit_page: 'research',
  research_account: 'research',
  research_contact: 'research',
  create_task: 'tasks',
  get_my_tasks: 'research',
};

/** Undefined for an unregistered tool — callers must treat that as a refusal. */
export function capabilityForTool(toolName: string): AgentCapability | undefined {
  return TOOL_CAPABILITY[toolName];
}
