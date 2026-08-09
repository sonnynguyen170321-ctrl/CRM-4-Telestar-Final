'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Mail, Phone, MessageSquare, Hand } from 'lucide-react';
import Linkedin from '@/components/icons/Linkedin';

/**
 * Estimated cadence for a sequence as the SDR is editing it (spec §28).
 *
 * Deliberately says "estimated": the real send time is re-decided at execution against
 * live CRM state, and the lead's own timezone replaces the preview's once a lead is
 * actually enrolled. Showing these as promises would misrepresent how the engine works.
 */

export interface PreviewStepInput {
  order: number;
  channel: 'email' | 'phone' | 'linkedin' | 'whatsapp';
  delayDays: number;
  delayHours: number;
  autoComplete: boolean;
  sendWindowStartMinutes?: number | null;
  sendWindowEndMinutes?: number | null;
}

interface PreviewStep {
  order: number;
  channel: string;
  isAutomated: boolean;
  dueAtUtc: string;
  dueAtLocal: string;
  adjustmentReason: string;
  hasSendWindow: boolean;
}

const CHANNEL_ICON = {
  email: Mail,
  phone: Phone,
  linkedin: Linkedin,
  whatsapp: MessageSquare,
} as const;

const ADJUSTMENT_LABEL: Record<string, string> = {
  before_send_window: 'moved into the send window',
  after_send_window: 'pushed to the next day’s window',
  weekend_adjustment: 'moved off the weekend',
};

/** "2026-08-10 09:18" → weekday + time, in the timezone the server already resolved. */
function formatLocal(dueAtLocal: string, dueAtUtc: string, timezone: string): { day: string; time: string } {
  const time = dueAtLocal.slice(11, 16);
  const weekday = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  }).format(new Date(dueAtUtc));
  return { day: weekday, time };
}

export default function SequencePreview({
  steps,
  timezone = 'UTC',
  sequenceId,
}: {
  steps: PreviewStepInput[];
  timezone?: string;
  sequenceId?: string;
}) {
  const [preview, setPreview] = useState<PreviewStep[]>([]);
  const [resolvedTz, setResolvedTz] = useState(timezone);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // Serialising the inputs keeps the effect from refiring on every parent render while
  // still recomputing whenever a delay, channel, or window actually changes.
  const stepsKey = JSON.stringify(steps);

  useEffect(() => {
    const parsedSteps: PreviewStepInput[] = JSON.parse(stepsKey);
    if (parsedSteps.length === 0) {
      setPreview([]);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setFailed(false);

    fetch('/api/sequences/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps: parsedSteps, timezone, sequenceId }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        setPreview(data.steps);
        setResolvedTz(data.timezone);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setFailed(true);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [stepsKey, timezone, sequenceId]);

  if (steps.length === 0) {
    return (
      <p className="type-meta text-text-muted">
        Add a step to see when this sequence would reach a prospect.
      </p>
    );
  }

  return (
    <section aria-labelledby="cadence-preview-heading">
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock className="w-4 h-4 text-text-muted" />
        <h3 id="cadence-preview-heading" className="type-subsection">
          Estimated cadence
        </h3>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-text-muted" />}
      </div>

      <p className="type-meta text-text-muted prose-measure mb-3">
        Times shown in {resolvedTz}, starting from a lead enrolled now. Once a lead is
        enrolled the schedule follows that lead’s own timezone, and every send is
        re-checked against live CRM state before it goes out.
      </p>

      {failed ? (
        <p className="type-meta text-text-muted">Could not calculate the cadence right now.</p>
      ) : (
        <ol className="border border-card-border rounded-md divide-y divide-card-border">
          {preview.map((step) => {
            const Icon = CHANNEL_ICON[step.channel as keyof typeof CHANNEL_ICON] ?? Mail;
            const { day, time } = formatLocal(step.dueAtLocal, step.dueAtUtc, resolvedTz);
            const note = ADJUSTMENT_LABEL[step.adjustmentReason];

            return (
              <li key={step.order} className="flex items-center gap-3 px-3 py-2">
                <span className="font-mono type-micro text-text-muted w-6">{step.order}</span>
                <span className="w-28 type-meta">{day}</span>
                <span className="font-mono type-meta w-14">{step.isAutomated ? time : '—'}</span>
                <Icon className="w-3.5 h-3.5 text-text-muted" />
                <span className="type-meta capitalize flex-1">{step.channel}</span>

                {!step.isAutomated && (
                  <span className="inline-flex items-center gap-1 type-micro text-text-muted">
                    <Hand className="w-3 h-3" />
                    Manual
                  </span>
                )}
                {note && <span className="type-micro text-text-muted">{note}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
