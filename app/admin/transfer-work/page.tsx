'use client';

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeftRight, Loader2, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';
import type { AdminUser } from '@/components/admin/UserFormModal';
import type { UserImpact } from '@/components/admin/ImpactPanel';

// useSearchParams() requires a Suspense boundary for static prerendering.
export default function TransferWorkPage() {
  return (
    <Suspense fallback={null}>
      <TransferWorkInner />
    </Suspense>
  );
}

interface TransferResult {
  counts: { leads: number; tasks: number; meetings: number; opportunities: number };
  skippedLockedTasks: number;
  hasMore: boolean;
  replayed: boolean;
}

function TransferWorkInner() {
  const { showToast } = useToast();
  const searchParams = useSearchParams();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; clientName: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [fromUserId, setFromUserId] = useState(searchParams.get('fromUserId') ?? '');
  const [toUserId, setToUserId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [include, setInclude] = useState({
    leads: true,
    openTasks: true,
    scheduledMeetings: true,
    openOpportunities: true,
  });
  const [reason, setReason] = useState('');

  const [impact, setImpact] = useState<UserImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TransferResult | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/users');
        if (res.ok) {
          const data = await res.json();
          setUsers(data.users ?? []);
          setCampaigns(data.campaigns ?? []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Preview what is actually going to move, scoped exactly as the request will be.
  useEffect(() => {
    if (!fromUserId) {
      setImpact(null);
      return;
    }
    let active = true;
    setImpactLoading(true);
    const query = campaignId ? `?campaignId=${campaignId}` : '';
    fetch(`/api/users/${fromUserId}/impact${query}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => active && setImpact(d))
      .catch(() => active && setImpact(null))
      .finally(() => active && setImpactLoading(false));
    return () => {
      active = false;
    };
  }, [fromUserId, campaignId]);

  const eligibleTargets = useMemo(
    () =>
      users.filter(
        (u) =>
          u.isActive &&
          u.id !== fromUserId &&
          ['sdr', 'team_lead', 'floor_manager'].includes(u.role)
      ),
    [users, fromUserId]
  );

  const canSubmit =
    fromUserId &&
    toUserId &&
    reason.trim().length >= 3 &&
    Object.values(include).some(Boolean) &&
    !submitting;

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/transfer-work', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromUserId,
          toUserId,
          ...(campaignId ? { campaignId } : {}),
          includeLeads: include.leads,
          includeOpenTasks: include.openTasks,
          includeScheduledMeetings: include.scheduledMeetings,
          includeOpenOpportunities: include.openOpportunities,
          requestId: crypto.randomUUID(),
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Transfer failed'), 'error');
        return;
      }
      setResult(await res.json());
      showToast('Work transferred', 'success');
    } catch {
      showToast('Network error during transfer', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [fromUserId, toUserId, campaignId, include, reason, showToast]);

  const selectClass =
    'w-full bg-bg-main border border-card-border rounded-lg px-3 py-1.5 text-text-primary focus:outline-none focus:border-brand-red text-xs';
  const labelClass = 'block type-meta font-semibold text-text-primary mb-1';

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-text-muted type-meta font-mono">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }

  return (
    <div className="glass-card p-4 space-y-4 max-w-3xl">
      <div>
        <h2 className="type-section font-bold text-text-primary flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4 text-text-muted" aria-hidden="true" />
          Transfer work
        </h2>
        <p className="type-meta text-text-muted prose-measure mt-0.5">
          Move a rep&apos;s live book to someone else — when they leave, change pod, or hand over a
          campaign. Historical attribution (who created an opportunity, who logged a meeting
          outcome) is never rewritten.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="from-user">
            From
          </label>
          <select
            id="from-user"
            value={fromUserId}
            onChange={(e) => setFromUserId(e.target.value)}
            className={selectClass}
          >
            <option value="">Select a user…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role.replace('_', ' ')})
                {u.isActive ? '' : ' — deactivated'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="to-user">
            To
          </label>
          <select
            id="to-user"
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            className={selectClass}
          >
            <option value="">Select a user…</option>
            {eligibleTargets.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role.replace('_', ' ')})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="campaign-scope">
          Scope <span className="font-normal text-text-muted">(optional)</span>
        </label>
        <select
          id="campaign-scope"
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          className={selectClass}
        >
          <option value="">All campaigns — the user&apos;s whole book</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.clientName} — {c.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-1.5">
        <legend className={labelClass}>What moves</legend>
        {(
          [
            ['leads', 'Open leads'],
            ['openTasks', 'Open tasks'],
            ['scheduledMeetings', 'Upcoming meetings'],
            ['openOpportunities', 'Open opportunities'],
          ] as const
        ).map(([field, label]) => (
          <label key={field} className="flex items-center gap-2 type-body text-text-secondary">
            <input
              type="checkbox"
              checked={include[field]}
              onChange={(e) => setInclude((p) => ({ ...p, [field]: e.target.checked }))}
              className="accent-brand-red"
            />
            {label}
          </label>
        ))}
      </fieldset>

      {fromUserId && (
        <div className="p-3 bg-bg-main/50 border border-card-border rounded-xl">
          {impactLoading ? (
            <span className="flex items-center gap-2 type-meta text-text-muted font-mono">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Checking…
            </span>
          ) : impact ? (
            <div className="space-y-1">
              <p className="type-meta font-semibold text-text-primary">Will move</p>
              <p className="type-body text-text-secondary">
                <span className="font-mono">{include.leads ? impact.openLeads : 0}</span> lead(s) ·{' '}
                <span className="font-mono">
                  {include.openTasks ? Math.max(0, impact.openTasks - impact.lockedTasks) : 0}
                </span>{' '}
                task(s) ·{' '}
                <span className="font-mono">
                  {include.scheduledMeetings ? impact.scheduledMeetings : 0}
                </span>{' '}
                meeting(s) ·{' '}
                <span className="font-mono">
                  {include.openOpportunities ? impact.openOpportunities : 0}
                </span>{' '}
                opportunity(ies)
              </p>
              {impact.lockedTasks > 0 && include.openTasks && (
                <p className="type-meta text-text-muted">
                  {impact.lockedTasks} task(s) are mid-send and will stay put — re-run shortly to
                  move them.
                </p>
              )}
            </div>
          ) : (
            <p className="type-meta text-text-muted">Could not load a preview.</p>
          )}
        </div>
      )}

      <label className="block space-y-1.5">
        <span className={labelClass}>
          Reason <span className="text-brand-red">*</span>
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="e.g. Lan left the company — book moved to Minh"
          className={`${selectClass} resize-none`}
        />
      </label>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          Transfer work
        </button>
      </div>

      {result && (
        <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-1">
          <p className="flex items-center gap-1.5 type-body font-semibold text-text-primary">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            {result.replayed ? 'Already applied (replayed)' : 'Transfer complete'}
          </p>
          <p className="type-body text-text-secondary">
            <span className="font-mono">{result.counts.leads}</span> lead(s),{' '}
            <span className="font-mono">{result.counts.tasks}</span> task(s),{' '}
            <span className="font-mono">{result.counts.meetings}</span> meeting(s),{' '}
            <span className="font-mono">{result.counts.opportunities}</span> opportunity(ies) moved.
          </p>
          {result.skippedLockedTasks > 0 && (
            <p className="type-meta text-text-muted">
              {result.skippedLockedTasks} task(s) were mid-send and stayed with the original owner.
            </p>
          )}
          {result.hasMore && (
            <p className="type-meta text-brand-orange-text">
              More work remains beyond this batch — run the transfer again to continue.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
