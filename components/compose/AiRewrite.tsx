'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import { ChevronDown, Loader2, Sparkles, Undo2, X } from 'lucide-react';
import { blockRemoteImages } from '@/lib/compose/html';
import { insertBelow, MAX_REWRITE_INSTRUCTION_CHARS, REWRITE_ACTIONS, type RewriteActionId } from '@/lib/compose/rewrite';
import { isHtml } from '@/lib/email/sanitize';
import { useDismiss } from './PickerMenu';

interface RewriteResult { action: RewriteActionId; body: string; source: string; kept: number }

/**
 * AI on the draft (POST /api/ai/compose-rewrite). The rewrite lands in a preview, never in the
 * draft: the rep replaces the draft with it, inserts it below, or discards it, and a replace can be
 * undone until the draft is edited again. Nothing here sends, and the subject is never touched.
 */
export function useAiRewrite(body: string, setBody: (next: string) => void) {
  const [busy, setBusy] = useState<RewriteActionId | null>(null);
  const [result, setResult] = useState<RewriteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ previous: string; applied: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async (action: RewriteActionId, instruction?: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(action);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ai/compose-rewrite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, body, ...(instruction ? { instruction } : {}) }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; body?: string; kept?: number; message?: string; error?: string };
      if (!res.ok || !data.success || typeof data.body !== 'string') {
        setError(data.message || data.error || 'The draft could not be rewritten. Nothing was changed.');
        return;
      }
      setResult({ action, body: data.body, source: body, kept: data.kept ?? 0 });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setError('The draft could not be rewritten. Nothing was changed.');
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setBusy(null); }
    }
  }, [body]);

  /** Forget everything: the draft this belonged to is gone (another thread was opened). */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(null); setResult(null); setError(null); setUndo(null);
  }, []);

  const apply = (next: string) => {
    setUndo({ previous: body, applied: next });
    setBody(next);
    setResult(null);
  };

  return {
    busy,
    result,
    error,
    /** Undo is offered only while the draft is still exactly what the rewrite put there. */
    canUndo: undo !== null && undo.applied === body,
    run,
    cancel: () => { abortRef.current?.abort(); abortRef.current = null; setBusy(null); },
    replace: () => { if (result) apply(result.body); },
    insert: () => { if (result) apply(insertBelow(body, result.body)); },
    discard: () => { setResult(null); setError(null); },
    undoLast: () => { if (undo) { setBody(undo.previous); setUndo(null); } },
    reset,
  };
}

export type AiRewriteState = ReturnType<typeof useAiRewrite>;

/** The "AI rewrite" button and its list of actions, with a box for the rep's own instruction. */
export function AiRewriteMenu({ state, disabled, opensUp }: { state: AiRewriteState; disabled?: boolean; opensUp?: boolean }) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [askInstruction, setAskInstruction] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { setOpen(false); setAskInstruction(false); }, []);
  useDismiss(open, close, ref);

  const choose = (action: RewriteActionId) => {
    if (action === 'custom') { setAskInstruction(true); return; }
    close();
    void state.run(action);
  };
  const runCustom = () => {
    const text = instruction.trim();
    if (!text) return;
    close();
    void state.run('custom', text);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button" disabled={disabled || state.busy !== null} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-lg border border-card-border px-2 py-1 text-xs font-semibold text-text-secondary hover:text-text-primary focus-ring disabled:opacity-50"
      >
        {state.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
        {state.busy ? 'Rewriting...' : 'AI rewrite'}
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Rewrite the draft" className={`absolute right-0 z-20 w-64 ${opensUp ? 'bottom-full mb-1' : 'top-full mt-1'} rounded-xl border border-card-border bg-card-bg p-1.5 shadow-xl`}>
          {REWRITE_ACTIONS.map((a) => (
            <button
              key={a.id} type="button" role="menuitem" onClick={() => choose(a.id)}
              className="block w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-text-primary hover:bg-card-border/30 focus-ring"
            >
              {a.label}
            </button>
          ))}
          {askInstruction && (
            <div className="mt-1 border-t border-card-border px-1 pt-2">
              <label htmlFor="ai-rewrite-instruction" className="text-xs font-semibold text-text-muted">How should it change?</label>
              <div className="mt-1 flex gap-1.5">
                <input
                  id="ai-rewrite-instruction" autoFocus value={instruction} maxLength={MAX_REWRITE_INSTRUCTION_CHARS}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); runCustom(); } }}
                  placeholder="e.g. lead with the cost saving"
                  className="min-w-0 flex-1 rounded-lg border border-card-border bg-bg-main px-2 py-1 text-xs text-text-primary focus:border-brand-red focus:outline-none"
                />
                <button type="button" disabled={!instruction.trim()} onClick={runCustom} className="rounded-lg border border-card-border px-2 py-1 text-xs font-semibold text-text-primary hover:bg-card-border/30 disabled:opacity-40 focus-ring">
                  Rewrite
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const actionLabel = (id: RewriteActionId) => REWRITE_ACTIONS.find((a) => a.id === id)?.label ?? 'Rewrite';

/** The rewrite waiting for a decision, the error that replaced it, or the undo after a replace. */
export function AiRewritePreview({ state, body }: { state: AiRewriteState; body: string }) {
  if (state.busy) {
    return (
      <div role="status" className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-bg-main/40 px-3 py-2 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> {actionLabel(state.busy)}: rewriting your draft...</span>
        <button type="button" onClick={state.cancel} className="font-semibold text-text-secondary hover:text-text-primary focus-ring rounded">Cancel</button>
      </div>
    );
  }
  if (state.error) {
    return (
      <div role="alert" className="flex items-start justify-between gap-2 rounded-lg border border-card-border bg-bg-main/40 px-3 py-2 text-xs">
        <span className="font-semibold text-brand-red">{state.error}</span>
        <button type="button" onClick={state.discard} aria-label="Dismiss" className="text-text-muted hover:text-text-primary focus-ring rounded"><X className="h-3.5 w-3.5" /></button>
      </div>
    );
  }
  if (state.result) {
    const { result } = state;
    return (
      <section aria-label="AI rewrite preview" className="space-y-2 rounded-lg border border-card-border bg-bg-main/40 p-3 text-xs">
        <p className="flex items-center gap-1.5 font-semibold text-text-primary">
          <Sparkles className="h-3.5 w-3.5 text-brand-orange-text" aria-hidden="true" />
          {actionLabel(result.action)} - review before using it
        </p>
        {isHtml(result.body) ? (
          <div
            className="compose-prose max-h-56 select-text overflow-y-auto rounded-lg border border-card-border bg-card-bg px-3 py-2"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(blockRemoteImages(result.body)) }}
          />
        ) : (
          <p className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-card-border bg-card-bg px-3 py-2 text-text-primary">{result.body}</p>
        )}
        {result.kept > 0 && (
          <p className="text-text-muted">
            {result.kept} {result.kept === 1 ? 'variable or block' : 'variables, spintax or conditional blocks'} kept exactly as written{result.action.startsWith('translate') ? ' (not translated)' : ''}.
          </p>
        )}
        {result.source !== body && <p className="text-text-muted">Your draft changed while this was written. Replacing it drops those edits.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={state.replace} className="rounded-lg bg-blue-600 px-2.5 py-1 font-semibold text-white hover:bg-blue-700 focus-ring">Replace draft</button>
          <button type="button" onClick={state.insert} className="rounded-lg border border-card-border px-2.5 py-1 font-semibold text-text-primary hover:bg-card-border/30 focus-ring">Insert below</button>
          <button type="button" onClick={state.discard} className="rounded-lg border border-card-border px-2.5 py-1 font-semibold text-text-secondary hover:text-text-primary focus-ring">Discard</button>
        </div>
      </section>
    );
  }
  if (state.canUndo) {
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-text-muted">
        Draft rewritten.
        <button type="button" onClick={state.undoLast} className="inline-flex items-center gap-1 font-semibold text-brand-orange-text hover:underline focus-ring rounded">
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Undo
        </button>
      </p>
    );
  }
  return null;
}
