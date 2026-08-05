'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, UserMinus, UserPlus, Users2, Loader2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';
import AdminTable, { type Column } from '@/components/admin/AdminTable';
import StatusBadge from '@/components/admin/StatusBadge';
import ConfirmDialog from '@/components/admin/ConfirmDialog';
import ImpactPanel, {
  emptyChoice,
  isChoiceComplete,
  type ImpactChoice,
  type UserImpact,
} from '@/components/admin/ImpactPanel';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  canManage: boolean;
  assignedLeadCount: number;
  openTaskCount: number;
  scheduledMeetingCount: number;
  openOpportunityCount: number;
}
interface AvailableUser {
  id: string;
  name: string;
  email: string;
  role: string;
}
interface MembersPayload {
  campaign: {
    id: string;
    name: string;
    status: string;
    clientName: string;
    clientStatus: string;
    leadCount: number;
    meetingCount: number;
    opportunityCount: number;
  };
  members: Member[];
  availableUsers: AvailableUser[];
}

export default function CampaignMembersPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;
  const { showToast } = useToast();

  const [data, setData] = useState<MembersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const [pending, setPending] = useState<Member | null>(null);
  const [impact, setImpact] = useState<UserImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [choice, setChoice] = useState<ImpactChoice>(emptyChoice);
  const [removing, setRemoving] = useState(false);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/members`);
      if (res.ok) setData(await res.json());
      else showToast(await readApiError(res, 'Failed to load campaign members'), 'error');
    } catch {
      showToast('Network error while loading campaign members', 'error');
    } finally {
      setLoading(false);
    }
  }, [campaignId, showToast]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const addSelected = useCallback(async () => {
    if (selected.size === 0) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: [...selected] }),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to add members'), 'error');
        return;
      }
      showToast(`${selected.size} member(s) added`, 'success');
      setSelected(new Set());
      fetchMembers();
    } catch {
      showToast('Network error while adding members', 'error');
    } finally {
      setAdding(false);
    }
  }, [selected, campaignId, showToast, fetchMembers]);

  const openRemoval = useCallback(
    async (member: Member) => {
      setPending(member);
      setChoice(emptyChoice);
      setImpact(null);
      setImpactLoading(true);
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/member-impact/${member.id}`);
        setImpact(res.ok ? await res.json() : null);
      } catch {
        setImpact(null);
      } finally {
        setImpactLoading(false);
      }
    },
    [campaignId]
  );

  const confirmRemoval = useCallback(async () => {
    if (!pending) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: pending.id,
          ...(choice.mode ? { mode: choice.mode } : {}),
          ...(choice.transferToUserId ? { transferToUserId: choice.transferToUserId } : {}),
          ...(choice.reason.trim() ? { reason: choice.reason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to remove member'), 'error');
        return;
      }
      showToast(`${pending.name} removed from ${data?.campaign.name ?? 'the campaign'}`, 'success');
      setPending(null);
      fetchMembers();
    } catch {
      showToast('Network error while removing member', 'error');
    } finally {
      setRemoving(false);
    }
  }, [pending, choice, campaignId, data, showToast, fetchMembers]);

  const columns: Column<Member>[] = [
    {
      key: 'name',
      label: 'Member',
      render: (m) => (
        <div>
          <div className="font-semibold text-text-primary">{m.name}</div>
          <div className="type-meta text-text-muted font-mono">{m.email}</div>
        </div>
      ),
    },
    { key: 'role', label: 'Role', render: (m) => m.role.replace('_', ' ') },
    {
      key: 'status',
      label: 'Status',
      render: (m) => <StatusBadge status={m.isActive ? 'active' : 'inactive'} />,
    },
    { key: 'leads', label: 'Leads', render: (m) => m.assignedLeadCount, numeric: true },
    { key: 'tasks', label: 'Open tasks', render: (m) => m.openTaskCount, numeric: true },
    { key: 'meetings', label: 'Meetings', render: (m) => m.scheduledMeetingCount, numeric: true },
    { key: 'opps', label: 'Opps', render: (m) => m.openOpportunityCount, numeric: true },
    {
      key: 'actions',
      label: '',
      render: (m) => (
        <button
          type="button"
          onClick={() => openRemoval(m)}
          disabled={!m.canManage}
          title={m.canManage ? `Remove ${m.name}` : 'Outside your management scope'}
          className="inline-flex items-center gap-1.5 px-3 py-1 border border-card-border bg-bg-main hover:bg-card-border/30 text-text-secondary text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <UserMinus className="w-3.5 h-3.5" aria-hidden="true" /> Remove
        </button>
      ),
      className: 'text-right',
    },
  ];

  return (
    <div className="space-y-4">
      <Link
        href="/admin/campaigns"
        className="inline-flex items-center gap-1.5 type-meta text-text-muted hover:text-text-primary transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> All campaigns
      </Link>

      {data && (
        <div className="glass-card p-4 flex items-center gap-6 flex-wrap">
          <div>
            <h2 className="type-section font-bold text-text-primary">{data.campaign.name}</h2>
            <p className="type-meta text-text-muted">{data.campaign.clientName}</p>
          </div>
          <StatusBadge status={data.campaign.status} />
          <div className="flex items-center gap-6 ml-auto">
            <Stat label="Leads" value={data.campaign.leadCount} />
            <Stat label="Meetings" value={data.campaign.meetingCount} />
            <Stat label="Opportunities" value={data.campaign.opportunityCount} />
          </div>
        </div>
      )}

      <div className="glass-card p-4 space-y-3">
        <h3 className="type-subsection font-bold text-text-primary flex items-center gap-2">
          <Users2 className="w-4 h-4 text-text-muted" aria-hidden="true" />
          Assigned members
          <span className="type-meta font-normal text-text-muted font-mono">
            ({data?.members.length ?? 0})
          </span>
        </h3>

        <AdminTable
          columns={columns}
          rows={data?.members ?? []}
          rowKey={(m) => m.id}
          isLoading={loading}
          emptyIcon={<Users2 className="w-8 h-8 text-text-muted" aria-hidden="true" />}
          emptyMessage="Nobody is assigned to this campaign yet. Leads cannot be routed until at least one SDR is."
        />
      </div>

      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="type-subsection font-bold text-text-primary">Add members</h3>
          <button
            type="button"
            onClick={addSelected}
            disabled={selected.size === 0 || adding}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
          >
            {adding ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            Add {selected.size > 0 ? `${selected.size} selected` : 'selected'}
          </button>
        </div>

        {(data?.availableUsers.length ?? 0) === 0 ? (
          <p className="type-meta text-text-muted">
            Everyone in your scope is already assigned to this campaign.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data?.availableUsers.map((u) => {
              const isOn = selected.has(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (isOn) next.delete(u.id);
                      else next.add(u.id);
                      return next;
                    })
                  }
                  aria-pressed={isOn}
                  className={`px-2.5 py-1 rounded-lg border type-meta font-medium transition-colors ${
                    isOn
                      ? 'bg-brand-red/10 border-brand-red/40 text-brand-red'
                      : 'bg-card-bg border-card-border text-text-muted hover:text-text-primary hover:border-brand-orange/40'
                  }`}
                >
                  {u.name}{' '}
                  <span className="text-text-muted">({u.role.replace('_', ' ')})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {pending && (
        <ConfirmDialog
          title={`Remove ${pending.name} from ${data?.campaign.name ?? 'campaign'}`}
          tone="danger"
          confirmLabel="Remove from campaign"
          isBusy={removing}
          isConfirmDisabled={!isChoiceComplete(impact, choice)}
          onConfirm={confirmRemoval}
          onClose={() => setPending(null)}
          body={
            <ImpactPanel
              impact={impact}
              isLoading={impactLoading}
              subjectName={pending.name}
              context="campaign"
              choice={choice}
              onChoiceChange={setChoice}
            />
          }
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-right">
      <div className="type-subsection font-bold text-text-primary font-mono">{value}</div>
      <div className="type-meta text-text-muted">{label}</div>
    </div>
  );
}
