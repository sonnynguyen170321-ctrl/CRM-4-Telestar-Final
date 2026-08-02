export type Opportunity = {
  id: string;
  title: string;
  company: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactTitle?: string | null;
  value?: string | number | null;
  currency: string;
  probability: number;
  stage: string;
  status: string;
  handoffStatus: string;
  source: string;
  expectedCloseDate?: string | null;
  clientOwnerName?: string | null;
  clientOwnerEmail?: string | null;
  qualificationSummary?: string | null;
  painPoints?: string | null;
  prospectNeed?: string | null;
  budgetNotes?: string | null;
  authorityNotes?: string | null;
  timelineNotes?: string | null;
  nextStep?: string | null;
  nextStepAt?: string | null;
  clientFeedback?: string | null;
  lostReason?: string | null;
  lostReasonDetails?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  clientId: string;
  campaignId: string;
  ownerId: string;
  createdById?: string | null;
  client: { id: string; name: string };
  campaign: { id: string; name: string };
  lead?: { id: string; firstName: string; lastName: string; company: string; stage: string } | null;
  account?: { id: string; name: string } | null;
  contact?: {
    id: string;
    firstName: string;
    lastName: string;
    title?: string | null;
    email?: string | null;
  } | null;
  owner: { id: string; firstName: string; lastName: string };
  createdBy?: { id: string; firstName: string; lastName: string } | null;
  meeting?: { id: string; title: string; scheduledAt?: string | null; outcome?: string | null } | null;
  activities?: OpportunityActivity[] | null;
};

export type OpportunityActivity = {
  id: string;
  type: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string };
};

export type OpportunitySummary = {
  totalOpen: number;
  pendingClientReview: number;
  acceptedByClient: number;
  won: number;
  lost: number;
  rejected: number;
  totalPipelineValue: number;
  weightedPipelineValue: number;
};

export const STAGES = [
  'pending_client_review',
  'accepted_by_client',
  'discovery',
  'proposal',
  'negotiation',
  'won',
  'lost',
  'nurture',
] as const;

export function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(value: string | number | null | undefined, currency = 'USD'): string {
  const n = toNumber(value);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export function formatDate(value?: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

export function ageInDays(value?: string | null): number {
  if (!value) return 0;
  const ms = Date.now() - new Date(value).getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
