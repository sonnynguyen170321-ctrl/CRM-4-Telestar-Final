import type { Lead } from '@/lib/hooks/useLeads';

/**
 * The SIGNALS column on the leads table.
 *
 * It used to be decoration that read as data: "💼 Tech/SaaS" when the company *name* contained
 * "tech", "cloud" or "ai" — so "Retail", "Thai" and "Dubai" qualified — and "📈 Growth" for every
 * other lead, because Growth was simply the else branch. Nothing behind either label existed. A
 * column an SDR sorts their morning by cannot be made up.
 *
 * Every chip here comes from a stored field: the ICP verdict and its score, the intent priority,
 * the account's industry and its headcount. A lead with none of them shows nothing rather than a
 * plausible guess.
 */

const VERDICT: Record<NonNullable<Lead['icpQualification']>, { label: string; className: string }> = {
  qualified: { label: 'ICP fit', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  needs_review: { label: 'ICP review', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  unqualified: { label: 'No fit', className: 'bg-zinc-500/10 text-text-muted border-card-border' },
};

const chip = 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold';

function headcount(account: Lead['account']): string | null {
  if (!account) return null;
  if (account.staffCountRange) return `${account.staffCountRange} staff`;
  if (account.size) return `${account.size} staff`;
  if (account.staffCountMin != null && account.staffCountMax != null) {
    return `${account.staffCountMin}–${account.staffCountMax} staff`;
  }
  return null;
}

export default function LeadSignals({ lead }: { lead: Lead }) {
  const verdict = lead.icpQualification ? VERDICT[lead.icpQualification] : null;
  const industry = lead.account?.industry?.trim() || null;
  const size = headcount(lead.account);

  return (
    <div className="flex max-w-[260px] flex-wrap items-center gap-1.5">
      {lead.priority === 'hot' && (
        <span className={`${chip} border-red-500/20 bg-red-500/10 text-red-400`}>High intent</span>
      )}
      {verdict ? (
        <span
          className={`${chip} ${verdict.className}`}
          title={lead.icpScoredAt ? `Scored ${new Date(lead.icpScoredAt).toLocaleDateString()}` : undefined}
        >
          {verdict.label}
          {typeof lead.icpFitScore === 'number' && <span className="font-mono">{lead.icpFitScore}</span>}
        </span>
      ) : (
        <span className={`${chip} border-dashed border-card-border text-text-muted`}>Not scored</span>
      )}
      {industry && (
        <span className={`${chip} max-w-[140px] truncate border-card-border text-text-secondary`} title={industry}>
          {industry}
        </span>
      )}
      {size && <span className={`${chip} border-card-border text-text-secondary`}>{size}</span>}
    </div>
  );
}
