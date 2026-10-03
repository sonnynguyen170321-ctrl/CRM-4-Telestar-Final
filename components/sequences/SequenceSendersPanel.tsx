'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail } from 'lucide-react';

import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

type Mailbox = {
  id: string;
  email: string;
  fromName?: string | null;
  isActive: boolean;
  dailyCap?: number;
};

/**
 * "Send from" — the mailboxes a sequence may send from.
 *
 * Each enrollment is given one of them on its first send and keeps it (lib/sequences/sender.ts), so
 * a prospect's thread never changes address mid-cadence, and new enrollments go to the mailbox with
 * the most of today's cap left. With none ticked, the lead owner's own mailbox sends, as before.
 *
 * The list shows the mailboxes the viewer can see (`GET /api/email/accounts`): their own, or every
 * mailbox for a director or floor manager. The server checks the same rule on save.
 */
export function SequenceSendersPanel({ sequenceId }: { sequenceId: string }) {
  const { showToast } = useToast();
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sendersRes, accountsRes] = await Promise.all([
        fetch(`/api/sequences/${sequenceId}/senders`),
        fetch('/api/email/accounts'),
      ]);
      if (!sendersRes.ok) {
        showToast(await readApiError(sendersRes, 'Could not load the sending mailboxes'), 'error');
        return;
      }
      const senders = (await sendersRes.json()) as { senders: Mailbox[]; canEdit: boolean };
      const accounts = accountsRes.ok ? ((await accountsRes.json()) as Mailbox[]) : [];
      // A sender the viewer cannot list (a colleague's mailbox attached by a manager) still shows.
      const byId = new Map<string, Mailbox>();
      for (const box of [...accounts, ...senders.senders]) byId.set(box.id, box);
      setMailboxes([...byId.values()].filter((box) => box.isActive || senders.senders.some((s) => s.id === box.id)));
      setSelected(new Set(senders.senders.map((box) => box.id)));
      setCanEdit(senders.canEdit);
    } catch {
      showToast('Network error loading the sending mailboxes', 'error');
    } finally {
      setLoading(false);
    }
  }, [sequenceId, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/sequences/${sequenceId}/senders`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailAccountIds: [...selected] }),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Could not save the sending mailboxes'), 'error');
        return;
      }
      showToast(selected.size ? `Sends from ${selected.size} mailbox(es)` : 'Sends from each lead owner’s mailbox', 'success');
      await load();
    } catch {
      showToast('Network error saving the sending mailboxes', 'error');
    } finally {
      setSaving(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="glass-card rounded-2xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-text-primary">
            <Mail className="h-4 w-4 text-brand-red" aria-hidden="true" />
            Send from
          </h3>
          <p className="mt-1 max-w-[62ch] text-xs leading-5 text-text-secondary">
            Each lead is given one of these mailboxes on its first email and keeps it for the whole cadence, so replies
            stay in one thread. New leads go to the mailbox with the most of today&apos;s limit left. Leave all unticked
            to send from each lead owner&apos;s own mailbox.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={save}
            disabled={saving || loading}
            className="min-h-10 shrink-0 rounded-lg bg-brand-red px-4 text-xs font-bold text-white hover:bg-brand-red-hover disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading mailboxes…
        </p>
      ) : mailboxes.length === 0 ? (
        <p className="mt-4 text-xs text-text-muted">No connected mailboxes. Connect one under Settings → Email.</p>
      ) : (
        <fieldset disabled={!canEdit} className="mt-4 grid grid-cols-2 gap-2">
          {mailboxes.map((box) => (
            <label
              key={box.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-card-border px-3 text-xs disabled:cursor-not-allowed"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-red"
                checked={selected.has(box.id)}
                onChange={() => toggle(box.id)}
              />
              <span className="min-w-0">
                <span className="block truncate font-semibold text-text-primary">{box.fromName || box.email}</span>
                <span className="block truncate text-text-muted">
                  {box.fromName ? box.email : 'No sender name set'}
                  {!box.isActive && ' · disconnected'}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {!canEdit && !loading && (
        <p className="mt-3 text-xs text-text-muted">Only the sequence owner or a manager can change this.</p>
      )}
    </section>
  );
}
