'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Briefcase, AlertTriangle, Users2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';
import AdminTable, { type Column } from '@/components/admin/AdminTable';
import StatusBadge from '@/components/admin/StatusBadge';

interface AdminCampaign {
  id: string;
  name: string;
  status: string;
  targetVertical: string | null;
  targetGeo: string | null;
  client: { id: string; name: string; status: string };
  memberCount: number;
  activeSdrCount: number;
  leadCount: number;
}

export default function AdminCampaignsPage() {
  const { showToast } = useToast();
  const [campaigns, setCampaigns] = useState<AdminCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'completed'>('all');
  const [onlyProblems, setOnlyProblems] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      // `/api/campaigns` returns the scoped list; membership counts come from the
      // members endpoint per campaign, so the list is enriched client-side from
      // the assignments control plane in one extra call.
      const [campRes, assignRes] = await Promise.all([
        fetch('/api/campaigns'),
        fetch('/api/admin/assignments'),
      ]);
      if (!campRes.ok) {
        showToast(await readApiError(campRes, 'Failed to load campaigns'), 'error');
        return;
      }
      const raw = await campRes.json();
      const assignments = assignRes.ok ? await assignRes.json() : { assignments: [], members: [] };

      const activeMemberIds = new Set(
        (assignments.members ?? [])
          .filter((m: { role: string }) => m.role === 'sdr' || m.role === 'team_lead')
          .map((m: { id: string }) => m.id)
      );
      const byCampaign = new Map<string, string[]>();
      for (const a of assignments.assignments ?? []) {
        byCampaign.set(a.campaignId, [...(byCampaign.get(a.campaignId) ?? []), a.userId]);
      }

      setCampaigns(
        (Array.isArray(raw) ? raw : []).map((c: Record<string, any>) => {
          const members = byCampaign.get(c.id) ?? [];
          return {
            id: c.id,
            name: c.name,
            status: c.status,
            targetVertical: c.targetVertical ?? null,
            targetGeo: c.targetGeo ?? null,
            client: c.client ?? { id: '', name: '—', status: 'active' },
            memberCount: members.length,
            activeSdrCount: members.filter((uid) => activeMemberIds.has(uid)).length,
            leadCount: c._count?.leads ?? c.leadCount ?? 0,
          };
        })
      );
    } catch {
      showToast('Network error while loading campaigns', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const rows = useMemo(
    () =>
      campaigns.filter((c) => {
        if (statusFilter !== 'all' && c.status !== statusFilter) return false;
        if (onlyProblems) {
          const hasProblem =
            (c.status === 'active' && c.activeSdrCount === 0) || c.client.status !== 'active';
          if (!hasProblem) return false;
        }
        return true;
      }),
    [campaigns, statusFilter, onlyProblems]
  );

  const columns: Column<AdminCampaign>[] = [
    {
      key: 'name',
      label: 'Campaign',
      render: (c) => (
        <div>
          <div className="font-semibold text-text-primary">{c.name}</div>
          <div className="type-meta text-text-muted">
            {c.client.name}
            {c.client.status !== 'active' && (
              <span className="ml-1.5 text-brand-orange-text">({c.client.status})</span>
            )}
          </div>
        </div>
      ),
    },
    { key: 'status', label: 'Status', render: (c) => <StatusBadge status={c.status} /> },
    {
      key: 'target',
      label: 'Target',
      render: (c) => [c.targetVertical, c.targetGeo].filter(Boolean).join(' · ') || '—',
    },
    { key: 'leads', label: 'Leads', render: (c) => c.leadCount, numeric: true },
    {
      key: 'members',
      label: 'Members',
      render: (c) =>
        c.status === 'active' && c.activeSdrCount === 0 ? (
          <span className="inline-flex items-center gap-1 text-brand-red font-semibold">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> No SDR
          </span>
        ) : (
          c.memberCount
        ),
      numeric: true,
    },
    {
      key: 'actions',
      label: '',
      render: (c) => (
        <Link
          href={`/admin/campaigns/${c.id}/members`}
          className="inline-flex items-center gap-1.5 px-3 py-1 border border-card-border bg-bg-main hover:bg-card-border/30 text-text-secondary text-xs font-semibold rounded-lg transition-colors"
        >
          <Users2 className="w-3.5 h-3.5" aria-hidden="true" /> Manage members
        </Link>
      ),
      className: 'text-right',
    },
  ];

  const selectClass =
    'bg-card-bg border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red text-xs';

  return (
    <div className="glass-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="type-section font-bold text-text-primary flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-text-muted" aria-hidden="true" />
          Campaigns
          <span className="type-meta font-normal text-text-muted font-mono">({rows.length})</span>
        </h2>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            aria-label="Filter by status"
            className={selectClass}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
          </select>
          <label className="flex items-center gap-1.5 type-meta text-text-secondary">
            <input
              type="checkbox"
              checked={onlyProblems}
              onChange={(e) => setOnlyProblems(e.target.checked)}
              className="accent-brand-red"
            />
            Needs attention
          </label>
        </div>
      </div>

      <AdminTable
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        isLoading={loading}
        emptyIcon={<Briefcase className="w-8 h-8 text-text-muted" aria-hidden="true" />}
        emptyMessage="No campaigns match these filters."
      />
    </div>
  );
}
