'use client';

import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { AI_VARIABLE_KEYS } from '@/lib/templates/render';
import { MERGE_FIELD_LABELS } from '@/lib/compose/merge';
import type { useAiVariables } from './useComposeData';

interface AiVariablesPanelProps {
  ai: ReturnType<typeof useAiVariables>;
  leadFirstName: string;
  /** Open by default when the draft already uses an {{ai.*}} variable. */
  defaultOpen?: boolean;
}

/**
 * The lead's AI-tailored variables: a button that writes them from the saved company research,
 * and a box per variable so the rep can correct each one before sending. Nothing here is sent
 * unseen - the preview and the worker both render exactly these saved values. When there is no
 * research the button says so and the variables stay empty (the template's fallback is used).
 */
export default function AiVariablesPanel({ ai, leadFirstName, defaultOpen = false }: AiVariablesPanelProps) {
  return (
    <details open={defaultOpen} className="rounded-xl border border-card-border bg-bg-main/40 p-3 text-xs">
      <summary className="flex cursor-pointer items-center gap-1.5 font-semibold text-text-primary">
        <Sparkles className="h-3.5 w-3.5 text-brand-orange-text" aria-hidden="true" />
        AI personalization for {leadFirstName || 'this lead'}
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-text-muted">
          Written only from the research we hold on this company; with none, nothing is made up. Edit any line, then save.
          Use them as {'{{ai.icebreaker}}'} and so on.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={ai.busy !== null}
            onClick={() => void ai.generate()}
            className="inline-flex items-center gap-1 rounded-lg border border-card-border bg-bg-main px-2.5 py-1 font-semibold text-text-primary hover:border-brand-red disabled:opacity-50 focus-ring"
          >
            {ai.busy === 'generate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
            Generate AI variables
          </button>
          <button
            type="button"
            disabled={!ai.dirty || ai.busy !== null}
            onClick={() => void ai.save()}
            className="rounded-lg border border-card-border px-2.5 py-1 font-semibold text-text-secondary hover:text-text-primary disabled:opacity-40 focus-ring"
          >
            {ai.busy === 'save' ? 'Saving...' : 'Save edits'}
          </button>
        </div>
        {ai.message ? (
          <p role={ai.message.kind === 'error' ? 'alert' : 'status'} className={ai.message.kind === 'error' ? 'font-semibold text-brand-red' : 'text-text-muted'}>
            {ai.message.text}
          </p>
        ) : null}
        <ul className="space-y-1.5">
          {AI_VARIABLE_KEYS.map((key) => (
            <li key={key} className="flex flex-col gap-0.5">
              <label htmlFor={`ai-var-${key}`} className="font-semibold text-text-muted">
                {MERGE_FIELD_LABELS[`ai.${key}`]}
              </label>
              <textarea
                id={`ai-var-${key}`}
                rows={2}
                maxLength={600}
                value={ai.draft[key] ?? ''}
                onChange={(event) => ai.setField(key, event.target.value)}
                placeholder="Empty - the template's fallback is used"
                className="w-full resize-y rounded-lg border border-card-border bg-bg-main px-2 py-1 text-text-primary focus:border-brand-red focus:outline-none"
              />
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
