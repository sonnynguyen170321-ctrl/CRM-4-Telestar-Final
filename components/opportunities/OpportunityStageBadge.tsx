'use client';

const STAGE_STYLES: Record<string, string> = {
  pending_client_review: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
  accepted_by_client: 'bg-sky-500/10 text-sky-400 border-sky-500/25',
  discovery: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/25',
  proposal: 'bg-violet-500/10 text-violet-400 border-violet-500/25',
  negotiation: 'bg-orange-500/10 text-orange-400 border-orange-500/25',
  won: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  lost: 'bg-red-500/10 text-red-400 border-red-500/25',
  nurture: 'bg-pink-500/10 text-pink-400 border-pink-500/25',
};

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-sky-500/10 text-sky-400 border-sky-500/25',
  won: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  lost: 'bg-red-500/10 text-red-400 border-red-500/25',
  archived: 'bg-card-border/40/10 text-text-muted border-card-border/25',
};

const STAGE_LABELS: Record<string, string> = {
  pending_client_review: 'Pending Client Review',
  accepted_by_client: 'Accepted by Client',
  discovery: 'Discovery',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
  nurture: 'Nurture',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  won: 'Won',
  lost: 'Lost',
  archived: 'Archived',
};

export default function OpportunityStageBadge({
  stage,
  status,
  handoffStatus,
}: {
  stage: string;
  status: string;
  handoffStatus?: string;
}) {
  const rejected = handoffStatus === 'rejected' && status === 'open';
  const style = rejected
    ? STATUS_STYLES.lost
    : (status && status !== 'open' && STATUS_STYLES[status]) ||
      STAGE_STYLES[stage] ||
      STAGE_STYLES.pending_client_review;

  const label = rejected
    ? 'Rejected'
    : (status && status !== 'open' && STATUS_LABELS[status]) ||
      STAGE_LABELS[stage] ||
      stage.replace(/_/g, ' ');

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}
