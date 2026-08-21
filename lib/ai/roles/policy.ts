/**
 * What each of the six roles is accountable for, in the words the model needs.
 *
 * ## What this replaced
 *
 * One ternary in the chat prompt:
 *
 *     Role-based note: ${role === 'sdr' || role === 'leadgen'
 *       ? 'This SDR sees only their own leads and tasks.'
 *       : `This user has ${role} access and can see team-level data.`}
 *
 * Six roles collapsed into two buckets, and a Leadgen researcher addressed as "This SDR". A
 * Floor Manager and a Leadgen Manager got the identical sentence despite having almost nothing
 * in common: one balances rep workload against reply SLAs, the other manages lead supply and
 * research quality.
 *
 * ## This is guidance, never authorization
 *
 * Nothing here grants or withholds access. Scope is enforced by the CRM domain services — the
 * `managerId` walk, `canAccessLead`, `canAccessUser`, tenant filtering — and by the tool
 * capability map. What a policy does is tell the model what this person is *trying to do*, so
 * a Director asking "what changed today" gets an executive answer rather than an SDR's task
 * list.
 *
 * If a policy and an authorization decision ever disagree, the authorization decision is
 * correct and this file is a defect.
 *
 * ## Versioned deliberately
 *
 * A prompt change is a software change. `ROLE_POLICY_VERSION` is recorded against a turn so a
 * regression in answer quality can be tied to the policy that produced it, rather than guessed
 * at from a date.
 */

import type { SessionUser } from '@/lib/auth';

export type UserRole = SessionUser['role'];

/** Bump on any change to the text below. Recorded per turn. */
export const ROLE_POLICY_VERSION = '1.0.0';

export interface RolePolicy {
  displayName: string;
  /** What this person is accountable for. One sentence. */
  mandate: string;
  /** What they can see. Descriptive — the domain services are what enforce it. */
  scope: string;
  /** What a useful answer leads with for this role. */
  leadWith: string[];
  /** Things the assistant must not offer this role, because the CRM will refuse them. */
  neverOffer: string[];
}

export const ROLE_POLICIES: Record<UserRole, RolePolicy> = {
  director: {
    displayName: 'Director',
    mandate: 'Owns commercial outcomes across every client and campaign in the tenant.',
    scope: 'The whole tenant.',
    leadWith: [
      'what changed since yesterday, and what it means',
      'where revenue or a client relationship is at risk, and why',
      'what needs a decision today, and the consequence of not deciding',
    ],
    neverOffer: ['anything from another tenant'],
  },
  floor_manager: {
    displayName: 'Floor Manager',
    mandate: 'Runs the floor: workload balance, lead supply, campaign delivery and reply SLAs.',
    scope: "Their Team Leads' pods, and the campaigns those pods work.",
    leadWith: [
      'exceptions rather than dashboards — who is blocked, what is behind, what runs out tomorrow',
      'which SDRs lack workable leads, and which campaign accounts for the shortfall',
      'a specific rebalance to make, not a list of statistics',
    ],
    neverOffer: ['system configuration changes', 'promotion to Director', 'users outside their floor'],
  },
  team_lead: {
    displayName: 'Team Lead',
    mandate: 'Coaches and unblocks the SDRs in their pod.',
    scope: 'Their own pod. Not the whole floor, and not other pods.',
    leadWith: [
      'observable evidence before any judgement about a person',
      'who needs coaching this week and on what specific behaviour',
      'overdue follow-ups and reply handling in their pod',
    ],
    neverOffer: [
      'opaque scoring of an employee without the evidence behind it',
      'data about SDRs outside their pod',
      'tenant configuration',
    ],
  },
  sdr: {
    displayName: 'SDR',
    mandate: 'Works assigned leads: prospecting, qualifying, booking meetings.',
    scope: 'Only leads assigned to them, and their own tasks and sequences.',
    leadWith: [
      'who to contact next and why, in that order',
      'what happened with this account before, and what to say now',
      'what is overdue or about to go cold',
    ],
    neverOffer: [
      'reassigning leads between reps',
      'other reps’ leads, tasks or performance',
      'activating a sequence without the approval the CRM requires',
    ],
  },
  leadgen_manager: {
    displayName: 'Leadgen Manager',
    mandate: 'Manages lead supply and research quality against campaign requirements.',
    scope: 'Sourcing pools, research output and campaign lead requirements.',
    leadWith: [
      'which campaign is short on supply, and how short',
      'where research quality or freshness is slipping',
      'which requirements are hardest to satisfy, and why',
    ],
    neverOffer: ['starting outbound sequences', 'closing or converting deals'],
  },
  leadgen: {
    displayName: 'Leadgen Researcher',
    mandate: 'Turns research into structured commercial evidence for campaigns.',
    scope: 'Research, enrichment and the sourcing queue. Not the outbound pipeline.',
    leadWith: [
      'evidence, inference and recommendation kept visibly separate',
      'what is missing before this contact is usable, not just what is present',
      'ICP fit and duplicate risk with the reason attached',
    ],
    neverOffer: [
      'assigning leads to SDRs',
      'enrolling anyone in an outbound sequence',
      'presenting an inference as a confirmed fact',
    ],
  },
};

/**
 * The policy block for one role, for embedding in a system prompt.
 *
 * Falls back to the SDR policy for an unrecognised role rather than throwing. `role` is a
 * `String` column with no database enum behind it, so an unexpected value is possible, and the
 * safe direction is the most restricted policy — never a permissive default, and never a crash
 * that costs the user their chat.
 */
export function rolePolicyPrompt(role: string): string {
  const policy = ROLE_POLICIES[role as UserRole] ?? ROLE_POLICIES.sdr;
  return [
    `[Role: ${policy.displayName}]`,
    policy.mandate,
    `Scope: ${policy.scope}`,
    'Lead with:',
    ...policy.leadWith.map((l) => `- ${l}`),
    'Never offer:',
    ...policy.neverOffer.map((l) => `- ${l}`),
  ].join('\n');
}
