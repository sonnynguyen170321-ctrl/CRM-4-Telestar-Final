'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';

import type {
  IcpVersionRulesV2,
  PointRule,
  PointRuleGroup,
  PointRules,
} from '@telestar/core-scoring/rules/schema-v2';
import { starterPointRules } from '@/lib/leadgen/pointsQualification';
import type { IcpPreviewResult } from '@/lib/leads/icpPreview';

/**
 * Per-value scoring points with a live preview on real leads.
 *
 * The owner's spec (2026-10-03): points on each specific value ("CEO +30, VP Sales +25, United
 * States +20"), the effect visible on real leads while editing, in its own tab. The scoring itself
 * is `lib/leadgen/pointsQualification.ts`; this edits `rules.pointRules` and asks
 * `/api/icp/versions/[id]/preview-score` what the unsaved rules would do. The preview never writes,
 * so it runs after every pause in typing.
 */

const GROUPS: { key: PointRuleGroup; label: string; placeholder: string; hint: string }[] = [
  { key: 'title', label: 'Job title', placeholder: 'CEO, Founder', hint: 'Matched as whole words in the lead title' },
  { key: 'country', label: 'Country', placeholder: 'United States, UK', hint: 'Company country; aliases like UK / USA work' },
  { key: 'industry', label: 'Industry', placeholder: 'SaaS, Software', hint: 'Company industry or industry tags' },
  { key: 'size', label: 'Company size', placeholder: '', hint: 'Only scores when headcount is known' },
  { key: 'keyword', label: 'Keyword', placeholder: 'payments, logistics', hint: 'Anywhere in the company description' },
];

const VERDICT_LABEL = { qualified: 'Fit', needs_review: 'Review', unqualified: 'No fit' } as const;
const VERDICT_TONE = {
  qualified: 'text-emerald-400',
  needs_review: 'text-amber-400',
  unqualified: 'text-text-muted',
} as const;

const fieldClass =
  'min-h-10 w-full rounded-lg border border-card-border bg-bg-main px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-red focus:ring-2 focus:ring-brand-red/20 disabled:cursor-not-allowed disabled:opacity-60';

const csv = (value: string) => Array.from(new Set(value.split(',').map((part) => part.trim()).filter(Boolean)));

/** A row id not yet used in this rule set — derived, so rendering stays pure. */
function nextRuleId(rules: PointRule[], group: PointRuleGroup): string {
  const taken = new Set(rules.map((rule) => rule.id));
  let n = rules.filter((rule) => rule.group === group).length + 1;
  while (taken.has(`${group}-${n}`)) n += 1;
  return `${group}-${n}`;
}

/** The most points a lead can score: the best positive row of every group. */
function maxPossible(points: PointRules): number {
  const best = new Map<PointRuleGroup, number>();
  for (const rule of points.rules) {
    if (rule.points > 0) best.set(rule.group, Math.max(best.get(rule.group) ?? 0, rule.points));
  }
  return [...best.values()].reduce((sum, value) => sum + value, 0);
}

export function ScoringPointsEditor({
  rules,
  editable,
  versionId,
  onChange,
  onEdit,
}: {
  rules: IcpVersionRulesV2;
  editable: boolean;
  versionId: string;
  onChange: (rules: IcpVersionRulesV2) => void;
  /** Starts a draft from a published version — the "Edit" path. */
  onEdit: () => void;
}) {
  const points = rules.pointRules;
  const setPoints = (next: PointRules | undefined) => {
    const copy = { ...rules };
    if (next) copy.pointRules = next;
    else delete copy.pointRules;
    onChange(copy);
  };
  const updateRule = (id: string, patch: Partial<PointRule>) =>
    points && setPoints({ ...points, rules: points.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) });
  const removeRule = (id: string) => points && setPoints({ ...points, rules: points.rules.filter((rule) => rule.id !== id) });
  const addRule = (group: PointRuleGroup) =>
    points &&
    setPoints({
      ...points,
      rules: [
        ...points.rules,
        { id: nextRuleId(points.rules, group), group, values: [], points: group === 'title' ? 20 : 10 },
      ],
    });

  const preview = useLivePreview(versionId, rules);
  const ceiling = points ? maxPossible(points) : 0;

  return (
    <div className="mt-6 grid grid-cols-[minmax(0,1fr)_360px] gap-6">
      <div className="space-y-5">
        {!editable && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3">
            <p className="text-xs text-text-secondary">
              This version is published, so it is read-only. Edit creates a new draft from it; publish the draft to
              replace this one. Past scores keep the rules they were made with.
            </p>
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex min-h-10 shrink-0 items-center rounded-lg bg-brand-red px-4 text-xs font-bold text-white hover:bg-brand-red-hover"
            >
              Edit
            </button>
          </div>
        )}

        {!points ? (
          <div className="rounded-xl border border-dashed border-card-border p-6">
            <h4 className="text-sm font-bold text-text-primary">Score with points per value</h4>
            <p className="mt-1 max-w-[60ch] text-xs leading-5 text-text-secondary">
              Give each title, country or industry its own points — CEO +30, United States +20 — and set the totals
              for Fit and Review. Disqualifiers and excluded lists still reject a lead whatever its points.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={!editable}
                onClick={() => setPoints(starterPointRules(rules))}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-red px-4 text-xs font-bold text-white hover:bg-brand-red-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Generate from this ICP
              </button>
              <button
                type="button"
                disabled={!editable}
                onClick={() => setPoints({ enabled: true, rules: [], fitAt: 50, reviewAt: 25 })}
                className="inline-flex min-h-10 items-center rounded-lg border border-card-border px-4 text-xs font-bold text-text-primary hover:bg-bg-main disabled:cursor-not-allowed disabled:opacity-50"
              >
                Start empty
              </button>
            </div>
          </div>
        ) : (
          <fieldset disabled={!editable} className="space-y-5">
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-card-border px-3 text-xs font-semibold text-text-primary">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-red"
                checked={points.enabled}
                onChange={(e) => setPoints({ ...points, enabled: e.target.checked })}
              />
              Use points to decide Fit / Review / No fit for this ICP
              {!points.enabled && <span className="font-normal text-text-muted">— off: the dimension weights decide</span>}
            </label>

            {GROUPS.map((group) => {
              const rows = points.rules.filter((rule) => rule.group === group.key);
              return (
                <section key={group.key} className="rounded-xl border border-card-border p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h4 className="text-sm font-bold text-text-primary">{group.label}</h4>
                    <span className="text-xs text-text-muted">{group.hint}</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {rows.map((rule) => (
                      <div key={rule.id} className="grid grid-cols-[minmax(0,1fr)_96px_40px] items-center gap-2">
                        {group.key === 'size' ? (
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="number"
                              min={0}
                              aria-label="Minimum employees"
                              className={fieldClass}
                              placeholder="Min staff"
                              value={rule.minEmployees ?? ''}
                              onChange={(e) => updateRule(rule.id, { minEmployees: e.target.value ? Number(e.target.value) : undefined })}
                            />
                            <input
                              type="number"
                              min={0}
                              aria-label="Maximum employees"
                              className={fieldClass}
                              placeholder="Max staff"
                              value={rule.maxEmployees ?? ''}
                              onChange={(e) => updateRule(rule.id, { maxEmployees: e.target.value ? Number(e.target.value) : undefined })}
                            />
                          </div>
                        ) : (
                          <input
                            aria-label={`${group.label} values`}
                            className={fieldClass}
                            placeholder={group.placeholder}
                            defaultValue={rule.values.join(', ')}
                            onBlur={(e) => updateRule(rule.id, { values: csv(e.target.value) })}
                          />
                        )}
                        <input
                          type="number"
                          min={-100}
                          max={100}
                          aria-label="Points"
                          className={`${fieldClass} text-right font-mono ${rule.points < 0 ? 'text-red-400' : ''}`}
                          value={rule.points}
                          onChange={(e) => updateRule(rule.id, { points: Math.max(-100, Math.min(100, Math.round(Number(e.target.value) || 0))) })}
                        />
                        <button
                          type="button"
                          aria-label="Remove rule"
                          onClick={() => removeRule(rule.id)}
                          className="inline-flex min-h-10 items-center justify-center rounded-lg text-text-muted hover:bg-bg-main hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => addRule(group.key)}
                    className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-text-secondary hover:bg-bg-main hover:text-text-primary"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add {group.label.toLowerCase()} rule
                  </button>
                </section>
              );
            })}

            <section className="rounded-xl border border-card-border p-4">
              <h4 className="text-sm font-bold text-text-primary">Verdict</h4>
              <div className="mt-3 grid grid-cols-3 items-end gap-3">
                <label className="space-y-1 text-xs font-semibold text-text-secondary">
                  Fit at or above
                  <input
                    type="number"
                    className={fieldClass}
                    value={points.fitAt}
                    onChange={(e) => setPoints({ ...points, fitAt: Math.round(Number(e.target.value) || 0) })}
                  />
                </label>
                <label className="space-y-1 text-xs font-semibold text-text-secondary">
                  Review at or above
                  <input
                    type="number"
                    className={fieldClass}
                    value={points.reviewAt}
                    onChange={(e) => setPoints({ ...points, reviewAt: Math.round(Number(e.target.value) || 0) })}
                  />
                </label>
                <p className="pb-2 text-xs text-text-muted">Max possible: {ceiling} points</p>
              </div>
              {points.fitAt <= points.reviewAt && (
                <p className="mt-2 text-xs font-semibold text-amber-700" role="alert">
                  Fit must be higher than Review.
                </p>
              )}
              {points.fitAt > ceiling && (
                <p className="mt-2 text-xs font-semibold text-amber-700" role="status">
                  No lead can reach Fit: the best possible total is {ceiling}.
                </p>
              )}
              <p className="mt-2 text-xs leading-5 text-text-secondary">
                Within a group only the best match counts once (CEO &amp; Founder = +30, not +60); groups add up. A lead
                missing a title, country or industry is Review at best — never No fit just for missing data.
              </p>
            </section>
          </fieldset>
        )}
      </div>

      <PreviewPanel state={preview} />
    </div>
  );
}

type PreviewState = { loading: boolean; error: string | null; result: IcpPreviewResult | null };

/** Re-scores a sample of real leads 600ms after the rules stop changing. Never writes. */
function useLivePreview(versionId: string, rules: IcpVersionRulesV2): PreviewState {
  const [state, setState] = useState<PreviewState>({ loading: false, error: null, result: null });
  const body = useMemo(() => JSON.stringify({ rulesJson: rules }), [rules]);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setState((current) => ({ ...current, loading: true }));
      try {
        const response = await fetch(`/api/icp/versions/${versionId}/preview-score`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: abort.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setState((current) => ({ ...current, loading: false, error: data.error ?? 'Preview failed' }));
          return;
        }
        setState({ loading: false, error: null, result: data as IcpPreviewResult });
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return;
        setState((current) => ({ ...current, loading: false, error: 'Network error' }));
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [body, versionId]);

  useEffect(() => () => controller.current?.abort(), []);
  return state;
}

function PreviewPanel({ state }: { state: PreviewState }) {
  const { result, loading, error } = state;
  return (
    <aside className="sticky top-4 self-start rounded-xl border border-card-border bg-bg-main p-4" aria-live="polite">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-text-primary">Live preview</h4>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-text-muted" aria-label="Updating preview" />}
      </div>
      {error && <p className="mt-2 text-xs text-amber-700">{error}</p>}
      {!result ? (
        <p className="mt-3 text-xs text-text-muted">Scoring a sample of your leads…</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-text-muted">
            If saved — {result.sampleSize} {result.scope === 'icp_campaigns' ? 'leads in this ICP’s campaigns' : 'most recent leads'}.
            Nothing is written.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(['qualified', 'needs_review', 'unqualified'] as const).map((key) => (
              <div key={key} className="rounded-lg border border-card-border p-2 text-center">
                <p className={`text-lg font-bold ${VERDICT_TONE[key]}`}>{result.after[key]}</p>
                <p className="text-[11px] text-text-muted">
                  {VERDICT_LABEL[key]} <span className="font-mono">(now {result.before[key]})</span>
                </p>
              </div>
            ))}
          </div>
          {result.before.unscored > 0 && (
            <p className="mt-2 text-[11px] text-text-muted">{result.before.unscored} are not scored yet.</p>
          )}

          <h5 className="mt-4 text-xs font-bold text-text-secondary">Examples</h5>
          <ul className="mt-2 max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {result.examples.map((example) => (
              <li key={example.leadId} className="rounded-lg border border-card-border p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-text-primary">{example.name}</p>
                    <p className="truncate text-[11px] text-text-muted">
                      {[example.title, example.company].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-[11px]">
                    <span className="text-text-muted">
                      {example.before.qualification ? VERDICT_LABEL[example.before.qualification] : '—'}
                    </span>
                    {' → '}
                    <span className={`font-semibold ${VERDICT_TONE[example.after.qualification]}`}>
                      {VERDICT_LABEL[example.after.qualification]}
                    </span>
                    <span className="block font-mono text-text-muted">
                      {example.after.points != null ? `${example.after.points} pts` : `${example.after.fitScore}`}
                    </span>
                  </p>
                </div>
                {example.after.matches.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {example.after.matches.map((match) => (
                      <span
                        key={`${match.ruleId}-${match.matched}`}
                        className={`rounded border px-1.5 py-0.5 text-[10px] ${match.points < 0 ? 'border-red-500/30 text-red-400' : 'border-card-border text-text-secondary'}`}
                      >
                        {match.matched} {match.points > 0 ? `+${match.points}` : match.points}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
