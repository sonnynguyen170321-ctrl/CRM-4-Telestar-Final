'use client';

const STAGE_STYLES: Record<string, string> = {
  pending_client_review: 'bg-amber-50 text-amber-800 border-amber-200/80',
  accepted_by_client: 'bg-sky-50 text-sky-800 border-sky-200/80',
  discovery: 'bg-cyan-50 text-cyan-800 border-cyan-200/80',
  proposal: 'bg-violet-50 text-violet-800 border-violet-200/80',
  negotiation: 'bg-orange-50 text-orange-800 border-orange-200/80',
  won: 'bg-emerald-50 text-emerald-800 border-emerald-200/80',
  lost: 'bg-rose-50 text-rose-800 border-rose-200/80',
  nurture: 'bg-pink-50 text-pink-800 border-pink-200/80',
};

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-sky-50 text-sky-800 border-sky-200/80',
  won: 'bg-emerald-50 text-emerald-800 border-emerald-200/80',
  lost: 'bg-rose-50 text-rose-800 border-rose-200/80',
  archived: 'bg-gray-100 text-text-muted border-gray-200',
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
