'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, Loader2, Pencil, RotateCcw, X } from 'lucide-react';

import ConfirmDialog from '@/components/admin/ConfirmDialog';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { readApiError } from '@/lib/api/client';

/**
 * Edit and archive one campaign — team lead and above (owner request, 2026-10-06). The server
 * decides which campaigns a caller may change (`app/api/campaigns/[id]/route.ts`); this only hides
 * the buttons from roles that can never use them.
 *
 * Archive is not delete: the campaign is marked completed, stops sending, and keeps its leads,
 * meetings and reports. Restore puts it back to active.
 */

const CAMPAIGN_EDITOR_ROLES = new Set(['director', 'floor_manager', 'team_lead']);

type Status = 'active' | 'paused' | 'completed';

export type CampaignRef = { id: string; name: string; status: Status | string };

type Editable = { name: string; targetVertical: string; targetGeo: string; status: Status };

const buttonClass =
  'inline-flex items-center gap-1.5 px-3 py-1 border border-card-border bg-bg-main hover:bg-card-border/30 text-text-secondary text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export function CampaignActions({ campaign, onChanged }: { campaign: CampaignRef; onChanged: () => void }) {
  const { currentRole } = useAppContext();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!CAMPAIGN_EDITOR_ROLES.has(currentRole)) return null;
  const archived = campaign.status === 'completed';

  async function archiveOrRestore() {
    setBusy(true);
    try {
      const res = archived
        ? await fetch(`/api/campaigns/${campaign.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'active' }),
          })
        : await fetch(`/api/campaigns/${campaign.id}`, { method: 'DELETE' });
      if (!res.ok) {
        showToast(await readApiError(res, archived ? 'Could not restore the campaign' : 'Could not archive the campaign'), 'error');
        return;
      }
      showToast(archived ? 'Campaign restored — sending resumes' : 'Campaign archived — sending stopped', 'success');
      onChanged();
    } finally {
      setBusy(false);
      setConfirmingArchive(false);
    }
  }

  return (
    <>
      <div className="inline-flex items-center gap-2">
        <button type="button" onClick={() => setEditing(true)} disabled={busy} className={buttonClass}>
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit
        </button>
        <button
          type="button"
          onClick={archived ? archiveOrRestore : () => setConfirmingArchive(true)}
          disabled={busy}
          className={buttonClass}
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          ) : archived ? (
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <Archive className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          {archived ? 'Restore' : 'Archive'}
        </button>
      </div>
      {/* Portalled: the members header is a `.glass-card`, whose backdrop-filter would otherwise
          trap these fixed overlays inside the card in dark theme. */}
      {confirmingArchive && createPortal(
        <ConfirmDialog
          title={`Archive ${campaign.name}`}
          tone="danger"
          confirmLabel="Archive campaign"
          isBusy={busy}
          onConfirm={archiveOrRestore}
          onClose={() => setConfirmingArchive(false)}
          body={
            <p className="type-meta text-text-secondary">
              It stops sending for every lead in it and moves to Completed. Its leads, meetings and reports are kept, and
              you can restore it later.
            </p>
          }
        />,
        document.body
      )}
      {editing && createPortal(
        <EditCampaignDialog
          campaignId={campaign.id}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />,
        document.body
      )}
    </>
  );
}

function EditCampaignDialog({ campaignId, onClose, onSaved }: { campaignId: string; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const [original, setOriginal] = useState<Editable | null>(null);
  const [form, setForm] = useState<Editable | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Not while saving: the request would finish behind a dialog that had already gone.
  const dismiss = () => {
    if (!saving) onClose();
  };
  useEscapeClose(dismiss);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/campaigns/${campaignId}`, { cache: 'no-store' }).catch(() => null);
      if (cancelled) return;
      if (!res?.ok) {
        setLoadError(res ? await readApiError(res, 'Could not load the campaign') : 'Could not load the campaign');
        return;
      }
      const c = await res.json();
      const loaded: Editable = {
        name: c.name ?? '',
        targetVertical: c.targetVertical ?? '',
        targetGeo: c.targetGeo ?? '',
        status: (c.status ?? 'active') as Status,
      };
      setOriginal(loaded);
      setForm(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const set = (field: keyof Editable) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => (prev ? { ...prev, [field]: e.target.value } : prev));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !original || saving) return;
    if (!form.name.trim()) {
      showToast('The campaign needs a name', 'error');
      return;
    }
    // Only what changed: a field the dialog did not touch is never overwritten.
    const changes: Record<string, string | null> = {};
    if (form.name.trim() !== original.name) changes.name = form.name.trim();
    if (form.targetVertical.trim() !== original.targetVertical) changes.targetVertical = form.targetVertical.trim() || null;
    if (form.targetGeo.trim() !== original.targetGeo) changes.targetGeo = form.targetGeo.trim() || null;
    if (form.status !== original.status) changes.status = form.status;
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Could not save the campaign'), 'error');
        return;
      }
      showToast('Campaign saved', 'success');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'w-full px-3 py-2 bg-bg-main border border-card-border rounded-lg text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-red transition-colors';
  const labelClass = 'block text-[10px] font-bold font-mono text-text-muted uppercase mb-1 tracking-wide';

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={dismiss} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit campaign"
          className="bg-card-bg border border-card-border rounded-2xl shadow-2xl w-full max-w-lg pointer-events-auto text-left"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-card-border">
            <div>
              <h2 className="font-display font-bold text-sm text-text-primary">Edit Campaign</h2>
              <p className="text-[10px] text-text-muted mt-0.5">The client cannot be changed here.</p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Close"
              className="p-1.5 hover:bg-card-border/50 rounded-lg text-text-muted hover:text-text-primary transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {loadError ? (
            <p className="px-6 py-5 type-meta text-brand-red">{loadError}</p>
          ) : !form ? (
            <div className="px-6 py-5 space-y-3" aria-busy="true">
              <div className="h-8 rounded-lg bg-card-border/40 animate-pulse" />
              <div className="h-8 rounded-lg bg-card-border/40 animate-pulse" />
            </div>
          ) : (
            <form onSubmit={save} className="px-6 py-5 space-y-4">
              <div>
                <label className={labelClass} htmlFor="edit-campaign-name">Campaign Name *</label>
                <input id="edit-campaign-name" type="text" required autoFocus value={form.name} onChange={set('name')} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="edit-campaign-vertical">Target Vertical</label>
                  <input id="edit-campaign-vertical" type="text" value={form.targetVertical} onChange={set('targetVertical')} placeholder="e.g. SaaS, Fintech" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="edit-campaign-geo">Target Geography</label>
                  <input id="edit-campaign-geo" type="text" value={form.targetGeo} onChange={set('targetGeo')} placeholder="e.g. APAC, US" className={inputClass} />
                </div>
              </div>
              <div>
                <label className={labelClass} htmlFor="edit-campaign-status">Status</label>
                <select id="edit-campaign-status" value={form.status} onChange={set('status')} className={inputClass}>
                  <option value="active">Active — sending</option>
                  <option value="paused">Paused — no sends until resumed</option>
                  <option value="completed">Completed — archived</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={dismiss} disabled={saving} className={buttonClass}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
                  Save
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
