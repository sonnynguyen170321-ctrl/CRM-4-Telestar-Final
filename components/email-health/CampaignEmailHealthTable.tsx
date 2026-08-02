'use client';

import type { CampaignHealthRow } from '@/lib/hooks/useEmailHealth';

/**
 * Campaign-level deliverability. Sorted worst-bounce-first by the API, because
 * the question this answers is "which client list is burning our domains".
 */

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function bounceTone(rate: number): string {
  if (rate >= 0.05) return 'text-brand-red font-semibold';
  if (rate >= 0.02) return 'text-brand-orange-text font-semibold';
  return 'text-text-secondary';
}

/** Plain-language verdict a manager can act on without reading the numbers. */
function verdict(row: CampaignHealthRow): { label: string; tone: string } {
  if (row.sent === 0) return { label: 'No email sent', tone: 'text-text-muted' };
  if (row.hardBounceRate >= 0.05) return { label: 'Pause & audit list', tone: 'text-brand-red' };
  if (row.hardBounceRate >= 0.02) return { label: 'Review bounces', tone: 'text-brand-orange-text' };
  if (row.replyRate === 0 && row.sent >= 20) return { label: 'Check inboxing', tone: 'text-brand-orange-text' };
  return { label: 'Healthy', tone: 'text-channel-whatsapp' };
}

type Props = { rows: CampaignHealthRow[] };

export default function CampaignEmailHealthTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-text-secondary">
        No campaign email activity in the last 7 days.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="border-b border-card-border text-[10px] uppercase text-text-secondary tracking-wider font-semibold">
            <th scope="col" className="py-2 pr-3">Client / Campaign</th>
            <th scope="col" className="py-2 pr-3 text-right">Sent</th>
            <th scope="col" className="py-2 pr-3 text-right">Hard Bnc</th>
            <th scope="col" className="py-2 pr-3 text-right">Reply</th>
            <th scope="col" className="py-2 pr-3 text-right">Meetings</th>
            <th scope="col" className="py-2 pr-3 text-right">New Suppr.</th>
            <th scope="col" className="py-2">Verdict</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-card-border/50">
          {rows.map((row) => {
            const v = verdict(row);
            return (
              <tr key={row.campaignId} className="hover:bg-card-border/20 transition-colors">
                <td className="py-2.5 pr-3">
                  <span className="block font-semibold text-text-primary">{row.clientName}</span>
                  <span className="block text-text-muted text-[11px]">{row.campaignName}</span>
                </td>
                <td className="py-2.5 pr-3 text-right font-mono text-text-secondary">{row.sent}</td>
                <td className={`py-2.5 pr-3 text-right font-mono ${bounceTone(row.hardBounceRate)}`}>
                  {pct(row.hardBounceRate)}
                </td>
                <td className="py-2.5 pr-3 text-right font-mono text-text-secondary">{pct(row.replyRate)}</td>
                <td className="py-2.5 pr-3 text-right font-mono text-text-secondary">{row.meetingsBooked}</td>
                <td className="py-2.5 pr-3 text-right font-mono text-text-secondary">{row.suppressionGrowth}</td>
                <td className={`py-2.5 text-[11px] font-semibold ${v.tone}`}>{v.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
