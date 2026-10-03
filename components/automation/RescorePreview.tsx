'use client';

import { useState } from 'react';
import { Eye, RefreshCw } from 'lucide-react';

import { readApiError } from '@/lib/api/client';

type Report = {
  considered: number;
  scored: number;
  notScored: number;
  reasons: Record<string, number>;
  truncated: boolean;
  dryRun?: boolean;
  transitions?: Record<string, number>;
  unchanged?: number;
};

const LABEL: Record<string, string> = {
  qualified: 'Fit',
  needs_review: 'Review',
  unqualified: 'No fit',
  unscored: 'Not scored',
};

function describe(key: string): string {
  const [from, to] = key.split('→');
  return `${LABEL[from] ?? from} → ${LABEL[to] ?? to}`;
}

/**
 * Re-score existing leads under the current ICP, preview first.
 *
 * The verdict rule changed (weighted points instead of "any miss is No fit"), and existing leads keep
 * the verdict they were given until they are rescored. SDRs have worked lists built from those
 * verdicts, so the move is shown before it is made: Preview reports how many leads would change and
 * in which direction, writing nothing; Apply is only offered after a preview.
 *
 * One call covers up to 500 leads; `truncated` says when there are more, and the operator repeats.
 */
export function RescorePreview({ showToast }: { showToast: (message: string, kind: 'success' | 'error' | 'info') => void }) {
  const [busy, setBusy] = useState<'' | 'preview' | 'apply'>('');
  const [preview, setPreview] = useState<Report | null>(null);

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'preview' : 'apply');
    try {
      const response = await fetch('/api/leads/rescore-icp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onlyUnscored: false, dryRun }),
      });
      if (!response.ok) {
        showToast(await readApiError(response, dryRun ? 'Preview failed' : 'Rescore failed'), 'error');
        return;
      }
      const report = (await response.json()) as Report;
      if (dryRun) {
        setPreview(report);
      } else {
        setPreview(null);
        showToast(
          `Rescored ${report.scored} lead(s)${report.truncated ? ' — more remain, run again' : ''}.`,
          'success',
        );
      }
    } catch {
      showToast('Network error', 'error');
    } finally {
      setBusy('');
    }
  }

  const moves = Object.entries(preview?.transitions ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <section className="rounded-xl border border-card-border bg-card-bg p-5">
      <h3 className="text-sm font-bold text-text-primary">Re-score existing leads</h3>
      <p className="mt-1 text-xs leading-5 text-text-secondary">
        Leads keep their verdict until they are re-scored. Preview shows what would change; nothing is written until
        you apply.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => run(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-card-border px-4 text-xs font-bold text-text-primary hover:bg-bg-main disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
          {busy === 'preview' ? 'Previewing…' : 'Preview changes'}
        </button>
        {preview && (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => run(false)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-red px-4 text-xs font-bold text-white hover:bg-brand-red-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {busy === 'apply' ? 'Applying…' : `Apply to ${preview.scored} lead(s)`}
          </button>
        )}
      </div>

      {preview && (
        <div className="mt-4 space-y-2 text-xs text-text-secondary" role="status">
          <p>
            {preview.scored} lead(s) checked · {preview.unchanged ?? 0} unchanged
            {preview.notScored > 0 && ` · ${preview.notScored} not scorable`}
            {preview.truncated && ' · first 500 only — more remain'}
          </p>
          {moves.length === 0 ? (
            <p className="font-semibold text-text-primary">No verdict would change.</p>
          ) : (
            <ul className="space-y-1">
              {moves.map(([key, count]) => (
                <li key={key} className="flex justify-between rounded-md border border-card-border px-3 py-1.5">
                  <span>{describe(key)}</span>
                  <span className="font-mono font-semibold text-text-primary">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
