'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, Pencil, Archive, X, Loader2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { readApiError } from '@/lib/api/client';
import AdminTable, { type Column } from '@/components/admin/AdminTable';
import StatusBadge from '@/components/admin/StatusBadge';
import ConfirmDialog from '@/components/admin/ConfirmDialog';

interface AdminClient {
  id: string;
  name: string;
  industry: string;
  contactName: string;
  contactEmail: string;
  status: string;
  campaignCount: number;
  activeCampaignCount: number;
  campaigns: { id: string; name: string; status: string }[];
}

export default function AdminClientsPage() {
  const { showToast } = useToast();
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminClient | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<AdminClient | null>(null);
  const [cascade, setCascade] = useState<'pause_campaigns' | 'none'>('pause_campaigns');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/clients');
      if (res.ok) setClients(await res.json());
      else showToast(await readApiError(res, 'Failed to load clients'), 'error');
    } catch {
      showToast('Network error while loading clients', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const confirmArchive = useCallback(async () => {
    if (!archiving) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${archiving.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'churned',
          cascade,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to retire client'), 'error');
        return;
      }
      showToast(`${archiving.name} retired`, 'success');
      setArchiving(null);
      setReason('');
      fetchClients();
    } catch {
      showToast('Network error while retiring client', 'error');
    } finally {
      setBusy(false);
    }
  }, [archiving, cascade, reason, showToast, fetchClients]);

  const columns: Column<AdminClient>[] = [
    {
      key: 'name',
      label: 'Client',
      render: (c) => (
        <div>
          <div className="font-semibold text-text-primary">{c.name}</div>
          <div className="type-meta text-text-muted">{c.industry}</div>
        </div>
      ),
    },
    {
      key: 'contact',
      label: 'Contact',
      render: (c) => (
        <div>
          <div>{c.contactName}</div>
          <div className="type-meta text-text-muted font-mono">{c.contactEmail}</div>
        </div>
      ),
    },
    { key: 'status', label: 'Status', render: (c) => <StatusBadge status={c.status} /> },
    {
      key: 'campaigns',
      label: 'Campaigns',
      render: (c) => `${c.activeCampaignCount} / ${c.campaignCount}`,
      numeric: true,
    },
    {
      key: 'actions',
      label: '',
      render: (c) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => setEditing(c)}
            title={`Edit ${c.name}`}
            aria-label={`Edit ${c.name}`}
            className="p-1.5 rounded-lg border border-card-border text-text-muted hover:text-text-primary hover:border-brand-orange/40 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setArchiving(c)}
            disabled={c.status === 'churned'}
            title={c.status === 'churned' ? 'Already retired' : `Retire ${c.name}`}
            aria-label={`Retire ${c.name}`}
            className="p-1.5 rounded-lg border border-card-border text-text-muted hover:text-text-primary hover:border-brand-orange/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
      className: 'text-right',
    },
  ];

  return (
    <div className="glass-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="type-section font-bold text-text-primary flex items-center gap-2">
          <Building2 className="w-4 h-4 text-text-muted" aria-hidden="true" />
          Clients
          <span className="type-meta font-normal text-text-muted font-mono">({clients.length})</span>
        </h2>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New client
        </button>
      </div>

      <AdminTable
        columns={columns}
        rows={clients}
        rowKey={(c) => c.id}
        isLoading={loading}
        emptyIcon={<Building2 className="w-8 h-8 text-text-muted" aria-hidden="true" />}
        emptyMessage="No clients yet."
      />

      {(creating || editing) && (
        <ClientFormModal
          client={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            fetchClients();
          }}
        />
      )}

      {archiving && (
        <ConfirmDialog
          title={`Retire ${archiving.name}`}
          tone="danger"
          confirmLabel="Retire client"
          isBusy={busy}
          isConfirmDisabled={cascade === 'none' && reason.trim().length < 3}
          onConfirm={confirmArchive}
          onClose={() => setArchiving(null)}
          body={
            <div className="space-y-3">
              <p className="leading-normal">
                The client is marked <span className="font-semibold">churned</span>. Nothing is
                deleted — leads, meetings and reports stay intact and queryable.
              </p>

              {archiving.activeCampaignCount > 0 ? (
                <>
                  <p className="text-brand-red font-semibold">
                    {archiving.activeCampaignCount} campaign
                    {archiving.activeCampaignCount === 1 ? ' is' : 's are'} still active.
                  </p>
                  <fieldset className="space-y-1.5">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="cascade"
                        checked={cascade === 'pause_campaigns'}
                        onChange={() => setCascade('pause_campaigns')}
                        className="mt-0.5 accent-brand-red"
                      />
                      <span>
                        <span className="block font-semibold text-text-primary">
                          Pause those campaigns too
                        </span>
                        <span className="block text-text-muted">
                          Stops new work being routed under a client that is gone.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="cascade"
                        checked={cascade === 'none'}
                        onChange={() => setCascade('none')}
                        className="mt-0.5 accent-brand-red"
                      />
                      <span>
                        <span className="block font-semibold text-text-primary">
                          Leave campaigns running
                        </span>
                        <span className="block text-text-muted">
                          Requires a reason — this is the state the overview flags.
                        </span>
                      </span>
                    </label>
                  </fieldset>
                </>
              ) : (
                <p className="text-text-muted">No active campaigns — nothing else changes.</p>
              )}

              <label className="block space-y-1.5">
                <span className="font-semibold text-text-primary">
                  Reason {cascade === 'none' && <span className="text-brand-red">*</span>}
                </span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red text-xs resize-none"
                />
              </label>
            </div>
          }
        />
      )}
    </div>
  );
}

function ClientFormModal({
  client,
  onClose,
  onSaved,
}: {
  client: AdminClient | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  useEscapeClose(onClose);
  const isEdit = client !== null;

  const [form, setForm] = useState({
    name: client?.name ?? '',
    industry: client?.industry ?? '',
    contactName: client?.contactName ?? '',
    contactEmail: client?.contactEmail ?? '',
    status: client?.status ?? 'active',
  });
  const [saving, setSaving] = useState(false);

  const set =
    (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(isEdit ? `/api/clients/${client.id}` : '/api/clients', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to save client'), 'error');
        return;
      }
      showToast(isEdit ? 'Client updated' : 'Client created', 'success');
      onSaved();
    } catch {
      showToast('Network error while saving client', 'error');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full bg-bg-main border border-card-border rounded-lg px-3 py-1.5 text-text-primary focus:outline-none focus:border-brand-red text-xs';
  const labelClass = 'block type-meta font-semibold text-text-primary mb-1';

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isEdit ? 'Edit client' : 'Create client'}
          className="bg-card-bg border border-card-border rounded-2xl shadow-2xl w-full max-w-lg pointer-events-auto"
        >
          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-card-border">
            <h3 className="type-subsection font-bold text-text-primary">
              {isEdit ? `Edit ${client.name}` : 'New client'}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-text-muted hover:text-text-primary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
            <div>
              <label className={labelClass} htmlFor="client-name">
                Client name
              </label>
              <input id="client-name" required value={form.name} onChange={set('name')} className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="client-industry">
                Industry
              </label>
              <input
                id="client-industry"
                required
                value={form.industry}
                onChange={set('industry')}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="client-contact">
                  Contact name
                </label>
                <input
                  id="client-contact"
                  required
                  value={form.contactName}
                  onChange={set('contactName')}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="client-email">
                  Contact email
                </label>
                <input
                  id="client-email"
                  type="email"
                  required
                  value={form.contactEmail}
                  onChange={set('contactEmail')}
                  className={inputClass}
                />
              </div>
            </div>
            {isEdit && (
              <div>
                <label className={labelClass} htmlFor="client-status">
                  Status
                </label>
                <select id="client-status" value={form.status} onChange={set('status')} className={inputClass}>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="churned">Churned</option>
                </select>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 border border-card-border bg-bg-main hover:bg-card-border/30 text-text-secondary text-xs font-semibold rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-60"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isEdit ? 'Save changes' : 'Create client'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
