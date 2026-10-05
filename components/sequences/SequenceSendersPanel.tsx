'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail } from 'lucide-react';

import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

type SenderState = 'sending' | 'at_limit' | 'paused' | 'held' | 'disconnected';

type Mailbox = {
  id: string;
  email: string;
  fromName?: string | null;
  isActive: boolean;
  dailyCap?: number;
  // Present on a mailbox attached to this sequence (GET /api/sequences/[id]/senders).
  state?: SenderState;
  pauseReason?: string | null;
  sentToday?: number;
  hasSignature?: boolean;
  sequenceSent?: number;
  sequenceLeads?: number;
  sequenceLastSentAt?: string | null;
};

const STATE_LABEL: Record<SenderState, string> = {
  sending: 'Sending',
  at_limit: 'At today’s limit — resumes tomorrow',
  paused: 'Paused',
  held: 'Held — mailbox health is critical',
  disconnected: 'Disconnected — reconnect under Settings → Email',
};

/** "today 14:05" or "3 Oct", in the viewer's own timezone. */
function formatLastSent(iso: string): string {
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date().toDateString();
  return sameDay
    ? `today ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : at.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

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

  // The mailboxes this sequence is sending from as saved, as opposed to ticked but not yet saved.
  const attached = mailboxes.filter((box) => box.state !== undefined);

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
            Each lead is given one of the ticked mailboxes on its first email and keeps it for the whole cadence, so
            replies stay in one thread. New leads go to the mailbox that can send and has the most of today&apos;s
            limit left. Leave all unticked to send from each lead owner&apos;s own mailbox.
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
        <>
          {attached.length > 0 && (
            <p className="mt-4 type-meta text-text-secondary">
              <span className="font-mono">{attached.filter((box) => box.state === 'sending').length}</span> of{' '}
              <span className="font-mono">{attached.length}</span> mailboxes can send now ·{' '}
              <span className="font-mono">{attached.reduce((sum, box) => sum + (box.sequenceSent ?? 0), 0)}</span> emails
              sent by this sequence so far.
            </p>
          )}
          <fieldset disabled={!canEdit} className="mt-3 space-y-2">
            {mailboxes.map((box) => {
              const isAttached = box.state !== undefined;
              return (
                <label
                  key={box.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-card-border px-3 py-2.5 text-xs disabled:cursor-not-allowed"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-brand-red"
                    checked={selected.has(box.id)}
                    onChange={() => toggle(box.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-text-primary">{box.fromName || box.email}</span>
                      <span className="text-text-muted">{box.fromName ? box.email : 'No sender name set'}</span>
                      {box.state && (
                        <span
                          className={`rounded border px-1.5 py-0.5 type-micro font-semibold ${
                            box.state === 'sending'
                              ? 'border-card-border text-text-primary'
                              : 'border-brand-orange/30 text-brand-orange-text'
                          }`}
                        >
                          {STATE_LABEL[box.state]}
                          {box.state === 'paused' && box.pauseReason ? ` — ${box.pauseReason}` : ''}
                        </span>
                      )}
                      {!isAttached && !box.isActive && <span className="text-text-muted">· disconnected</span>}
                    </span>
                    {isAttached ? (
                      <span className="mt-1 block type-meta text-text-secondary">
                        {(box.dailyCap ?? 0) > 0 ? (
                          <>
                            Today <span className="font-mono">{box.sentToday ?? 0}</span> of{' '}
                            <span className="font-mono">{box.dailyCap}</span> sent ·{' '}
                            <span className="font-mono">{Math.max(0, (box.dailyCap ?? 0) - (box.sentToday ?? 0))}</span> left
                          </>
                        ) : (
                          <>
                            Today <span className="font-mono">{box.sentToday ?? 0}</span> sent, no daily limit
                          </>
                        )}
                        <span className="text-text-muted"> (all sequences)</span>
                        {' · '}This sequence: <span className="font-mono">{box.sequenceSent ?? 0}</span> sent,{' '}
                        <span className="font-mono">{box.sequenceLeads ?? 0}</span> leads on it
                        {box.sequenceLastSentAt ? `, last sent ${formatLastSent(box.sequenceLastSentAt)}` : ', nothing sent yet'}
                      </span>
                    ) : (
                      <span className="mt-1 block type-meta text-text-muted">Not sending for this sequence.</span>
                    )}
                    {isAttached && box.hasSignature === false && (
                      <span className="mt-1 block type-meta text-brand-orange-text">
                        No signature set on this mailbox — its emails go out unsigned. Its owner adds one under
                        Settings → Email.
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
        </>
      )}
      {!canEdit && !loading && (
        <p className="mt-3 text-xs text-text-muted">Only the sequence owner or a manager can change this.</p>
      )}
    </section>
  );
}
