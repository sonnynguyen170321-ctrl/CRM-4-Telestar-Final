/**
 * One product, five perspectives (Revenue AI Phase 9).
 *
 * Every role reads the same CRM. What changes is which *exceptions* are that role's
 * responsibility — an SDR owns conversations, a Team Lead owns the people having them, a Floor
 * Manager owns execution capacity, a Leadgen Manager owns supply, a Director owns outcomes and
 * cost. So the shape below is deliberately the same for all five: a short row of numbers, then
 * groups of things that are wrong.
 *
 * ## The rule the shape enforces
 *
 * A surface lists **exceptions, not healthy volume**. An empty group is a success and says so in
 * its own words (`healthyMessage`) rather than rendering a zero-row table. That is what keeps
 * automation quiet: a thousand prospects being handled correctly produce no rows anywhere.
 *
 * ## Vocabulary
 *
 * Nothing here may carry engineering vocabulary. No queue, worker, lease, job, work-order
 * internals or operating-state enum reaches a label — `tests/phase-9-role-surfaces.test.ts`
 * asserts it over every built surface. The enum still travels in `ExceptionItem.state` for tests
 * and diagnostics, never as display text.
 */

import type { Role } from '@prisma/client';

/** Which surface a role reads. Two leadgen roles share one; everything else is 1:1. */
export type SurfaceKey = 'sdr' | 'team_lead' | 'floor_manager' | 'leadgen_manager' | 'director';

export function surfaceKeyForRole(role: Role | string): SurfaceKey {
  switch (role) {
    case 'director':
      return 'director';
    case 'floor_manager':
      return 'floor_manager';
    case 'team_lead':
      return 'team_lead';
    case 'leadgen_manager':
    case 'leadgen':
      return 'leadgen_manager';
    default:
      return 'sdr';
  }
}

/** How loudly a group should read. Presentation only — no behaviour hangs off it. */
export type Severity = 'critical' | 'warning' | 'info';

export interface SurfaceMetric {
  key: string;
  label: string;
  /** Pre-formatted for display. A surface never asks the browser to decide what a number means. */
  value: string;
  /** The raw number, for tests and for sorting. Null where the metric is genuinely not a number. */
  raw: number | null;
  hint?: string;
  tone?: 'neutral' | 'ai' | 'attention' | 'human' | 'waiting' | 'eligible' | 'risk' | 'money';
}

export interface ExceptionItem {
  id: string;
  /** The thing itself — a person, a campaign, a source. */
  primary: string;
  /** What is wrong with it, in one line. */
  secondary: string;
  /** Numbers or timing worth showing beside it. */
  meta?: string;
  /** Where the user goes to act on it. */
  href?: string;
  leadId?: string | null;
  ownerName?: string | null;
  /** Age in hours, when the exception is a clock running. Drives sorting, not wording. */
  ageHours?: number | null;
  /** The operating-state enum, for tests and diagnostics. Never rendered. */
  state?: string | null;
}

export interface ExceptionGroup {
  key: string;
  title: string;
  /** Why this group exists — what the role is expected to do about it. */
  description: string;
  severity: Severity;
  items: ExceptionItem[];
  /** Shown *instead of* an empty list. The point of the whole surface. */
  healthyMessage: string;
  /** Total matching rows when `items` is a capped slice. */
  total?: number;
}

export interface RoleSurface {
  key: SurfaceKey;
  /** What this person is responsible for, said plainly. */
  title: string;
  focus: string;
  /** True when the viewer sees more than their own work — drives "your pod" style wording. */
  scope: 'own' | 'team' | 'floor' | 'organisation';
  metrics: SurfaceMetric[];
  groups: ExceptionGroup[];
  /** Provenance: which existing module each number came from. Rendered as a footnote. */
  sources: string[];
}

/** Cap on rows per group. A surface that scrolls forever is a report, not an exception list. */
export const GROUP_LIMIT = 12;

export function hoursSince(at: Date | null | undefined, now: Date): number | null {
  if (!at) return null;
  return Math.max(0, Math.round(((now.getTime() - at.getTime()) / 3_600_000) * 10) / 10);
}

/** "3h" / "2 days" / "just now" — the granularity a manager reads, not a duration string. */
export function ageLabel(hours: number | null): string {
  if (hours === null) return 'no timestamp';
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)} days`;
}

export function money(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 1000) return `$${usd.toFixed(0)}`;
  return `$${(usd / 1000).toFixed(1)}k`;
}

export function pct(value: number, of: number): string {
  if (of === 0) return '—';
  return `${Math.round((value / of) * 100)}%`;
}

/** Build a group and let an empty one stay empty — the caller never branches on length. */
export function group(
  key: string,
  title: string,
  description: string,
  severity: Severity,
  healthyMessage: string,
  items: ExceptionItem[]
): ExceptionGroup {
  const sorted = [...items].sort((a, b) => (b.ageHours ?? 0) - (a.ageHours ?? 0));
  return {
    key,
    title,
    description,
    severity,
    healthyMessage,
    items: sorted.slice(0, GROUP_LIMIT),
    total: sorted.length,
  };
}
