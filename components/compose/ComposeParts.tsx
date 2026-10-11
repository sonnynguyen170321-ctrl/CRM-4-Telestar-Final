'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import DOMPurify from 'isomorphic-dompurify';
import { AlertCircle, Eye } from 'lucide-react';
import { blockRemoteImages, hasRemoteImages } from '@/lib/compose/html';
import { MERGE_FIELD_LABELS, SUGGESTED_FALLBACKS, isMergeFieldName } from '@/lib/compose/merge';
import type { MissingValue } from './types';

/**
 * The signature the worker will put under the message, read-only. Shown exactly as stored (images
 * inline); a mailbox with none gets a link to set one, so a missing signature is a choice and not
 * a surprise.
 */
export function SignatureBlock({ html, mailboxEmail, onNavigate }: { html: string | null | undefined; mailboxEmail?: string; onNavigate?: () => void }) {
  if (!html || !html.trim()) {
    return (
      <p className="rounded-lg border border-dashed border-card-border px-3 py-2 text-xs text-text-muted">
        No signature for {mailboxEmail ?? 'this mailbox'} -{' '}
        <Link href="/settings" onClick={onNavigate} className="font-semibold text-brand-orange-text hover:underline">set one in Settings</Link>.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-text-muted">Signature (added automatically)</p>
      <div
        aria-label="Signature preview"
        className="compose-prose max-h-32 select-text overflow-y-auto rounded-lg border border-card-border px-3 py-2 opacity-90"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
      />
    </div>
  );
}

interface MissingValuesPanelProps {
  lead: { firstName: string };
  missing: readonly MissingValue[];
  /** Add `{{field|fallback}}` everywhere the bare tag is used. */
  onAddFallback: (field: string, fallback: string) => void;
}

/**
 * The pre-send warning: merge fields the real lead has no value for, each with a one-click
 * fallback. A field with no obvious fallback asks for the words to use instead.
 */
export function MissingValuesPanel({ lead, missing, onAddFallback }: MissingValuesPanelProps) {
  const [custom, setCustom] = useState<Record<string, string>>({});
  if (missing.length === 0) return null;
  return (
    <div role="status" className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-text-secondary">
      <p className="flex items-center gap-1.5 font-semibold text-red-700 dark:text-red-300">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {lead.firstName || 'This lead'} has no value for {missing.length === 1 ? 'a field' : `${missing.length} fields`} used here. The email would go out with a gap.
      </p>
      <ul className="space-y-1.5">
        {missing.map((m) => {
          const label = isMergeFieldName(m.field) ? MERGE_FIELD_LABELS[m.field] : m.field;
          const suggestion = isMergeFieldName(m.field) ? SUGGESTED_FALLBACKS[m.field] : undefined;
          const typed = custom[m.field] ?? '';
          return (
            <li key={m.field} className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">{`{{${m.field}}}`}</span>
              <span>{label} is empty{m.where ? ` (in the ${m.where})` : ''}.</span>
              {suggestion ? (
                <button type="button" onClick={() => onAddFallback(m.field, suggestion)} className="rounded border border-card-border bg-bg-main px-2 py-0.5 font-semibold text-text-primary hover:border-brand-red">
                  Use &ldquo;{suggestion}&rdquo;
                </button>
              ) : null}
              <input
                aria-label={`Fallback text for ${label}`}
                value={typed}
                onChange={(event) => setCustom((prev) => ({ ...prev, [m.field]: event.target.value }))}
                onKeyDown={(event) => { if (event.key === 'Enter' && typed.trim()) { event.preventDefault(); onAddFallback(m.field, typed); } }}
                placeholder={suggestion ? 'or your own words' : 'words to use instead'}
                className="w-40 rounded border border-card-border bg-bg-main px-2 py-0.5 text-text-primary focus:border-brand-red focus:outline-none"
              />
              <button type="button" disabled={!typed.trim()} onClick={() => onAddFallback(m.field, typed)} className="rounded border border-card-border px-2 py-0.5 font-semibold text-text-secondary hover:text-text-primary disabled:opacity-40">
                Add fallback
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface PreviewResult {
  subject: string;
  bodyHtml: string;
  sender: { name: string; email: string | null };
  lead: { firstName: string; lastName: string; company: string; email: string };
}

/** The draft rendered with the real lead and sender (GET/POST /api/email/preview). */
export function PreviewPane({ preview, loading, error, signatureHtml, to }: { preview: PreviewResult | null; loading: boolean; error: string | null; signatureHtml?: string | null; to: string }) {
  // Web images are not fetched until asked for: a shared template could carry a tracking pixel.
  const [showImages, setShowImages] = useState(false);
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        Preview as {preview ? `${preview.lead.firstName} ${preview.lead.lastName}`.trim() : 'this lead'}
        {loading ? ' - updating...' : ''}
      </p>
      {error ? (
        <p role="alert" className="text-xs font-semibold text-brand-red">{error}</p>
      ) : preview ? (
        <div className="rounded-lg border border-card-border bg-white p-3 text-black">
          {!showImages && hasRemoteImages(preview.bodyHtml) && (
            <p className="mb-2 flex items-center justify-between gap-2 rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
              Images from the web are not loaded.
              <button type="button" onClick={() => setShowImages(true)} className="font-semibold text-blue-700 hover:underline">Load images</button>
            </p>
          )}
          <dl className="mb-2 space-y-0.5 border-b border-gray-200 pb-2 text-xs text-gray-600">
            <div><dt className="inline font-semibold">From: </dt><dd className="inline">{preview.sender.name}{preview.sender.email ? ` <${preview.sender.email}>` : ''}</dd></div>
            <div><dt className="inline font-semibold">To: </dt><dd className="inline">{to}</dd></div>
            <div><dt className="inline font-semibold">Subject: </dt><dd className="inline text-black">{preview.subject}</dd></div>
          </dl>
          <div className="compose-prose max-h-72 select-text overflow-y-auto" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(showImages ? preview.bodyHtml : blockRemoteImages(preview.bodyHtml)) }} />
          {signatureHtml ? <div className="compose-prose mt-3 select-text" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(signatureHtml) }} /> : null}
        </div>
      ) : (
        <p className="text-xs text-text-muted">Loading the preview...</p>
      )}
    </div>
  );
}
