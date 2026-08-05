'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Users, Building2, ShieldAlert } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';
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
  role: string;
  managerId: string | null;
}
interface Manager {
  id: string;
  name: string;
  role: string;
}
interface CampaignOpt {
  id: string;
  name: string;
  clientName: string;
}
interface Assignment {
  userId: string;
  campaignId: string;
}
interface PanelData {
  domain: 'sdr_org' | 'leadgen';
  canEditTeam: boolean;
  members: Member[];
  managers: Manager[];
  campaigns: CampaignOpt[];
  assignments: Assignment[];
}

const key = (userId: string, campaignId: string) => `${userId}:${campaignId}`;

/** The member whose removal is pending confirmation. */
interface PendingRemoval {
  userId: string;
  userName: string;
  campaignId: string;
  campaignName: string;
}

export default function TeamAccountsPanel() {
  const { showToast } = useToast();
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  // Removal confirmation state. A chip toggling OFF never writes directly — it
  // opens this dialog so the operator sees what the member still owns first.
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const [impact, setImpact] = useState<UserImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [choice, setChoice] = useState<ImpactChoice>(emptyChoice);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/assignments')
      .then(async (r) => {
        if (r.status === 403) {
          if (active) setBlocked(true);
          return null;
        }
        return r.ok ? ((await r.json()) as PanelData) : null;
      })
      .then((d) => {
        if (!active || !d) return;
        setData(d);
        setAssigned(new Set(d.assignments.map((a) => key(a.userId, a.campaignId))));
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  /** Adding is safe and stays optimistic. Removing is not — see openRemoval. */
  const addAssignment = useCallback(
    async (userId: string, campaignId: string) => {
      const k = key(userId, campaignId);
      if (busy.has(k)) return;
      setBusy((prev) => new Set(prev).add(k));
      setAssigned((prev) => new Set(prev).add(k));
      try {
        const res = await fetch('/api/admin/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, campaignId }),
        });
        if (!res.ok) throw new Error(await readApiError(res, 'Failed to update assignment'));
      } catch (err) {
        setAssigned((prev) => {
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
        showToast(err instanceof Error ? err.message : 'Failed to update assignment', 'error');
      } finally {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
      }
    },
    [busy, showToast]
  );

  /**
   * Removing a member can orphan their leads, tasks, meetings and opportunities,
   * so it opens the impact dialog rather than writing. The server enforces this
   * too (409 without a handling mode) — this is the friendly half of the guard.
   */
  const openRemoval = useCallback(
    async (member: Member, campaign: CampaignOpt) => {
      setPending({
        userId: member.id,
        userName: member.name,
        campaignId: campaign.id,
        campaignName: campaign.name,
      });
      setChoice(emptyChoice);
      setImpact(null);
      setImpactLoading(true);
      try {
        const res = await fetch(
          `/api/campaigns/${campaign.id}/member-impact/${member.id}`
        );
        setImpact(res.ok ? await res.json() : null);
      } catch {
        setImpact(null);
      } finally {
        setImpactLoading(false);
      }
    },
    []
  );

  const confirmRemoval = useCallback(async () => {
    if (!pending) return;
    setRemoving(true);
    try {
      const res = await fetch('/api/admin/assignments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: pending.userId,
          campaignId: pending.campaignId,
          ...(choice.mode ? { mode: choice.mode } : {}),
          ...(choice.transferToUserId ? { transferToUserId: choice.transferToUserId } : {}),
          ...(choice.reason.trim() ? { reason: choice.reason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to remove from account'), 'error');
        return;
      }
      setAssigned((prev) => {
        const next = new Set(prev);
        next.delete(key(pending.userId, pending.campaignId));
        return next;
      });
      showToast(`${pending.userName} removed from ${pending.campaignName}`, 'success');
      setPending(null);
    } catch {
      showToast('Network error while removing from account', 'error');
    } finally {
      setRemoving(false);
    }
  }, [pending, choice, showToast]);

  const changeManager = useCallback(
    async (userId: string, managerId: string) => {
      if (!managerId) return;
      const prevMembers = data?.members ?? [];
      setData((d) =>
        d ? { ...d, members: d.members.map((m) => (m.id === userId ? { ...m, managerId } : m)) } : d
      );
      try {
        const res = await fetch(`/api/users/${userId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ managerId }),
        });
        if (!res.ok) throw new Error();
        showToast('Team updated', 'success');
      } catch {
        setData((d) => (d ? { ...d, members: prevMembers } : d));
        showToast('Failed to update team', 'error');
      }
    },
    [data, showToast]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-text-muted text-xs font-mono py-4">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading team & accounts…
      </div>
    );
  }

  if (blocked || !data) {
    return (
      <div className="p-4 bg-brand-red/5 border border-brand-red/10 rounded-xl space-y-2 text-xs">
        <div className="flex items-center gap-1.5 text-brand-red font-semibold">
          <ShieldAlert className="w-4 h-4 flex-shrink-0" />
          <span>Console Blocked</span>
        </div>
        <p className="text-[11px] text-text-secondary leading-normal">
          You don&apos;t have permission to manage team and account assignments.
        </p>
      </div>
    );
  }

  const isLeadgen = data.domain === 'leadgen';

  return (
    <div className="space-y-4 text-xs">
      <div className="space-y-1">
        <h4 className="font-bold text-text-primary flex items-center gap-1.5">
          <Building2 className="w-3.5 h-3.5 text-indigo-400" />
          {isLeadgen ? 'My Leadgen Team — Account Access' : 'Team & Accounts'}
        </h4>
        <p className="text-[10px] text-text-muted font-mono leading-normal">
          {isLeadgen
            ? 'Assign your leadgen members to the accounts they provide leads for.'
            : 'Assign reps to accounts, and (for SDRs) set which team they belong to. Toggling a chip assigns or removes that account.'}
        </p>
      </div>

      {data.members.length === 0 && (
        <p className="text-text-muted font-mono text-[11px]">No team members in your scope.</p>
      )}

      <div className="space-y-2.5 max-h-[28rem] overflow-y-auto pr-1">
        {data.members.map((m) => (
          <div
            key={m.id}
            className="bg-bg-main/40 border border-card-border rounded-xl p-3 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-text-muted" />
                <span className="font-semibold text-text-primary">{m.name}</span>
                <span className="text-text-muted text-[10px] uppercase">
                  {m.role.replace('_', ' ')}
                </span>
              </div>

              {/* Team membership editor (SDR org only, and only for SDR rows) */}
              {data.canEditTeam && !isLeadgen && m.role === 'sdr' && data.managers.length > 0 && (
                <label className="flex items-center gap-1.5">
                  <span className="text-[10px] text-text-muted uppercase">Team</span>
                  <select
                    value={m.managerId ?? ''}
                    onChange={(e) => changeManager(m.id, e.target.value)}
                    className="bg-card-bg border border-card-border rounded-lg px-2 py-1 text-text-primary focus:outline-none focus:border-brand-red text-[11px]"
                  >
                    <option value="" disabled>
                      Select lead…
                    </option>
                    {data.managers.map((mgr) => (
                      <option key={mgr.id} value={mgr.id}>
                        {mgr.name} ({mgr.role.replace('_', ' ')})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {/* Account chips */}
            <div className="flex flex-wrap gap-1.5">
              {data.campaigns.length === 0 && (
                <span className="text-text-muted font-mono text-[10px]">No accounts available.</span>
              )}
              {data.campaigns.map((c) => {
                const k = key(m.id, c.id);
                const isOn = assigned.has(k);
                const isBusy = busy.has(k);
                return (
                  <button
                    key={c.id}
                    onClick={() => (isOn ? openRemoval(m, c) : addAssignment(m.id, c.id))}
                    disabled={isBusy}
                    title={
                      isOn
                        ? `Remove ${m.name} from ${c.clientName} — ${c.name}`
                        : `Assign ${m.name} to ${c.clientName} — ${c.name}`
                    }
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors disabled:opacity-50 ${
                      isOn
                        ? 'bg-brand-red/10 border-brand-red/40 text-brand-red'
                        : 'bg-card-bg border-card-border text-text-muted hover:text-text-primary hover:border-brand-orange/40'
                    }`}
                  >
                    {isBusy && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {pending && (
        <ConfirmDialog
          title={`Remove ${pending.userName} from ${pending.campaignName}`}
          tone="danger"
          confirmLabel="Remove from account"
          isBusy={removing}
          isConfirmDisabled={!isChoiceComplete(impact, choice)}
          onConfirm={confirmRemoval}
          onClose={() => setPending(null)}
          body={
            <ImpactPanel
              impact={impact}
              isLoading={impactLoading}
              subjectName={pending.userName}
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
