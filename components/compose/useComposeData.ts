'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildMergeContext } from '@/lib/templates/render';
import { findMissingMergeValues, type MissingMergeValue } from '@/lib/compose/merge';
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
 * Merge fields the lead has no value for, read from the draft on the client. The sender's own
 * fields ({{sdrName}}, {{sdrTitle}}) are assumed present here - the server knows the mailbox owner
 * and reports them in the preview - so this never cries wolf on them.
 */
export function useMissingValues(
  lead: Parameters<typeof buildMergeContext>[0] | null,
  subject: string,
  body: string,
): MissingValue[] {
  return useMemo(() => {
    if (!lead) return [];
    const context = { ...buildMergeContext(lead), sdrName: 'sender', sdrTitle: 'sender' };
    const toValue = (where: 'subject' | 'body') => (m: MissingMergeValue): MissingValue => ({ field: m.field, where });
    const inSubject = findMissingMergeValues(subject, context).map(toValue('subject'));
    const inBody = findMissingMergeValues(unchipifyMergeTags(body), context).map(toValue('body'));
    const merged = new Map<string, MissingValue>();
    for (const m of [...inSubject, ...inBody]) merged.set(m.field, merged.has(m.field) ? { field: m.field } : m);
    return [...merged.values()];
  }, [lead, subject, body]);
}

/** "Preview as this lead": the draft rendered by the server with the real lead and mailbox owner. */
export function useLeadPreview(args: { enabled: boolean; leadId: string; accountId: string; subject: string; body: string }) {
  const { enabled, leadId, accountId, subject, body } = args;
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
  }, [enabled, leadId, accountId, subject, body]);

  return { preview, serverMissing, loading, error };
}
