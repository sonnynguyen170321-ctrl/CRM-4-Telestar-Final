'use client';

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';

import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

/**
 * Open and click tracking for one sequence (lib/email/tracking.ts).
 *
 * Both off by default and both opt-in per sequence: a tracking pixel and rewritten links are signals
 * some spam filters weigh, so a team should turn them on where the numbers are worth that cost. The
 * copy says plainly what the numbers can and cannot mean — an "open" is an image load, and some
 * mail apps load every image whether or not a person read anything.
 */
export function SequenceTrackingPanel({ sequenceId }: { sequenceId: string }) {
  const { showToast } = useToast();
  const [trackOpens, setTrackOpens] = useState(false);
  const [trackClicks, setTrackClicks] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/sequences/${sequenceId}`).catch(() => null);
      if (!res?.ok || cancelled) return;
      const data = await res.json();
      const sequence = data.sequence ?? data;
      setTrackOpens(Boolean(sequence.trackOpens));
      setTrackClicks(Boolean(sequence.trackClicks));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [sequenceId]);

  async function save(next: { trackOpens: boolean; trackClicks: boolean }) {
    setSaving(true);
    try {
      const res = await fetch(`/api/sequences/${sequenceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Could not save tracking'), 'error');
        return false;
      }
      showToast('Tracking updated — applies to emails sent from now on', 'success');
      return true;
    } catch {
      showToast('Network error saving tracking', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  const toggle = async (key: 'trackOpens' | 'trackClicks', value: boolean) => {
    const next = { trackOpens, trackClicks, [key]: value };
    if (key === 'trackOpens') setTrackOpens(value);
    else setTrackClicks(value);
    if (!(await save(next))) {
      if (key === 'trackOpens') setTrackOpens(!value);
      else setTrackClicks(!value);
    }
  };

  return (
    <section className="glass-card rounded-2xl p-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-text-primary">
        <Activity className="h-4 w-4 text-brand-red" aria-hidden="true" />
        Tracking
      </h3>
      <p className="mt-1 max-w-[62ch] text-xs leading-5 text-text-secondary">
        Off by default. A tracking image and wrapped links can count against deliverability, so turn them on where the
        numbers matter. Opens are image loads: Apple Mail and some company gateways load every image automatically,
        and those are filtered out where they can be recognised, so treat open rate as a trend rather than a head
        count. Unsubscribe links are never wrapped.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-card-border px-3 text-xs font-semibold text-text-primary">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-red"
            checked={trackOpens}
            disabled={!loaded || saving}
            onChange={(e) => void toggle('trackOpens', e.target.checked)}
          />
          Track opens
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-card-border px-3 text-xs font-semibold text-text-primary">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-red"
            checked={trackClicks}
            disabled={!loaded || saving}
            onChange={(e) => void toggle('trackClicks', e.target.checked)}
          />
          Track link clicks
        </label>
      </div>
    </section>
  );
}
