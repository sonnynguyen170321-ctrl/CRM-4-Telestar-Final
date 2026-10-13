'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComposeAttachment } from '@/components/compose/types';

/** How long the rep must pause typing before the draft is saved. */
export const DRAFT_SAVE_DELAY_MS = 1500;

export interface DraftState {
  subject: string;
  bodyHtml: string;
  cc: string[];
  bcc: string[];
  accountId: string;
  attachments: ComposeAttachment[];
}

export interface RestoredDraft extends DraftState {
  updatedAt: string;
}

interface Scope {
  leadId: string;
  /** Set for an inbox reply: the draft belongs to that thread, not to the lead's composer. */
  threadId?: string;
}

const query = (scope: Scope) =>
  `leadId=${encodeURIComponent(scope.leadId)}${scope.threadId ? `&threadId=${encodeURIComponent(scope.threadId)}` : ''}`;

/**
 * Autosave for the composer and the inbox reply box. Saves a moment after the last change, restores
 * what was saved when the place is opened again, and deletes it on discard. The server clears it when
 * the email is queued, so a sent email never comes back as a draft.
 *
 * `shouldSave` is false until the rep has written something of their own (a template filled in by
 * default is not a draft), and while a send is in flight.
 */
export function useDraftAutosave(scope: Scope, state: DraftState, shouldSave: boolean) {
  const [restored, setRestored] = useState<RestoredDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const latest = useRef({ state, shouldSave });
  useEffect(() => { latest.current = { state, shouldSave }; });
  const lastSaved = useRef<string>('');
  const scopeKey = `${scope.leadId}|${scope.threadId ?? ''}`;

  useEffect(() => {
    let live = true;
    setLoaded(false);
    setRestored(null);
    if (!scope.leadId) return;
    fetch(`/api/email/drafts?${query(scope)}`)
      .then((r) => (r.ok ? r.json() : { draft: null }))
      .then((data: { draft: (Omit<RestoredDraft, 'bodyHtml'> & { bodyHtml: string }) | null }) => {
        if (!live) return;
        setRestored(data.draft ? { ...data.draft, accountId: data.draft.accountId ?? '' } : null);
      })
      .catch(() => { if (live) setRestored(null); })
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const save = useCallback(async () => {
    const { state: s } = latest.current;
    if (!scope.leadId) return;
    const payload = {
      ...scope,
      accountId: s.accountId || undefined,
      subject: s.subject,
      bodyHtml: s.bodyHtml,
      cc: s.cc,
      bcc: s.bcc,
      attachmentIds: s.attachments.map((a) => a.id),
    };
    const fingerprint = JSON.stringify(payload);
    if (fingerprint === lastSaved.current) return;
    try {
      const res = await fetch('/api/email/drafts', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: fingerprint });
      if (res.ok) { lastSaved.current = fingerprint; setSavedAt(new Date()); }
    } catch {
      // Autosave is a convenience: a failed save is retried on the next change.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => {
    if (!loaded || !shouldSave) return;
    const timer = setTimeout(() => void save(), DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loaded, shouldSave, save, state.subject, state.bodyHtml, state.cc, state.bcc, state.accountId, state.attachments]);

  const discard = useCallback(async () => {
    lastSaved.current = '';
    await fetch(`/api/email/drafts?${query(scope)}`, { method: 'DELETE' }).catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  /** The draft was queued (the server deleted it); forget what was saved so an undo saves it again. */
  const markSent = useCallback(() => { lastSaved.current = ''; }, []);

  return { restored, loaded, savedAt, discard, flush: save, markSent };
}
