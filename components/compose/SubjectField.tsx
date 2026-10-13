'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Braces } from 'lucide-react';
import { findMergeTags, mergePickerItems } from '@/lib/compose/merge';
import { insertMergeTag, insertText } from '@/lib/templates/insertMergeTag';
import { PickerList, useDismiss, type PickerItem } from './PickerMenu';

interface SubjectFieldProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
  /** Fields the lead has no value for; their chips under the field turn red. */
  missingFields?: readonly string[];
  required?: boolean;
  disabled?: boolean;
  label?: string;
}

const ITEMS: PickerItem[] = mergePickerItems();

/**
 * The subject line. A subject is a single line of plain text, so merge fields are not chips inside
 * it; they are inserted from the Variables list (or by typing `{{`), and the fields it uses are
 * shown as chips under the field - red when the lead has no value for one.
 */
export default function SubjectField({ id, value, onChange, missingFields = [], required, disabled, label = 'Subject' }: SubjectFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState<'button' | 'trigger' | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ITEMS.filter((item) => `${item.label} ${item.id}`.toLowerCase().includes(q)) : ITEMS;
  }, [query]);
  useDismiss(open !== null, () => setOpen(null), wrapRef);

  const used = useMemo(() => {
    const seen = new Map<string, { raw: string; fallback: string | null }>();
    for (const tag of findMergeTags(value)) if (!seen.has(tag.raw)) seen.set(tag.raw, { raw: tag.raw, fallback: tag.fallback });
    return [...seen.values()].map((tag) => ({ ...tag, field: findMergeTags(tag.raw)[0].field }));
  }, [value]);

  const pick = (item: PickerItem) => {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? value.length;
    let start = caret;
    // Typed `{{par`: replace what was typed, not just insert after it.
    if (open === 'trigger') {
      const typed = /\{\{[a-zA-Z.]{0,24}$/.exec(value.slice(0, caret));
      if (typed) start = caret - typed[0].length;
    }
    // A variable goes in as {{field}}; a syntax-help row (conditional, spintax) as its own text.
    const next = item.insert ? insertText(value, start, caret, item.insert) : insertMergeTag(value, start, caret, item.id);
    onChange(next.value);
    setOpen(null);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    onChange(next);
    const before = next.slice(0, event.target.selectionStart ?? next.length);
    const typed = /\{\{([a-zA-Z.]{0,24})$/.exec(before);
    if (typed) { setOpen('trigger'); setQuery(typed[1]); setActive(0); } else if (open === 'trigger') setOpen(null);
  };

  return (
    <div ref={wrapRef} className="relative space-y-1">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="w-16 shrink-0 text-xs font-semibold text-text-muted">{label}</label>
        <input
          id={id}
          ref={inputRef}
          type="text"
          value={value}
          required={required}
          disabled={disabled}
          onChange={handleChange}
          onKeyDown={(event) => {
            if (open !== 'trigger' || items.length === 0) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => (i + 1) % items.length); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => (i - 1 + items.length) % items.length); }
            if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); pick(items[Math.min(active, items.length - 1)]); }
          }}
          className="flex-1 rounded-lg border border-card-border bg-bg-main px-2.5 py-1.5 text-xs font-medium text-text-primary focus:border-brand-red focus:outline-none"
        />
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open === 'button'}
          onClick={() => { setOpen(open === 'button' ? null : 'button'); setQuery(''); setActive(0); }}
          className="inline-flex items-center gap-1 rounded-lg border border-card-border px-2 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary focus-ring"
        >
          <Braces className="h-3.5 w-3.5" aria-hidden="true" /> Variables
        </button>
      </div>

      {used.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 pl-[4.5rem] text-xs text-text-muted">
          Uses
          {used.map((tag) => {
            const missing = missingFields.includes(tag.field) && !tag.fallback;
            return (
              <span
                key={tag.raw}
                className={`rounded-full px-2 py-0.5 ${missing ? 'bg-red-100 font-semibold text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'}`}
              >
                {tag.raw}{missing ? ' - no value' : ''}
              </span>
            );
          })}
        </p>
      )}

      {open && (
        <div className="absolute right-0 top-9 z-30 w-72 rounded-lg border border-card-border bg-card-bg shadow-xl">
          <PickerList
            items={items}
            activeIndex={Math.min(active, Math.max(0, items.length - 1))}
            onPick={(item) => pick(item)}
            onHover={setActive}
            label="Variables"
            listId={`${id}-variables`}
            emptyText="No matching variable"
          />
        </div>
      )}
    </div>
  );
}
