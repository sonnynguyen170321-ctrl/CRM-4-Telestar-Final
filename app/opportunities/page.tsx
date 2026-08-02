'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Funnel, Plus, RefreshCw, Search } from 'lucide-react';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import OpportunityValueCard from '@/components/opportunities/OpportunityValueCard';
import OpportunityTable from '@/components/opportunities/OpportunityTable';
import OpportunityBoard from '@/components/opportunities/OpportunityBoard';
import OpportunityDetailPanel from '@/components/opportunities/OpportunityDetailPanel';
import CreateOpportunityModal from '@/components/opportunities/CreateOpportunityModal';
import type { Opportunity, OpportunitySummary } from '@/components/opportunities/types';
import { formatMoney } from '@/components/opportunities/types';

type Tab = 'board' | 'table' | 'review' | 'forecast';

const TABS: { key: Tab; label: string }[] = [
  { key: 'board', label: 'Board' },
  { key: 'table', label: 'Table' },
  { key: 'review', label: 'Client Review' },
  { key: 'forecast', label: 'Forecast' },
];

const EMPTY_SUMMARY: OpportunitySummary = {
  totalOpen: 0,
  pendingClientReview: 0,
  acceptedByClient: 0,
  won: 0,
  lost: 0,
  rejected: 0,
  totalPipelineValue: 0,
  weightedPipelineValue: 0,
};

export default function OpportunitiesPage() {
  const { isManager } = useAppContext();
  const { showToast } = useToast();

  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [summary, setSummary] = useState<OpportunitySummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('board');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [handoffFilter, setHandoffFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [sdrFilter, setSdrFilter] = useState('all');
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/opportunities?limit=500');
      if (!res.ok) throw new Error('Failed to load opportunities');
      const data = await res.json();
      setOpportunities(data.opportunities ?? []);
      setSummary(data.summary ?? EMPTY_SUMMARY);
    } catch {
      showToast('Failed to load opportunities', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const clients = useMemo(() => {
    const map = new Map<string, string>();
    opportunities.forEach(o => {
      if (o.client?.id && o.client?.name) map.set(o.client.id, o.client.name);
    });
    return map;
  }, [opportunities]);

  const campaigns = useMemo(() => {
    const map = new Map<string, string>();
    opportunities.forEach(o => {
      if (o.campaign?.id && o.campaign?.name) map.set(o.campaign.id, o.campaign.name);
    });
    return map;
  }, [opportunities]);

  const sdrs = useMemo(() => {
    const map = new Map<string, string>();
    opportunities.forEach(o => {
      if (o.owner?.id) map.set(o.owner.id, `${o.owner.firstName} ${o.owner.lastName}`);
    });
    return map;
  }, [opportunities]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return opportunities.filter(o => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (handoffFilter !== 'all' && o.handoffStatus !== handoffFilter) return false;
      if (clientFilter !== 'all' && o.clientId !== clientFilter && o.client?.id !== clientFilter) return false;
      if (campaignFilter !== 'all' && o.campaignId !== campaignFilter && o.campaign?.id !== campaignFilter) return false;
      if (sdrFilter !== 'all' && o.ownerId !== sdrFilter && o.owner?.id !== sdrFilter) return false;
      if (q) {
        const hay = [
          o.title,
          o.company,
          o.contactName,
          o.contactEmail,
          o.client?.name,
          o.campaign?.name,
          o.owner?.firstName,
          o.owner?.lastName,
          o.contact?.firstName,
          o.contact?.lastName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [opportunities, search, statusFilter, handoffFilter, clientFilter, campaignFilter, sdrFilter]);

  const reviewQueue = useMemo(
    () => opportunities.filter(o => o.status === 'open' && (o.handoffStatus === 'pending' || o.handoffStatus === 'needs_more_info')),
    [opportunities],
  );

  const reviewFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reviewQueue;
    return reviewQueue.filter(o =>
      [o.title, o.company, o.client?.name, o.owner?.firstName, o.owner?.lastName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [reviewQueue, search]);

  const filterSelects = (
    <>
      <select
        value={statusFilter}
        onChange={e => setStatusFilter(e.target.value)}
        className="rounded-lg border border-card-border bg-card-bg px-2.5 py-2 text-xs text-text-primary focus:outline-none"
      >
        <option value="all">All Status</option>
        <option value="open">Open</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
        <option value="rejected">Rejected</option>
      </select>
      <select
        value={handoffFilter}
        onChange={e => setHandoffFilter(e.target.value)}
        className="rounded-lg border border-card-border bg-card-bg px-2.5 py-2 text-xs text-text-primary focus:outline-none"
      >
        <option value="all">All Handoff</option>
        <option value="pending">Pending</option>
        <option value="accepted">Accepted</option>
        <option value="rejected">Rejected</option>
        <option value="needs_more_info">Needs More Info</option>
      </select>
      {clients.size > 0 && (
        <select
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
          className="rounded-lg border border-card-border bg-card-bg px-2.5 py-2 text-xs text-text-primary focus:outline-none"
        >
          <option value="all">All Clients</option>
          {[...clients.entries()].map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      )}
      {campaigns.size > 0 && (
        <select
          value={campaignFilter}
          onChange={e => setCampaignFilter(e.target.value)}
          className="rounded-lg border border-card-border bg-card-bg px-2.5 py-2 text-xs text-text-primary focus:outline-none"
        >
          <option value="all">All Campaigns</option>
          {[...campaigns.entries()].map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      )}
      {sdrs.size > 0 && (
        <select
          value={sdrFilter}
          onChange={e => setSdrFilter(e.target.value)}
          className="rounded-lg border border-card-border bg-card-bg px-2.5 py-2 text-xs text-text-primary focus:outline-none"
        >
          <option value="all">All SDRs</option>
          {[...sdrs.entries()].map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      )}
    </>
  );

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Funnel className="h-5 w-5 text-brand-orange-text" />
            <h1 className="text-xl font-semibold text-text-primary">Opportunities</h1>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Pipeline from qualified meetings to closed-won. Track stage, value, and client acceptance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="rounded-lg border border-card-border px-3 py-2 text-sm text-text-muted hover:text-text-primary"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {isManager && (
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" />
              Create Opportunity
            </button>
          )}
        </div>
      </div>

      <OpportunityValueCard summary={summary} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-card-border bg-card-bg p-1">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === tab.key ? 'bg-brand-orange text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {activeTab !== 'review' && filterSelects}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search opportunities..."
              className="w-64 rounded-lg border border-card-border bg-card-bg py-2 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-card-border bg-card-bg p-10 text-center text-text-muted">
          Loading opportunities...
        </div>
      ) : activeTab === 'board' ? (
        <OpportunityBoard opportunities={filtered} onSelect={setSelected} />
      ) : activeTab === 'table' ? (
        <OpportunityTable opportunities={filtered} onSelect={setSelected} />
      ) : activeTab === 'review' ? (
        <>
          <div className="mb-4 flex items-center gap-2">
            <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-xs text-amber-400">
              {reviewQueue.length} awaiting client review
            </span>
          </div>
          <OpportunityTable opportunities={reviewFiltered} onSelect={setSelected} />
        </>
      ) : (
        <ForecastView opportunities={opportunities} summary={summary} />
      )}

      {selected && (
        <OpportunityDetailPanel
          opportunity={selected}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}

      <CreateOpportunityModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={load}
        clients={clients}
        campaigns={campaigns}
      />
    </div>
  );
}

function ForecastView({
  opportunities,
  summary,
}: {
  opportunities: Opportunity[];
  summary: OpportunitySummary;
}) {
  const stages = useMemo(() => {
    const byStage = new Map<string, { count: number; value: number; weighted: number }>();
    opportunities.filter(o => o.status === 'open').forEach(o => {
      const cur = byStage.get(o.stage) ?? { count: 0, value: 0, weighted: 0 };
      const value = typeof o.value === 'string' ? Number(o.value) || 0 : (o.value ?? 0);
      cur.count += 1;
      cur.value += value;
      cur.weighted += value * (o.probability / 100);
      byStage.set(o.stage, cur);
    });
    return [...byStage.entries()].sort((a, b) => {
      const order = ['pending_client_review', 'accepted_by_client', 'discovery', 'proposal', 'negotiation', 'won', 'lost', 'nurture'];
      return order.indexOf(a[0]) - order.indexOf(b[0]);
    });
  }, [opportunities]);

  const labels: Record<string, string> = {
    pending_client_review: 'Pending Client Review',
    accepted_by_client: 'Accepted by Client',
    discovery: 'Discovery',
    proposal: 'Proposal',
    negotiation: 'Negotiation',
    won: 'Won',
    lost: 'Lost',
    nurture: 'Nurture',
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-card-border bg-card-bg p-4">
        <h3 className="mb-3 text-sm font-medium text-text-primary">Pipeline by Stage</h3>
        <div className="space-y-2">
          {stages.map(([stage, s]) => (
            <div key={stage} className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-xs text-text-muted">{labels[stage] ?? stage}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-card-bg">
                <div
                  className="h-full rounded-full bg-brand-orange"
                  style={{
                    width: summary.totalPipelineValue > 0 ? `${Math.max(2, (s.value / summary.totalPipelineValue) * 100)}%` : '0%',
                  }}
                />
              </div>
              <span className="w-24 shrink-0 text-right text-xs text-text-primary">
                {s.count} · {formatMoney(s.value, 'USD')}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-card-border bg-card-bg p-4">
          <p className="text-xs text-text-muted mb-1">Weighted Forecast</p>
          <p className="text-2xl font-semibold text-emerald-400">{formatMoney(summary.weightedPipelineValue, 'USD')}</p>
          <p className="text-xs text-text-muted mt-1">probability-weighted pipeline</p>
        </div>
        <div className="rounded-xl border border-card-border bg-card-bg p-4">
          <p className="text-xs text-text-muted mb-1">Acceptance Rate</p>
          <p className="text-2xl font-semibold text-text-primary">
            {summary.acceptedByClient + summary.rejected > 0
              ? `${Math.round((summary.acceptedByClient / (summary.acceptedByClient + summary.rejected)) * 100)}%`
              : '—'}
          </p>
          <p className="text-xs text-text-muted mt-1">client reviews accepted</p>
        </div>
      </div>
    </div>
  );
}
