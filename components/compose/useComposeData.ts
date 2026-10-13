'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AI_VARIABLE_KEYS, MERGE_FIELD_NAMES, buildMergeContext, type AiVariableKey } from '@/lib/templates/render';
import { findMergeTags, findMissingMergeValues, type MissingMergeValue } from '@/lib/compose/merge';
import { unchipifyMergeTags } from '@/lib/compose/html';
import type { ComposeMailbox, MissingValue, SnippetItem } from './types';
import type { PreviewResult } from './ComposeParts';

/** The caller's mailboxes, with health and quota (GET /api/email/accounts). */
export function useMailboxes() {
  const [mailboxes, setMailboxes] = useState<ComposeMailbox[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    fetch('/api/email/accounts')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: unknown) => { if (live) setMailboxes(Array.isArray(list) ? (list as ComposeMailbox[]) : []); })
      .catch(() => { if (live) setMailboxes([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);
  return { mailboxes, loading };
}

/** The caller's snippets (personal and shared) and a way to save a new personal one. */
export function useSnippets() {
  const [snippets, setSnippets] = useState<SnippetItem[]>([]);
  useEffect(() => {
    let live = true;
    fetch('/api/snippets')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: unknown) => { if (live) setSnippets(Array.isArray(list) ? (list as SnippetItem[]) : []); })
      .catch(() => { if (live) setSnippets([]); });
    return () => { live = false; };
  }, []);

  const create = useCallback(async (name: string, bodyHtml: string): Promise<{ ok: true; snippet: SnippetItem } | { ok: false; error: string }> => {
    try {
      const res = await fetch('/api/snippets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, bodyHtml }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || 'The snippet could not be saved' };
      setSnippets((prev) => [...prev, data as SnippetItem].sort((a, b) => a.name.localeCompare(b.name)));
      return { ok: true, snippet: data as SnippetItem };
    } catch {
      return { ok: false, error: 'Network error saving the snippet' };
    }
  }, []);

  return { snippets, createSnippet: create };
}

/**
 * Merge fields the lead has no value for, read from the draft on the client. Only the fields the
 * client truly knows are judged here: the lead's own basics and the saved AI variables. The rest
 * (company data, the sender, the lead's local time) live on the server, which reports them in the
 * preview (see `needsServerCheck`), so this never cries wolf on them.
 */
const CLIENT_CHECKED_FIELDS = new Set<string>(['firstName', 'lastName', 'company', 'title', 'email', 'phone', ...AI_VARIABLE_KEYS.map((k) => `ai.${k}`)]);

/** True when the draft names a field only the server can judge, so the preview must run to warn about it. */
export function needsServerCheck(text: string): boolean {
  return findMergeTags(unchipifyMergeTags(text)).some((tag) => tag.known && !CLIENT_CHECKED_FIELDS.has(tag.field));
}

export function useMissingValues(
  lead: Parameters<typeof buildMergeContext>[0] | null,
  subject: string,
  body: string,
  /** The lead's saved AI variables once loaded; null while loading (then they are assumed present). */
  aiVariables: Partial<Record<AiVariableKey, string>> | null = null,
): MissingValue[] {
  return useMemo(() => {
    if (!lead) return [];
    const assumed = Object.fromEntries(MERGE_FIELD_NAMES.filter((f) => !CLIENT_CHECKED_FIELDS.has(f) || (f.startsWith('ai.') && !aiVariables)).map((f) => [f, 'server']));
    const context = { ...buildMergeContext({ ...lead, aiVariables }), ...assumed };
    const toValue = (where: 'subject' | 'body') => (m: MissingMergeValue): MissingValue => ({ field: m.field, where });
    const inSubject = findMissingMergeValues(subject, context).map(toValue('subject'));
    const inBody = findMissingMergeValues(unchipifyMergeTags(body), context).map(toValue('body'));
    const merged = new Map<string, MissingValue>();
    for (const m of [...inSubject, ...inBody]) merged.set(m.field, merged.has(m.field) ? { field: m.field } : m);
    return [...merged.values()];
  }, [lead, subject, body, aiVariables]);
}

/** "Preview as this lead": the draft rendered by the server with the real lead and mailbox owner. */
export function useLeadPreview(args: { enabled: boolean; leadId: string; accountId: string; subject: string; body: string; refreshKey?: number }) {
  const { enabled, leadId, accountId, subject, body, refreshKey = 0 } = args;
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [serverMissing, setServerMissing] = useState<MissingValue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const mine = ++seq.current;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/email/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ leadId, ...(accountId ? { accountId } : {}), subject, body }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (mine !== seq.current) return;
        if (!res.ok) { setError(data.error || 'The preview could not be built'); return; }
        setError(null);
        setPreview(data as PreviewResult);
        setServerMissing((data as { missing: MissingValue[] }).missing ?? []);
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError' && mine === seq.current) setError('The preview could not be built');
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [enabled, leadId, accountId, subject, body, refreshKey]);

  return { preview, serverMissing, loading, error };
}

const EMPTY_AI: Partial<Record<AiVariableKey, string>> = {};

/**
 * The lead's saved AI variables ({{ai.icebreaker}} ...): load, generate from research, and save the
 * rep's edits. `version` changes whenever the saved set does, so the preview re-renders.
 */
export function useAiVariables(leadId: string) {
  const [saved, setSaved] = useState<Partial<Record<AiVariableKey, string>> | null>(null);
  const [draft, setDraft] = useState<Partial<Record<AiVariableKey, string>>>(EMPTY_AI);
  const [busy, setBusy] = useState<'generate' | 'save' | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/ai/lead-variables?leadId=${encodeURIComponent(leadId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { values?: Partial<Record<AiVariableKey, string>> } | null) => {
        if (!live) return;
        const values = data?.values ?? EMPTY_AI;
        setSaved(values);
        setDraft(values);
      })
      .catch(() => { if (live) setSaved(EMPTY_AI); });
    return () => { live = false; };
  }, [leadId]);

  const adopt = (values: Partial<Record<AiVariableKey, string>>) => {
    setSaved(values);
    setDraft(values);
    setVersion((v) => v + 1);
  };

  const generate = useCallback(async (instruction?: string) => {
    setBusy('generate');
    setMessage(null);
    try {
      const res = await fetch('/api/ai/lead-variables', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leadId, ...(instruction ? { instruction } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage({ kind: 'error', text: data.message || data.error || 'The AI variables could not be generated' }); return; }
      adopt(data.values ?? EMPTY_AI);
      setMessage({ kind: 'info', text: 'Generated from the saved research. Check and edit them before you send.' });
    } catch {
      setMessage({ kind: 'error', text: 'Network error generating the AI variables' });
    } finally {
      setBusy(null);
    }
  }, [leadId]);

  const save = useCallback(async () => {
    setBusy('save');
    setMessage(null);
    try {
      const res = await fetch('/api/ai/lead-variables', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leadId, values: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage({ kind: 'error', text: data.error || 'Your edits could not be saved' }); return; }
      adopt(data.values ?? EMPTY_AI);
      setMessage({ kind: 'info', text: 'Saved.' });
    } catch {
      setMessage({ kind: 'error', text: 'Network error saving your edits' });
    } finally {
      setBusy(null);
    }
  }, [leadId, draft]);

  const setField = useCallback((key: AiVariableKey, text: string) => setDraft((prev) => ({ ...prev, [key]: text })), []);
  const dirty = saved !== null && AI_VARIABLE_KEYS.some((key) => (draft[key] ?? '') !== (saved[key] ?? ''));
  return { loaded: saved !== null, saved, draft, setField, dirty, busy, message, version, generate, save };
}
