'use client';

import React, { useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { ScheduleMenu } from '@/components/compose/SendControls';

interface Props {
  outboundMessageId: string;
  /** The time it is scheduled for (ISO). */
  scheduledFor: string;
  leadTimezone?: string | null;
  /** Called after the server accepted the change, so the parent can refresh or patch its list. */
  onChanged: (change: { kind: 'cancelled' } | { kind: 'moved'; scheduledFor: string }) => void;
}

/** Cancel and Edit time for a scheduled email, shown in the timeline and the Sent folder. */
export default function ScheduledEmailActions({ outboundMessageId, scheduledFor, leadTimezone, onChanged }: Props) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const base = `/api/email/outbound/${encodeURIComponent(outboundMessageId)}`;

  const cancel = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${base}/cancel`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.error || 'It could not be cancelled', 'error'); return; }
      showToast('Scheduled email cancelled', 'success');
      onChanged({ kind: 'cancelled' });
    } finally { setBusy(false); }
  };

  const move = async (at: Date | null) => {
    if (!at) { showToast('Use Cancel to stop a scheduled email', 'info'); return; }
    setBusy(true);
    try {
      const res = await fetch(`${base}/schedule`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scheduledFor: at.toISOString() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.error || 'The time could not be changed', 'error'); return; }
      showToast('Send time changed', 'success');
      onChanged({ kind: 'moved', scheduledFor: new Date(data.scheduledFor).toISOString() });
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <ScheduleMenu value={new Date(scheduledFor)} onChange={(at) => void move(at)} leadTimezone={leadTimezone} disabled={busy} />
      <button
        type="button" disabled={busy} onClick={() => void cancel()}
        className="rounded-lg border border-card-border px-2 py-1 text-xs font-semibold text-brand-red hover:bg-card-border/30 focus-ring disabled:opacity-50"
      >
        Cancel send
      </button>
    </div>
  );
}
