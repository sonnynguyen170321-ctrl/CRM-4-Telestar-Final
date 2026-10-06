import { UserCheck } from 'lucide-react';

import type { Lead } from '@/lib/hooks/useLeads';
import { effectiveQualification } from '@/lib/leads/effectiveQualification';

import { QUALIFICATION_CHIP, QUALIFICATION_LABEL } from './qualificationStyle';

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

// One vocabulary with the drawer's ICP card (components/leads/qualificationStyle.ts).
const VERDICT = Object.fromEntries(
  (Object.keys(QUALIFICATION_LABEL) as Array<keyof typeof QUALIFICATION_LABEL>).map((q) => [
    q,
    { label: QUALIFICATION_LABEL[q], className: QUALIFICATION_CHIP[q] },
  ])
) as Record<keyof typeof QUALIFICATION_LABEL, { label: string; className: string }>;

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
  // A rep's verdict wins over the score (lib/leads/effectiveQualification.ts).
  const effective = effectiveQualification(lead);
  const verdict = effective.value ? VERDICT[effective.value] : null;
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
          title={
            effective.source === 'human'
              ? `Set by a person after review${effective.disagrees && effective.computed ? ` — the score says ${VERDICT[effective.computed].label}` : ''}`
              : lead.icpScoredAt
                ? `Scored ${new Date(lead.icpScoredAt).toLocaleDateString()}`
                : undefined
          }
        >
          {effective.source === 'human' && (
            <>
              <UserCheck className="w-3 h-3" aria-hidden="true" />
              <span className="sr-only">Reviewed: </span>
            </>
          )}
          {verdict.label}
          {effective.source === 'computed' && typeof lead.icpFitScore === 'number' && <span className="font-mono">{lead.icpFitScore}</span>}
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
