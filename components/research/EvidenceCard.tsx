'use client';

import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';

import { parseEvidenceFacts, type EvidenceBreakdownRow } from '@/lib/research/evidenceFacts';

export type EvidenceItem = {
  id: string;
  sourceKind: string;
  provider: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceSnippet: string | null;
  observedAt: string;
};

const KEYWORD_PREVIEW = 12;
const PROSE_CLAMP_CHARS = 280;

/**
 * One evidence row in the drawer. A structured snippet (Exa on a LinkedIn company page) becomes
 * a fact grid, an executive list, a workforce breakdown and keyword chips, with the raw text one
 * click away; plain prose gets a clamp and a "Show more". Parsing is display-only — see
 * `lib/research/evidenceFacts.ts`.
 */
export default function EvidenceCard({ item }: { item: EvidenceItem }) {
  const parsed = useMemo(() => parseEvidenceFacts(item.sourceSnippet), [item.sourceSnippet]);
  const rawId = `evidence-raw-${item.id}`;

  return (
    <article className="rounded-xl border border-card-border bg-bg-main p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="type-meta font-semibold text-text-primary">{item.sourceTitle || item.sourceKind}</span>
        <span className="type-meta font-mono text-text-muted">
          {item.provider || 'source'}  /  {new Date(item.observedAt).toLocaleDateString()}
        </span>
      </div>

      {parsed.isStructured ? (
        <div className="mt-3 space-y-4">
          {parsed.prose && <Prose text={parsed.prose} id={`${rawId}-prose`} />}

          {parsed.facts.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {parsed.facts.map((fact) => (
                <div key={fact.key} className="min-w-0">
                  <dt className="type-meta text-text-muted">{fact.label}</dt>
                  <dd className="mt-0.5 break-words type-meta font-semibold text-text-primary">
                    {fact.href ? (
                      <a
                        href={fact.href}
                        target={fact.href.startsWith('mailto:') ? undefined : '_blank'}
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center break-all text-brand-red hover:underline"
                      >
                        {fact.value}
                      </a>
                    ) : (
                      fact.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {parsed.executives.length > 0 && (
            <div>
              <h4 className="type-meta font-bold text-text-primary">Key people</h4>
              <ul className="mt-1.5 space-y-1">
                {parsed.executives.map((person) => (
                  <li key={`${person.name}-${person.title}`} className="type-meta text-text-secondary">
                    <span className="font-semibold text-text-primary">{person.name}</span>
                    <span className="text-text-muted">  ·  {person.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {parsed.breakdown && (
            <div className="grid gap-4 sm:grid-cols-3">
              <BreakdownGroup title="By country" rows={parsed.breakdown.country} />
              <BreakdownGroup title="By department" rows={parsed.breakdown.department} />
              <BreakdownGroup title="By seniority" rows={parsed.breakdown.seniority} />
            </div>
          )}

          {parsed.keywords.length > 0 && <Keywords keywords={parsed.keywords} />}

          {item.sourceSnippet && (
            <details className="group">
              <summary className="cursor-pointer select-none type-meta font-semibold text-text-muted hover:text-text-primary">
                Raw snippet
              </summary>
              <pre id={rawId} className="mt-2 whitespace-pre-wrap break-words type-meta leading-relaxed text-text-secondary">
                {item.sourceSnippet}
              </pre>
            </details>
          )}
        </div>
      ) : (
        parsed.prose && (
          <div className="mt-2">
            <Prose text={parsed.prose} id={`${rawId}-prose`} />
          </div>
        )
      )}

      {item.sourceUrl && (
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex min-h-11 items-center gap-2 type-meta font-semibold text-brand-red hover:underline"
        >
          Open source <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      )}
    </article>
  );
}

function Prose({ text, id }: { text: string; id: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsClamp = text.length > PROSE_CLAMP_CHARS;
  return (
    <div>
      <p
        id={id}
        className={`type-meta leading-relaxed text-text-secondary ${needsClamp && !expanded ? 'line-clamp-4' : ''}`}
      >
        {text}
      </p>
      {needsClamp && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 min-h-11 type-meta font-semibold text-brand-red hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function BreakdownGroup({ title, rows }: { title: string; rows: EvidenceBreakdownRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="type-meta font-bold text-text-primary">{title}</h4>
      <ul className="mt-1.5 space-y-1.5">
        {rows.map((row) => (
          <li key={row.label} className="type-meta text-text-secondary">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">{row.label}</span>
              <span className="shrink-0 font-mono text-text-muted">
                {row.count}{row.pct != null ? ` (${row.pct}%)` : ''}
              </span>
            </div>
            {row.pct != null && (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-card-border" aria-hidden="true">
                <div className="h-full rounded bg-brand-red/60" style={{ width: `${Math.min(100, row.pct)}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Keywords({ keywords }: { keywords: string[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? keywords : keywords.slice(0, KEYWORD_PREVIEW);
  const hidden = keywords.length - visible.length;
  return (
    <div className="flex flex-wrap gap-2">
      {visible.map((keyword) => (
        <span key={keyword} className="rounded-full border border-card-border bg-card-bg px-2.5 py-1 type-meta text-text-muted">
          {keyword}
        </span>
      ))}
      {(hidden > 0 || showAll) && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
          className="inline-flex min-h-11 items-center rounded-full border border-dashed border-card-border px-3 type-meta font-semibold text-brand-red hover:underline"
        >
          {showAll ? 'Show fewer' : `+${hidden} more`}
        </button>
      )}
    </div>
  );
}
