import type { SessionUser } from '@/lib/auth';

/**
 * Agent capabilities and their autonomy modes (Revenue AI Phase 2).
 *
 * Import-free of Prisma on purpose: this module is the vocabulary, not the storage. The
 * policy rows live in the database; what a capability *means* and what it may never exceed
 * lives here, where it can be read in one screen.
 *
 * Autonomy is per capability rather than a scalar level, because a scalar cannot express
 * "research is automatic but sequence activation needs a manager" — the exact shape every
 * real deployment wants.
 */

export type AgentCapability =
  // Assistance — available even while a human owns the prospect (ARCHITECTURE §4.3).
  | 'research'
  | 'summarize'
  | 'draft_reply'
  | 'objection_help'
  | 'meeting_prep'
  // CRM writes the agent may make on the SDR's behalf.
  | 'notes'
  | 'tasks'
  | 'reminders'
  // Outreach — touches what a prospect receives.
  | 'sequence_draft'
  | 'sequence_enroll'
  | 'send_window_change'
  | 'reengagement_propose'
  | 'reengagement_activate'
  | 'prospect_reply';

export const ALL_CAPABILITIES: readonly AgentCapability[] = [
  'research',
  'summarize',
  'draft_reply',
  'objection_help',
  'meeting_prep',
  'notes',
  'tasks',
  'reminders',
  'sequence_draft',
  'sequence_enroll',
  'send_window_change',
  'reengagement_propose',
  'reengagement_activate',
  'prospect_reply',
];

/**
 * How much the agent may do on its own.
 *
 * Ordered from most to least permissive. `rank` exists so two policies can be compared and
 * the stricter one chosen without a pile of conditionals — the resolution rule is "strictest
 * wins", and it has to be impossible to get backwards.
 */
export type AutonomyMode = 'auto' | 'approval' | 'manager_approval' | 'human_only';

const MODE_RANK: Record<AutonomyMode, number> = {
  auto: 0,
  approval: 1,
  manager_approval: 2,
  human_only: 3,
};

/** The stricter of two modes. */
export function strictest(a: AutonomyMode, b: AutonomyMode): AutonomyMode {
  return MODE_RANK[a] >= MODE_RANK[b] ? a : b;
}

export function isAutonomyMode(value: string): value is AutonomyMode {
  return value in MODE_RANK;
}

export function isAgentCapability(value: string): value is AgentCapability {
  return (ALL_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Capabilities that write to the CRM.
 *
 * Used by the "no write-capable tool without a capability" test: a tool that mutates must
 * declare a capability from this set, so a new writing tool cannot slip in behind a
 * read-only-looking declaration.
 */
export const WRITE_CAPABILITIES: ReadonlySet<AgentCapability> = new Set<AgentCapability>([
  'notes',
  'tasks',
  'reminders',
  'sequence_draft',
  'sequence_enroll',
  'send_window_change',
  'reengagement_activate',
  'prospect_reply',
]);

/**
 * A ceiling no stored policy may exceed.
 *
 * `prospect_reply` is `human_only` at every setting, in every tenant, for every role. It is
 * not a default a Director can raise — Level 4 autonomy (AI-managed two-way prospect
 * conversations) is out of scope for this plan entirely, and a policy row is not the place
 * to reopen that decision.
 *
 * `send_window_change` is capped at `manager_approval` because it is a deliverability lever
 * in the same class as the per-mailbox cap; `reengagement_activate` and `sequence_enroll` at
 * `approval` because both start outreach a prospect will actually receive.
 */
export const CAPABILITY_CEILING: Partial<Record<AgentCapability, AutonomyMode>> = {
  prospect_reply: 'human_only',
  send_window_change: 'manager_approval',
  sequence_enroll: 'approval',
  reengagement_activate: 'approval',
};

/**
 * Defaults when a tenant has stored no policy.
 *
 * Assistance and low-risk CRM writes are automatic — an SDR confirming every note, task and
 * research result stops using the agent, which is the failure mode this phase exists to
 * avoid. Everything that reaches a prospect requires a human.
 */
export const DEFAULT_AUTONOMY: Record<AgentCapability, AutonomyMode> = {
  research: 'auto',
  summarize: 'auto',
  draft_reply: 'auto',
  objection_help: 'auto',
  meeting_prep: 'auto',
  notes: 'auto',
  tasks: 'auto',
  reminders: 'auto',
  sequence_draft: 'auto',
  sequence_enroll: 'approval',
  send_window_change: 'manager_approval',
  reengagement_propose: 'auto',
  reengagement_activate: 'approval',
  prospect_reply: 'human_only',
};

/**
 * Capabilities that carry an underlying CRM permission requirement.
 *
 * Autonomy sits **on top of** existing role authorization and can only ever be stricter.
 * A Floor Manager's send-window right comes from `lib/sequences/permissions.ts`; an autonomy
 * policy cannot grant it to an SDR, and setting that capability to `auto` for the SDR role
 * still yields a denial. Recorded here so the enforcement point has one place to consult.
 */
export const CAPABILITY_ROLE_REQUIREMENT: Partial<
  Record<AgentCapability, readonly SessionUser['role'][]>
> = {
  send_window_change: ['director', 'floor_manager'],
};
