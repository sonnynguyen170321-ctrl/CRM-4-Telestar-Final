'use client';

import { ChevronRight } from 'lucide-react';
import { ageInDays, formatDate, formatMoney, toNumber, type Opportunity } from './types';
import OpportunityStageBadge from './OpportunityStageBadge';

export default function OpportunityTable({
  opportunities,
  onSelect,
}: {
  opportunities: Opportunity[];
  onSelect: (opp: Opportunity) => void;
}) {
  if (opportunities.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card-bg p-10 text-center">
        <p className="text-text-muted">No opportunities match the current filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-card-border bg-card-bg">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-card-border text-left text-xs uppercase tracking-wider text-text-muted">
            <th className="px-4 py-3 font-medium">Opportunity</th>
            <th className="px-4 py-3 font-medium">Contact</th>
            <th className="px-4 py-3 font-medium">SDR</th>
            <th className="px-4 py-3 font-medium">Value</th>
            <th className="px-4 py-3 font-medium">Stage</th>
            <th className="px-4 py-3 font-medium">Handoff</th>
            <th className="px-4 py-3 font-medium">Next Step</th>
            <th className="px-4 py-3 font-medium">Expected Close</th>
            <th className="px-4 py-3 font-medium">Age (days)</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {opportunities.map(opp => (
            <tr
              key={opp.id}
              onClick={() => onSelect(opp)}
              className="cursor-pointer border-b border-card-border last:border-b-0 transition-colors hover:bg-card-bg/50"
            >
              <td className="px-4 py-3">
                <p className="font-medium text-text-primary">{opp.title}</p>
                <p className="text-xs text-text-muted">{opp.client.name} · {opp.campaign.name}</p>
              </td>
              <td className="px-4 py-3">
                {opp.contact ? (
                  <>
                    <p className="text-text-primary">{opp.contact.firstName} {opp.contact.lastName}</p>
                    <p className="text-xs text-text-muted">{opp.contact.title ?? opp.contactEmail ?? '—'}</p>
                  </>
                ) : (
                  <span className="text-text-muted">{opp.contactName ?? '—'}</span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className="text-text-primary">
                  {opp.owner.firstName} {opp.owner.lastName}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="text-text-primary">
                  {formatMoney(toNumber(opp.value), opp.currency)}
                </span>
              </td>
              <td className="px-4 py-3">
                <OpportunityStageBadge
                  stage={opp.stage}
                  status={opp.status}
                  handoffStatus={opp.handoffStatus}
                />
              </td>
              <td className="px-4 py-3">
                <span className="capitalize text-xs text-text-muted">
                  {opp.handoffStatus.replace(/_/g, ' ')}
                </span>
              </td>
              <td className="px-4 py-3 text-text-muted">
                {opp.nextStep ?? '—'}
                {opp.nextStepAt ? (
                  <span className="block text-xs">by {formatDate(opp.nextStepAt)}</span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-text-muted">{formatDate(opp.expectedCloseDate)}</td>
              <td className="px-4 py-3 text-text-muted">{ageInDays(opp.updatedAt)}</td>
              <td className="px-4 py-3 text-right">
                <ChevronRight className="inline h-4 w-4 text-text-muted" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
