/**
 * Wire shapes for the AI Command Center.
 *
 * Mirrors what `/api/ai/console`, `/api/prospects/[id]/handoff` and `/api/prospects/[id]/assist`
 * already return — dates arrive as ISO strings over JSON. Nothing here is a client-side model of
 * the domain; it is the response, typed.
 */

export interface ConsoleProspect {
  leadId: string;
  name: string;
  company: string | null;
  title: string | null;
  operatingState: string;
  stage: string;
  priority: string;
  ownerName: string | null;
  replyClass: string | null;
  replyLabel: string | null;
  classLabel: string | null;
  replyAt: string | null;
  lastTouchAt: string | null;
}

export interface Bucket {
  key: string;
  label: string;
  hint: string;
  count: number;
  prospects: ConsoleProspect[];
}

export interface WorkItem {
  id: string;
  label: string;
  detail: string;
  leadId: string | null;
  status: string;
  at: string;
}

export interface SurfaceMetric {
  key: string;
  label: string;
  value: string;
  raw: number | null;
  hint?: string;
  tone?: string;
}

export interface SurfaceItem {
  id: string;
  primary: string;
  secondary: string;
  meta?: string;
  href?: string;
  leadId?: string | null;
  ownerName?: string | null;
  ageHours?: number | null;
  /** The operating-state enum, for tests and diagnostics. Never rendered. */
  state?: string | null;
}

export interface SurfaceGroup {
  key: string;
  title: string;
  description: string;
  severity: string;
  items: SurfaceItem[];
  healthyMessage: string;
  total?: number;
}

/** The viewer's role surface — what this person is responsible for, as exceptions. */
export interface RoleSurfaceData {
  key: string;
  title: string;
  focus: string;
  scope: string;
  metrics: SurfaceMetric[];
  groups: SurfaceGroup[];
  sources: string[];
}

export interface ConsoleData {
  scope: string;
  buckets: Bucket[];
  approvals: WorkItem[];
  blocked: WorkItem[];
  timeline: Array<{ at: string; leadId: string | null; type: string; description: string }>;
  totals: { aiManaged: number; humanOwned: number; needsAttention: number; blocked: number };
  surface: RoleSurfaceData;
}

export interface HandoffPackage {
  leadId: string;
  prospect: {
    name: string;
    title: string | null;
    email: string;
    company: string | null;
    operatingState: string;
    stage: string;
    priority: string;
  };
  account: { name: string; industry: string | null } | null;
  campaign: { name: string; clientName: string | null } | null;
  sequence: {
    name: string;
    currentStep: number | null;
    status: string | null;
    nextActionAt: string | null;
    pausedReason: string | null;
  } | null;
  whyContacted: Array<{
    kind: string;
    summary: string;
    sourceUrl: string | null;
    observedAt: string | null;
    confidence: number;
  }>;
  thread: Array<{ direction: string; at: string; subject: string | null; body: string | null }>;
  latestReply: {
    at: string;
    body: string | null;
    classLabel: string | null;
    kindLabel: string | null;
    confidence: number | null;
    source: string | null;
  } | null;
  handoffAt: string | null;
  workOrder: { id: string; type: string; status: string } | null;
  recommendedObjective: string;
  suggestedCallQuestions: string[];
}

export interface AssistResult {
  available: boolean;
  kind: string;
  label: string;
  text: string | null;
  reason?: string;
  recommendedObjective: string;
  suggestedCallQuestions: string[];
}

/** "8 min ago" / "yesterday" — the granularity a salesperson actually reads. */
export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function clockTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
