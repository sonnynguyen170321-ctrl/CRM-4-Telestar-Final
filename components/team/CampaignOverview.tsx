import React from 'react';
import { BarChart3, TrendingUp, ChevronRight, CalendarCheck, Layers } from 'lucide-react';

interface CampaignSummary {
  id: string;
  name: string;
  client: { name: string };
  status: string;
  meetingsBooked: number;
  contactsTouched: number;
  replyRate: number;
  isActive: boolean;
}

interface CampaignOverviewProps {
  campaigns: CampaignSummary[];
  onSelectCampaign: (id: string) => void;
  dateRange: 'today' | 'week' | 'month';
}

export default function CampaignOverview({
  campaigns,
  onSelectCampaign,
  dateRange
}: CampaignOverviewProps) {
  // Aggregate stats across visible campaigns
  const totalMeetings = campaigns.reduce((sum, c) => sum + c.meetingsBooked, 0);
  const totalTouched = campaigns.reduce((sum, c) => sum + c.contactsTouched, 0);
  const activeCount = campaigns.filter((c) => c.status === 'active').length;
  
  // Weighted average reply rate
  const totalReplies = campaigns.reduce((sum, c) => sum + Math.round((c.replyRate * c.contactsTouched) / 100), 0);
  const avgReplyRate = totalTouched > 0 ? Math.round((totalReplies / totalTouched) * 100) : 0;

  const dateLabel =
    dateRange === 'today' ? 'Today' :
    dateRange === 'week' ? 'This Week' : 'This Month';

  return (
    <div className="space-y-6">
      {/* Aggregate KPI row */}
      <div className="grid grid-cols-4 gap-4 stagger-container">
        {[
          {
            label: 'Total Meetings Booked',
            value: totalMeetings,
            Icon: CalendarCheck,
          },
          {
            label: 'Contacts Touched',
            value: totalTouched,
            Icon: BarChart3,
          },
          {
            label: 'Avg Reply Rate',
            value: `${avgReplyRate}%`,
            Icon: TrendingUp,
          },
          {
            label: 'Active Campaigns',
            value: activeCount,
            Icon: Layers,
          },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="bg-bg-card border border-card-border rounded-xl p-4 shadow-xs flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[11px] font-medium text-text-muted">{label}</span>
              <p className="font-display font-bold text-2xl text-text-primary tracking-tight">{value}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-bg-main border border-card-border/60 flex items-center justify-center text-text-muted">
              <Icon className="w-4 h-4" aria-hidden="true" />
            </div>
          </div>
        ))}
      </div>

      {/* Campaigns Table */}
      <div className="glass-card rounded-2xl overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-card-border bg-bg-main/25 flex items-center justify-between">
          <h2 className="type-section text-text-primary flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-brand-red" />
            <span>Outbound Campaigns Performance ({dateLabel})</span>
          </h2>
          <span className="text-[10px] font-mono text-text-muted">Safe for client screenshare</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-bg-main/50 border-b border-card-border text-[10px] uppercase font-bold tracking-wider text-text-muted">
                <th className="p-3 w-16 text-center">Status</th>
                <th className="p-3">Campaign Name</th>
                <th className="p-3">Client</th>
                <th className="p-3 text-center">Meetings Booked</th>
                <th className="p-3 text-center">Contacts Touched</th>
                <th className="p-3 text-center">Reply Rate</th>
                <th className="p-3 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border text-text-secondary">
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-text-muted">
                    No active campaigns in this view scope.
                  </td>
                </tr>
              ) : (
                campaigns.map((camp) => (
                  <tr
                    key={camp.id}
                    onClick={() => onSelectCampaign(camp.id)}
                    className="hover:bg-bg-main/40 cursor-pointer table-row-dense group"
                  >
                    <td className="p-3 text-center">
                      <span
                        className={`inline-block w-2.5 h-2.5 rounded-full border ${
                          camp.isActive
                            ? 'bg-green-500 border-green-400'
                            : 'bg-zinc-600 border-zinc-500'
                        }`}
                        title={camp.isActive ? 'Active' : 'Paused'}
                      />
                    </td>
                    <td className="p-3 font-semibold text-text-primary group-hover:text-brand-red transition-colors">
                      {camp.name}
                    </td>
                    <td className="p-3 font-mono text-[10px] text-text-muted">
                      {camp.client.name}
                    </td>
                    <td className="p-3 text-center font-bold font-mono text-brand-gold-text bg-brand-gold/[0.01]">
                      {camp.meetingsBooked}
                    </td>
                    <td className="p-3 text-center font-medium font-mono">
                      {camp.contactsTouched}
                    </td>
                    <td className="p-3 text-center font-bold font-mono text-brand-orange-text">
                      {camp.replyRate}%
                    </td>
                    <td className="p-3 text-right">
                      <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-brand-red group-hover:translate-x-0.5 transition-all" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
