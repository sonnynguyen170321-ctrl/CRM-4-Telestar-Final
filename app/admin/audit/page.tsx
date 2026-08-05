'use client';

import { useCallback, useEffect, useState } from 'react';
import { ScrollText, Loader2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';
import AdminTable, { type Column } from '@/components/admin/AdminTable';

interface AuditEntry {
  id: string;
  action: string;
  tableName: string;
  recordId: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  targetLabel: string | null;
  changedFields: Record<string, unknown> | null;
}

const ADMIN_ACTIONS = [
  'admin.user.create',
  'admin.user.deactivate',
  'admin.user.reactivate',
  'admin.user.role_change',
  'admin.user.manager_change',
  'admin.user.password_reset',
  'admin.campaign.member_add',
  'admin.campaign.member_remove',
  'admin.work.transfer',
  'admin.client.create',
  'admin.client.update',
  'admin.client.archive',
];

export default function AdminAuditPage() {
  const { showToast } = useToast();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [scope, setScope] = useState<'admin' | 'all'>('admin');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      const isMore = Boolean(cursor);
      if (isMore) setLoadingMore(true);
      else setLoading(true);
      try {
        const qs = new URLSearchParams({ scope, limit: '50' });
        if (action) qs.set('action', action);
        if (cursor) qs.set('cursor', cursor);

        const res = await fetch(`/api/admin/audit-log?${qs}`);
        if (!res.ok) {
          showToast(await readApiError(res, 'Failed to load the audit log'), 'error');
          return;
        }
        const data = await res.json();
        setEntries((prev) => (isMore ? [...prev, ...data.entries] : data.entries));
        setNextCursor(data.nextCursor);
      } catch {
        showToast('Network error while loading the audit log', 'error');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [action, scope, showToast]
  );

  useEffect(() => {
    load();
  }, [load]);

  const columns: Column<AuditEntry>[] = [
    {
      key: 'when',
      label: 'When',
      render: (e) => (
        <span className="font-mono type-meta">{new Date(e.createdAt).toLocaleString()}</span>
      ),
    },
    { key: 'actor', label: 'Actor', render: (e) => e.actorName ?? '—' },
    {
      key: 'action',
      label: 'Action',
      render: (e) => (
        <span className="font-mono type-meta">{e.action.replace(/^admin\./, '')}</span>
      ),
    },
    { key: 'target', label: 'Target', render: (e) => e.targetLabel ?? e.tableName },
    {
      key: 'reason',
      label: 'Reason',
      render: (e) => {
        const r = (e.changedFields as Record<string, unknown> | null)?.__reason;
        return typeof r === 'string' ? r : '—';
      },
    },
  ];

  const selectClass =
    'bg-card-bg border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red text-xs';

  return (
    <div className="glass-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="type-section font-bold text-text-primary flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-text-muted" aria-hidden="true" />
            Admin audit log
          </h2>
          <p className="type-meta text-text-muted prose-measure mt-0.5">
            Last 30 days. Click a row to see what changed.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            aria-label="Filter by action"
            className={selectClass}
          >
            <option value="">All admin actions</option>
            {ADMIN_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a.replace(/^admin\./, '')}
              </option>
            ))}
          </select>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
            aria-label="Filter by scope"
            className={selectClass}
          >
            <option value="admin">Admin actions only</option>
            <option value="all">Every recorded change</option>
          </select>
        </div>
      </div>

      <AdminTable
        columns={columns}
        rows={entries}
        rowKey={(e) => e.id}
        isLoading={loading}
        emptyIcon={<ScrollText className="w-8 h-8 text-text-muted" aria-hidden="true" />}
        emptyMessage="No audit entries in this window."
        expandedKey={expanded}
        onRowClick={(e) => setExpanded((prev) => (prev === e.id ? null : e.id))}
        renderExpanded={(e) => <ChangeDiff changedFields={e.changedFields} />}
      />

      {nextCursor && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => load(nextCursor)}
            disabled={loadingMore}
            className="flex items-center gap-1.5 px-4 py-1.5 border border-card-border bg-bg-main hover:bg-card-border/30 text-text-secondary text-xs font-semibold rounded-lg transition-colors disabled:opacity-60"
          >
            {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

function ChangeDiff({ changedFields }: { changedFields: Record<string, unknown> | null }) {
  if (!changedFields) return <p className="type-meta text-text-muted">No detail recorded.</p>;

  // `__actor` / `__target` / `__reason` are surfaced in their own columns.
  const entries = Object.entries(changedFields).filter(([k]) => !k.startsWith('__'));
  if (entries.length === 0) {
    return <p className="type-meta text-text-muted">No field-level detail recorded.</p>;
  }

  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-1">
      {entries.map(([field, value]) => {
        const isDiff =
          value !== null && typeof value === 'object' && 'old' in (value as object);
        return (
          <div key={field} className="contents">
            <dt className="type-meta font-semibold text-text-primary font-mono">{field}</dt>
            <dd className="type-meta text-text-secondary font-mono break-all">
              {isDiff ? (
                <>
                  <span className="text-text-muted line-through">
                    {format((value as { old: unknown }).old)}
                  </span>
                  {' → '}
                  <span>{format((value as { new: unknown }).new)}</span>
                </>
              ) : (
                format(value)
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function format(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
