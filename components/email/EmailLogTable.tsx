'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, MousePointerClick, Eye, Reply } from 'lucide-react';

import { useUsers } from '@/lib/hooks/useLeads';
import { readApiError } from '@/lib/api/client';

/**
 * Email Log — every outbound email the viewer can see, sent or not, and why.
 *
 * Shared by the Email Log page and each sequence's Sends tab (`sequenceId` fixes the sequence and
 * hides that filter). Rows, counts and filter options all come from GET /api/email-log, which
 * scopes everything to the viewer's leads.
 */

type StatusGroup = 'sent' | 'waiting' | 'failed' | 'bounced';

type Row = {
  id: string;
  createdAt: string;
  sentAt: string | null;
  status: string;
  statusGroup: StatusGroup | null;
  errorMessage: string | null;
  to: string;
  subject: string;
  sequenceId: string | null;
  sequenceName: string | null;
  sequenceStepOrder: number | null;
  openedAt: string | null;
  openCount: number | null;
  clickedAt: string | null;
  clickCount: number | null;
  repliedAt: string | null;
  account: { id: string; email: string } | null;
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    company: string | null;
    assignedTo: { id: string; firstName: string; lastName: string } | null;
    campaign: { id: string; name: string } | null;
  } | null;
};

type Payload = {
  rows: Row[];
  nextCursor: string | null;
  /** First page only; later pages answer null and the first page's values stand. */
  counts: Record<StatusGroup | 'all', number> | null;
  options: { mailboxes: { id: string; email: string }[]; sequences: { id: string; name: string }[] } | null;
};

/** The browser's own midnight, as an instant, so a date range means the viewer's days. */
function localMidnight(day: string, plusDays = 0): string {
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + plusDays);
  return date.toISOString();
}

const STATUS_TABS: { id: StatusGroup | ''; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'sent', label: 'Sent' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'failed', label: 'Not sent' },
  { id: 'bounced', label: 'Bounced' },
];

const STATUS_STYLE: Record<StatusGroup, { label: string; className: string }> = {
  sent: { label: 'Sent', className: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30' },
  waiting: { label: 'Waiting', className: 'bg-sky-500/10 text-sky-700 border-sky-500/30' },
  failed: { label: 'Not sent', className: 'bg-brand-red/10 text-brand-red border-brand-red/30' },
  bounced: { label: 'Bounced', className: 'bg-amber-500/10 text-amber-700 border-amber-500/30' },
};

const CONTROL =
  'bg-bg-main border border-card-border rounded-lg text-xs px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type Props = { sequenceId?: string };

export default function EmailLogTable({ sequenceId }: Props) {
  const { data: users = [] } = useUsers();
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [filters, setFilters] = useState({
    status: '' as StatusGroup | '',
    accountId: '',
    assignedToId: '',
    sequenceId: sequenceId ?? '',
    step: '',
    campaignId: '',
    dateFrom: '',
    dateTo: '',
    engagement: '',
  });
  const [data, setData] = useState<Payload | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/campaigns')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: unknown) => {
        if (Array.isArray(list)) setCampaigns(list.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
      })
      .catch(() => setCampaigns([]));
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;
      // dateTo is exclusive on the server: the midnight after the last day chosen.
      if (key === 'dateFrom') params.set(key, localMidnight(value));
      else if (key === 'dateTo') params.set(key, localMidnight(value, 1));
      else params.set(key, value);
    }
    return params.toString();
  }, [filters]);

  const load = useCallback(
    async (cursor?: string) => {
      const url = `/api/email-log?${query}${cursor ? `${query ? '&' : ''}cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(await readApiError(res, 'Could not load the email log'));
      return (await res.json()) as Payload;
    },
    [query]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setRows(payload.rows);
      })
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [load]);

  const loadMore = async () => {
    if (!data?.nextCursor) return;
    setLoadingMore(true);
    try {
      const payload = await load(data.nextCursor);
      setData((prev) => (prev ? { ...prev, nextCursor: payload.nextCursor } : payload));
      setRows((prev) => [...prev, ...payload.rows]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const set = (key: keyof typeof filters, value: string) => setFilters((prev) => ({ ...prev, [key]: value }));
  const reps = users.filter((u) => u.role === 'sdr' || u.role === 'team_lead');

  return (
    <section className="space-y-3">
      <div role="tablist" aria-label="Email status" className="flex flex-wrap gap-1">
        {STATUS_TABS.map((tab) => {
          const count = data?.counts?.[tab.id || 'all'];
          return (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={filters.status === tab.id}
              onClick={() => set('status', tab.id)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                filters.status === tab.id ? 'border-brand-red text-text-primary bg-brand-red/5' : 'border-card-border text-text-secondary'
              }`}
            >
              {tab.label}
              {count !== undefined && <span className="ml-1.5 font-mono text-text-muted">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Sending mailbox" value={filters.accountId} onChange={(e) => set('accountId', e.target.value)} className={CONTROL}>
          <option value="">All mailboxes</option>
          {data?.options?.mailboxes.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
        </select>
        <select aria-label="Rep" value={filters.assignedToId} onChange={(e) => set('assignedToId', e.target.value)} className={CONTROL}>
          <option value="">All reps</option>
          {reps.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
        </select>
        {!sequenceId && (
          <select aria-label="Sequence" value={filters.sequenceId} onChange={(e) => set('sequenceId', e.target.value)} className={CONTROL}>
            <option value="">All sequences</option>
            {data?.options?.sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <select aria-label="Step" value={filters.step} onChange={(e) => set('step', e.target.value)} className={CONTROL}>
          <option value="">Any step</option>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Step {n}</option>)}
        </select>
        <select aria-label="Campaign" value={filters.campaignId} onChange={(e) => set('campaignId', e.target.value)} className={CONTROL}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-text-secondary">
          From <input type="date" value={filters.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} className={CONTROL} />
        </label>
        <label className="flex items-center gap-1 text-xs text-text-secondary">
          To <input type="date" value={filters.dateTo} onChange={(e) => set('dateTo', e.target.value)} className={CONTROL} />
        </label>
        <select aria-label="Engagement" value={filters.engagement} onChange={(e) => set('engagement', e.target.value)} className={CONTROL}>
          <option value="">Any engagement</option>
          <option value="opened">Opened</option>
          <option value="clicked">Clicked</option>
          <option value="replied">Replied</option>
        </select>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-xs text-brand-red">
          {error}
        </p>
      )}

      <div className="glass-card rounded-2xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-text-secondary border-b border-card-border">
            <tr>
              <th className="px-4 py-3 font-semibold">When</th>
              <th className="px-4 py-3 font-semibold">Lead</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              {!sequenceId && <th className="px-4 py-3 font-semibold">Sequence</th>}
              <th className="px-4 py-3 font-semibold">From</th>
              <th className="px-4 py-3 font-semibold">Rep</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Engagement</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-text-muted">
                  <Loader2 className="inline h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-text-muted">
                  No emails match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const style = row.statusGroup ? STATUS_STYLE[row.statusGroup] : null;
                return (
                  <tr key={row.id} className="align-top">
                    <td className="px-4 py-3 font-mono text-text-secondary whitespace-nowrap">
                      {formatTime(row.sentAt ?? row.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-text-primary">
                        {row.lead ? `${row.lead.firstName} ${row.lead.lastName}` : row.to}
                      </div>
                      <div className="text-text-muted">{row.lead?.company ?? row.to}</div>
                    </td>
                    <td className="px-4 py-3 max-w-72">
                      <div className="truncate text-text-primary" title={row.subject}>{row.subject || '(no subject)'}</div>
                      {row.sequenceStepOrder && <div className="text-text-muted">Step {row.sequenceStepOrder}</div>}
                    </td>
                    {!sequenceId && <td className="px-4 py-3 text-text-secondary">{row.sequenceName ?? 'Manual send'}</td>}
                    <td className="px-4 py-3 text-text-secondary">{row.account?.email ?? '—'}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {row.lead?.assignedTo ? `${row.lead.assignedTo.firstName} ${row.lead.assignedTo.lastName}` : '—'}
                    </td>
                    <td className="px-4 py-3 max-w-80">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md border type-micro font-semibold ${style?.className ?? 'border-card-border text-text-muted'}`}>
                        {style?.label ?? row.status}
                      </span>
                      {row.errorMessage && row.statusGroup !== 'sent' && (
                        <div className="mt-1 text-text-muted break-words" title={row.errorMessage}>
                          {row.errorMessage.slice(0, 160)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-text-secondary">
                      <span className="inline-flex items-center gap-2">
                        {row.openedAt && (
                          <span title="Opened" className="inline-flex items-center gap-0.5">
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" /><span className="font-mono">{row.openCount ?? 1}</span>
                            <span className="sr-only">opens</span>
                          </span>
                        )}
                        {row.clickedAt && (
                          <span title="Clicked" className="inline-flex items-center gap-0.5">
                            <MousePointerClick className="h-3.5 w-3.5" aria-hidden="true" /><span className="font-mono">{row.clickCount ?? 1}</span>
                            <span className="sr-only">clicks</span>
                          </span>
                        )}
                        {row.repliedAt && (
                          <span title="Replied" className="inline-flex items-center gap-0.5 text-emerald-700">
                            <Reply className="h-3.5 w-3.5" aria-hidden="true" /> Replied
                          </span>
                        )}
                        {!row.openedAt && !row.clickedAt && !row.repliedAt && '—'}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {data?.nextCursor && !loading && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="px-3 py-1.5 rounded-lg border border-card-border text-xs font-semibold text-text-secondary hover:text-text-primary disabled:opacity-60"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
