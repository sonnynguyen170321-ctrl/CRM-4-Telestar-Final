'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';

import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

/**
 * Who can see this sequence (lib/visibility.ts).
 *
 * A sequence is private to its creator and the managers above them until a manager shares it with
 * the whole team. The server decides who may change this; the switch is disabled here for the
 * same people it would refuse, so nobody is offered a control that answers 403.
 */
export function SequenceSharingPanel({
  sequenceId,
  isShared,
  ownerName,
  canShare,
  onChange,
}: {
  sequenceId: string;
  isShared: boolean;
  ownerName: string | null;
  /** A manager who may change this sequence. */
  canShare: boolean;
  onChange: (isShared: boolean) => void;
}) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);

  async function setShared(next: boolean) {
    setSaving(true);
    try {
      const res = await fetch(`/api/sequences/${sequenceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isShared: next }),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Could not change who sees this sequence'), 'error');
        return;
      }
      onChange(next);
      showToast(next ? 'Shared with the whole team' : 'Now private to its owner and their managers', 'success');
    } catch {
      showToast('Network error changing who sees this sequence', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="glass-card rounded-2xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-text-primary">
            <Users className="h-4 w-4 text-brand-red" aria-hidden="true" />
            Who can see this sequence
          </h3>
          <p className="mt-1 max-w-[62ch] text-xs leading-5 text-text-secondary">
            {isShared
              ? 'Shared: everyone in the company can see it and enroll their own leads in it.'
              : `Private: only ${ownerName ?? 'its owner'} and the managers above them can see it or enroll leads in it.`}{' '}
            Only the owner and their managers can change it either way. Leads already enrolled keep running whichever
            is chosen.
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-semibold text-text-primary">
          <input
            type="checkbox"
            role="switch"
            className="h-4 w-4 accent-brand-red"
            checked={isShared}
            disabled={!canShare || saving}
            onChange={(event) => void setShared(event.target.checked)}
          />
          Share with the whole team
        </label>
      </div>
      {!canShare && (
        <p className="mt-3 text-xs text-text-muted">Only a manager can share a sequence with the team.</p>
      )}
    </section>
  );
}
