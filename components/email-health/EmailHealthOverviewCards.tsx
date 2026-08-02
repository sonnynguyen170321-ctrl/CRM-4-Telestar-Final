'use client';

import { Inbox, ShieldAlert, Send, Gauge, MailX, Reply } from 'lucide-react';
import type { EmailHealthOverview } from '@/lib/hooks/useEmailHealth';

/**
 * Scorecard row. Uses the repo's glass-card + stagger-container idiom so it sits
 * consistently alongside /automation and /team.
 */

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** Bounce and spam are inverted metrics — higher is worse. */
function riskTone(rate: number, warnAt: number, badAt: number): string {
  if (rate >= badAt) return 'text-brand-red';
  if (rate >= warnAt) return 'text-brand-orange';
  return 'text-text-primary';
}

type TileProps = {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
};

function Tile({ icon, iconClass, label, value, sub, valueClass }: TileProps) {
  return (
    <div className="glass-card rounded-2xl p-5 hover-lift relative overflow-hidden flex items-center gap-4 stagger-child">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${iconClass}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <span className="text-xs text-text-secondary block font-semibold uppercase tracking-wider font-display">
          {label}
        </span>
        <span className={`text-2xl font-extrabold font-display mt-0.5 block ${valueClass ?? 'text-text-primary'}`}>
          {value}
        </span>
        {sub && <span className="text-[11px] text-text-muted block mt-0.5 truncate">{sub}</span>}
      </div>
    </div>
  );
}

type Props = { overview: EmailHealthOverview };

export default function EmailHealthOverviewCards({ overview }: Props) {
  const { totals, today, sevenDay, openAlerts } = overview;
  const atRiskCount = totals.atRisk + totals.critical;

  return (
    <div className="grid grid-cols-3 gap-5 stagger-container">
      <Tile
        icon={<Inbox className="w-6 h-6" />}
        iconClass="bg-blue-500/10 text-blue-400 border-blue-500/20"
        label="Connected Inboxes"
        value={String(totals.inboxes)}
        sub={`${totals.healthy} healthy · ${totals.watch} watch · ${totals.paused} paused`}
      />

      <Tile
        icon={<ShieldAlert className="w-6 h-6" />}
        iconClass="bg-brand-red/10 text-brand-red border-brand-red/20"
        label="At Risk"
        value={String(atRiskCount)}
        valueClass={atRiskCount > 0 ? 'text-brand-red' : 'text-text-primary'}
        sub={`${openAlerts.total} open alerts · ${openAlerts.critical} critical`}
      />

      <Tile
        icon={<Gauge className="w-6 h-6" />}
        iconClass="bg-purple-500/10 text-purple-400 border-purple-500/20"
        label="Capacity Used Today"
        value={`${today.usagePct}%`}
        valueClass={riskTone(today.usagePct / 100, 0.7, 0.9)}
        sub={`${today.sent} sent of ${today.capacity} available`}
      />

      <Tile
        icon={<Send className="w-6 h-6" />}
        iconClass="bg-channel-email/10 text-channel-email border-channel-email/20"
        label="Sent (7 days)"
        value={sevenDay.sent.toLocaleString()}
        sub={`${sevenDay.suppressionGrowth} new suppressions`}
      />

      <Tile
        icon={<MailX className="w-6 h-6" />}
        iconClass="bg-brand-orange/10 text-brand-orange border-brand-orange/20"
        label="Hard Bounce Rate"
        value={pct(sevenDay.hardBounceRate)}
        valueClass={riskTone(sevenDay.hardBounceRate, 0.02, 0.05)}
        sub={`Soft ${pct(sevenDay.softBounceRate)} · Spam ${pct(sevenDay.spamSignalRate)}`}
      />

      <Tile
        icon={<Reply className="w-6 h-6" />}
        iconClass="bg-channel-whatsapp/10 text-channel-whatsapp border-channel-whatsapp/20"
        label="Reply Rate (7 days)"
        value={pct(sevenDay.replyRate)}
        sub="Replies from known leads only"
      />
    </div>
  );
}
