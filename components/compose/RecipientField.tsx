'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { MAX_COPY_RECIPIENTS, isValidRecipient, splitRecipientInput } from '@/lib/compose/recipients';

interface RecipientFieldProps {
  id: string;
  label: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** Addresses that may not be added (the main recipient). Compared lower-case. */
  exclude?: readonly string[];
}

/**
 * CC / BCC: addresses become chips on Enter, comma, space or when the field loses focus, and a
 * paste of several addresses at once is split. Each is checked on the spot; the server checks again.
 */
export default function RecipientField({ id, label, value, onChange, exclude = [] }: RecipientFieldProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commit = (raw: string) => {
    const parts = splitRecipientInput(raw);
    if (parts.length === 0) { setDraft(''); return; }
    const next = [...value];
    const problems: string[] = [];
    for (const part of parts) {
      const address = part.toLowerCase();
      if (next.includes(address) || exclude.includes(address)) continue;
      if (!isValidRecipient(address)) { problems.push(part); continue; }
      if (next.length >= MAX_COPY_RECIPIENTS) { setError(`At most ${MAX_COPY_RECIPIENTS} addresses`); break; }
      next.push(address);
    }
    onChange(next);
    if (problems.length > 0) {
      // Keep what could not be read in the box so the rep can correct it rather than retype it.
      setDraft(problems.join(' '));
      setError(`${problems.join(', ')} ${problems.length > 1 ? 'are not valid email addresses' : 'is not a valid email address'}`);
    } else {
      setDraft('');
      if (next.length < MAX_COPY_RECIPIENTS) setError(null);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <label htmlFor={id} className="w-16 shrink-0 pt-1.5 text-xs font-semibold text-text-muted">{label}</label>
        <div className="flex min-h-[2rem] flex-1 flex-wrap items-center gap-1 rounded-lg border border-card-border bg-bg-main px-1.5 py-1 focus-within:border-brand-red">
          {value.map((address) => (
            <span key={address} className="inline-flex items-center gap-1 rounded-full bg-card-border/50 px-2 py-0.5 text-xs text-text-primary">
              {address}
              <button
                type="button"
                aria-label={`Remove ${address}`}
                onClick={() => onChange(value.filter((a) => a !== address))}
                className="rounded-full text-text-muted hover:text-brand-red focus-ring"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          <input
            id={id}
            value={draft}
            onChange={(event) => {
              const next = event.target.value;
              setError(null);
              // A pasted list, or a separator typed after an address, commits what came before it.
              if (/[\s,;]/.test(next) && next.trim()) commit(next); else setDraft(next);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); if (draft.trim()) commit(draft); }
              if (event.key === 'Backspace' && !draft && value.length > 0) onChange(value.slice(0, -1));
            }}
            onBlur={() => { if (draft.trim()) commit(draft); }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            placeholder={value.length === 0 ? 'name@company.com' : ''}
            className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-xs text-text-primary focus:outline-none"
          />
        </div>
      </div>
      {error && <p id={`${id}-error`} role="alert" className="pl-[4.5rem] text-xs font-semibold text-brand-red">{error}</p>}
    </div>
  );
}
