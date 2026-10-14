/**
 * Follows a queued email after the composer has closed, and says how it ended: sent, held back
 * (deferred for a sending limit) or failed with a plain reason. Browser-only; polls the slim own-message
 * status route (GET /api/email/outbound/[id]/status) with a gentle backoff and gives up quietly.
 */
export type ToastKind = 'success' | 'error' | 'info' | 'warning';
type Notify = (message: string, type?: ToastKind) => void;

interface Status {
  phase: 'scheduled' | 'queued' | 'deferred' | 'sending' | 'sent' | 'failed' | 'cancelled';
  label: string;
  detail: string | null;
  final: boolean;
}

/** First poll after 2 s, then every 3 s, easing to 10 s; at most about 3 minutes. */
export function pollDelayMs(attempt: number): number {
  return Math.min(2000 + attempt * 1000, 10_000);
}
const MAX_ATTEMPTS = 24;

export function followOutbound(outboundMessageId: string, to: string, notify: Notify): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let announcedDeferred = false;

  const tick = async (attempt: number) => {
    if (stopped) return;
    let status: Status | null = null;
    try {
      const res = await fetch(`/api/email/outbound/${encodeURIComponent(outboundMessageId)}/status`);
      if (res.ok) status = (await res.json()) as Status;
      else if (res.status === 404) return;
    } catch {
      // A network blip is not a result; try again.
    }
    if (stopped) return;
    if (status) {
      if (status.phase === 'sent') return notify(`Email sent to ${to}`, 'success');
      if (status.phase === 'failed') return notify(`Email to ${to} failed: ${status.detail ?? 'it was not sent.'}`, 'error');
      if (status.phase === 'cancelled') return;
      if (status.phase === 'scheduled') return; // Waiting on purpose; the Sent folder shows the time.
      if (status.phase === 'deferred' && !announcedDeferred) {
        announcedDeferred = true;
        notify(`Email to ${to} is held back: ${status.detail ?? 'a sending limit was reached.'}`, 'warning');
      }
      if (status.phase === 'deferred') return; // It resumes on its own; stop polling.
    }
    if (attempt + 1 >= MAX_ATTEMPTS) return;
    timer = setTimeout(() => void tick(attempt + 1), pollDelayMs(attempt));
  };

  timer = setTimeout(() => void tick(0), 2000);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
