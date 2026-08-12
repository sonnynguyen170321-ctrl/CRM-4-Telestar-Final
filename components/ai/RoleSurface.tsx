'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import MetricCard from '@/components/operating/MetricCard';
import type { StatusTone } from '@/components/operating/states';
import type { RoleSurfaceData, SurfaceGroup } from './types';

/**
 * The viewer's own responsibility, rendered as exceptions (Phase 9).
 *
 * The design rule that matters more than any styling choice here: **a healthy group renders as one
 * green line, not an empty table**. A Team Lead whose pod is on top of everything should be able
 * to read this screen in four seconds and close it. If this component ever starts listing work
 * that is going fine, the surface has stopped being useful.
 *
 * Groups with findings open by default and groups without stay collapsed, so the screen sorts
 * itself into "look at this" and "nothing here" without the reader doing any work.
 */

/**
 * Surface tones onto the shared status palette.
 *
 * `risk` and `money` exist on the server type because a Floor Manager's shortfall and a Director's
 * spend are not the same kind of number as "prospects AI is handling" — but the design system has
 * one palette, and inventing two more colours for two more words is how a system stops being one.
 */
const TONE: Record<string, StatusTone> = {
  risk: 'blocked',
  money: 'neutral',
};
const toneOf = (tone: string | undefined): StatusTone =>
  TONE[tone ?? 'neutral'] ?? ((tone ?? 'neutral') as StatusTone);

const SEVERITY: Record<
  string,
  { icon: typeof CircleAlert; ring: string; text: string; dot: string }
> = {
  critical: { icon: CircleAlert, ring: 'border-red-300', text: 'text-red-800', dot: 'bg-red-600' },
  warning: { icon: TriangleAlert, ring: 'border-amber-300', text: 'text-amber-900', dot: 'bg-amber-500' },
  info: { icon: Info, ring: 'border-card-border', text: 'text-text-secondary', dot: 'bg-gray-400' },
};

function Group({ group }: { group: SurfaceGroup }) {
  const hasFindings = group.items.length > 0;
  const [open, setOpen] = useState(hasFindings);
  const severity = SEVERITY[group.severity] ?? SEVERITY.info;
  const Icon = severity.icon;

  return (
    <section
      className={`rounded-xl border bg-card-bg overflow-hidden ${hasFindings ? severity.ring : 'border-card-border'}`}
      data-testid={`surface-group-${group.key}`}
      data-findings={group.items.length}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-gray-50 focus-ring"
        aria-expanded={open}
      >
        {hasFindings ? (
          <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${severity.text}`} aria-hidden="true" />
        ) : (
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" aria-hidden="true" />
        )}

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <h3 className="type-subsection">{group.title}</h3>
            {hasFindings && (
              <span
                className={`inline-flex items-center justify-center min-w-[1.5rem] px-1.5 h-5 rounded-full type-micro font-mono text-white ${severity.dot}`}
                data-testid={`surface-count-${group.key}`}
              >
                {group.total ?? group.items.length}
              </span>
            )}
          </span>
          <span className="block type-meta text-text-muted mt-0.5 prose-measure">
            {hasFindings ? group.description : group.healthyMessage}
          </span>
        </span>

        {hasFindings &&
          (open ? (
            <ChevronDown className="w-4 h-4 shrink-0 mt-0.5 text-text-muted" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-4 h-4 shrink-0 mt-0.5 text-text-muted" aria-hidden="true" />
          ))}
      </button>

      {open && hasFindings && (
        <ul className="divide-y divide-card-border border-t border-card-border">
          {group.items.map((item) => {
            const body = (
              <>
                <span className="type-body text-text-primary">{item.primary}</span>
                <span className="block type-meta text-text-secondary mt-0.5 prose-measure">{item.secondary}</span>
              </>
            );
            return (
              <li key={item.id} className="px-5 py-3" data-testid={`surface-item-${item.id}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    {item.href ? (
                      <a href={item.href} className="block rounded focus-ring hover:underline">
                        {body}
                      </a>
                    ) : (
                      <div>{body}</div>
                    )}
                  </div>
                  {item.meta && (
                    <span className="type-micro text-text-muted shrink-0 text-right">{item.meta}</span>
                  )}
                </div>
              </li>
            );
          })}
          {(group.total ?? 0) > group.items.length && (
            <li className="px-5 py-2.5 type-meta text-text-muted">
              {(group.total ?? 0) - group.items.length} more not shown.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

export default function RoleSurface({ surface }: { surface: RoleSurfaceData }) {
  const findings = surface.groups.reduce((sum, g) => sum + (g.total ?? g.items.length), 0);

  return (
    <div className="space-y-5" data-testid="role-surface" data-surface={surface.key}>
      <div>
        <h2 className="type-section">{surface.title}</h2>
        <p className="type-meta text-text-muted mt-1 prose-measure">{surface.focus}</p>
      </div>

      {surface.metrics.length > 0 && (
        <section
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${Math.min(surface.metrics.length, 6)}, minmax(0, 1fr))` }}
          aria-label={`${surface.title} summary`}
        >
          {surface.metrics.map((m) => (
            <MetricCard
              key={m.key}
              label={m.label}
              value={m.value}
              tone={toneOf(m.tone)}
              hint={m.hint}
              testId={`surface-metric-${m.key}`}
            />
          ))}
        </section>
      )}

      {findings === 0 && (
        <p
          className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 type-meta text-emerald-900"
          data-testid="surface-all-clear"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          Nothing needs you right now. Automated work is running and every exception is closed.
        </p>
      )}

      <div className="space-y-3">
        {surface.groups.map((g) => (
          <Group key={g.key} group={g} />
        ))}
      </div>

      <p className="type-micro text-text-muted">Built from: {surface.sources.join(' · ')}</p>
    </div>
  );
}
