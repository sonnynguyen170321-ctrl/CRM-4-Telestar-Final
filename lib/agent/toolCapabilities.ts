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
  // Phase 8a. `prioritize_leads` and `evaluate_lead_quality` read and analyse, so they map to
  // `research`; `draft_sequence` produces words a human reads, so `sequence_draft`; only
  // `enroll_lead_in_sequence` reaches the prospect, and it maps to the capability the ceiling
  // caps at `approval`.
  prioritize_leads: 'research',
  evaluate_lead_quality: 'research',
  get_contact_intelligence: 'research',
  // A commercial claim is a structured note about a contact, so it maps to the capability
  // that already governs agent-written CRM notes rather than inventing a new one. A new
  // capability would need a default in every tenant's autonomy policy to mean anything.
  record_contact_claim: 'notes',
  draft_sequence: 'sequence_draft',
  enroll_lead_in_sequence: 'sequence_enroll',
};

/** Undefined for an unregistered tool — callers must treat that as a refusal. */
export function capabilityForTool(toolName: string): AgentCapability | undefined {
  return TOOL_CAPABILITY[toolName];
}
