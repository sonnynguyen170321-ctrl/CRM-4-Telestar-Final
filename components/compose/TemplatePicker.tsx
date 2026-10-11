'use client';

import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, FileText, Search } from 'lucide-react';
import { orderByRecent, pushRecentId, readRecentIds } from '@/lib/compose/recents';
import { useDismiss } from './PickerMenu';

export interface TemplateOption {
  id: string;
  name: string;
  subject?: string | null;
}

interface TemplatePickerProps {
  templates: readonly TemplateOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** localStorage key for the "recently used" order. */
  recentKey?: string;
  label?: string;
}

const store = () => (typeof window === 'undefined' ? null : window.localStorage);

/** A searchable template list with the ones used lately first. "Blank" starts from nothing. */
export default function TemplatePicker({ templates, selectedId, onSelect, recentKey = 'compose:recentTemplates', label = 'Template' }: TemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, () => setOpen(false), wrapRef);

  const selected = templates.find((t) => t.id === selectedId);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? templates.filter((t) => `${t.name} ${t.subject ?? ''}`.toLowerCase().includes(q)) : templates;
    // Recents lead only when not searching: a search is "show me this", in list order.
    return q ? [...matches] : orderByRecent(matches, recent);
  }, [templates, query, recent]);
  const recentCount = query.trim() ? 0 : shown.filter((t) => recent.includes(t.id)).length;

  const choose = (id: string) => {
    if (id) setRecent(pushRecentId(store(), recentKey, id));
    onSelect(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={wrapRef} className="relative flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-semibold text-text-muted">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setRecent(readRecentIds(store(), recentKey)); setOpen((o) => !o); }}
        className="flex flex-1 items-center justify-between gap-2 rounded-lg border border-card-border bg-bg-main px-2.5 py-1.5 text-left text-xs font-medium text-text-primary focus-ring"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
          <span className="truncate">{selected ? selected.name : 'Blank - start from scratch'}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-[4.5rem] right-0 top-full z-30 mt-1 rounded-lg border border-card-border bg-card-bg shadow-xl">
          <div className="flex items-center gap-1.5 border-b border-card-border px-2.5">
            <Search className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search templates"
              aria-label="Search templates"
              className="w-full bg-transparent py-1.5 text-xs text-text-primary focus:outline-none"
            />
          </div>
          <ul role="listbox" aria-label="Templates" className="max-h-60 overflow-y-auto py-1">
            <li role="option" aria-selected={selectedId === ''} onMouseDown={(e) => { e.preventDefault(); choose(''); }} className="cursor-pointer px-3 py-1.5 text-xs text-text-secondary hover:bg-card-border/30">
              Blank - start from scratch
            </li>
            {shown.length === 0 && <li className="px-3 py-2 text-xs text-text-muted">No template matches &ldquo;{query}&rdquo;</li>}
            {shown.map((t, index) => (
              <React.Fragment key={t.id}>
                {index === 0 && recentCount > 0 && <li aria-hidden="true" className="px-3 pt-1 text-xs font-semibold text-text-muted">Recently used</li>}
                {index === recentCount && recentCount > 0 && <li aria-hidden="true" className="px-3 pt-1 text-xs font-semibold text-text-muted">All templates</li>}
                <li
                  role="option"
                  aria-selected={t.id === selectedId}
                  onMouseDown={(e) => { e.preventDefault(); choose(t.id); }}
                  className={`cursor-pointer px-3 py-1.5 text-xs hover:bg-card-border/30 ${t.id === selectedId ? 'bg-brand-red/10 text-text-primary' : 'text-text-secondary'}`}
                >
                  <span className="font-semibold">{t.name}</span>
                  {t.subject ? <span className="ml-2 text-text-muted">{t.subject}</span> : null}
                </li>
              </React.Fragment>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
