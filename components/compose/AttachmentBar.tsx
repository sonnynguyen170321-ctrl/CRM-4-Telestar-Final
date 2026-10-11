'use client';

import React, { useRef, useState } from 'react';
import { Paperclip, X, Loader2 } from 'lucide-react';
import {
  ALLOWED_ATTACHMENT_TYPES, ATTACHMENT_ACCEPT, ATTACHMENT_EXTENSIONS_LABEL, MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_TOTAL_BYTES, formatBytes,
} from '@/lib/compose/attachmentPolicy';
import type { ComposeAttachment } from './types';

interface AttachmentBarProps {
  attachments: readonly ComposeAttachment[];
  onChange: (next: ComposeAttachment[]) => void;
  /** Files the chosen template always sends, listed so the rep knows what goes out. */
  templateAttachments?: ReadonlyArray<{ id: string; name: string }>;
  disabled?: boolean;
}

/**
 * Files for this one email. Each is uploaded as soon as it is chosen (the server checks type, size
 * and the 10 MB total again) and sent with the message. A file removed here is deleted from the
 * server too, so nothing orphaned is kept.
 */
export default function AttachmentBar({ attachments, onChange, templateAttachments = [], disabled }: AttachmentBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = attachments.reduce((sum, a) => sum + a.sizeBytes, 0);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    let next = [...attachments];
    let running = total;
    try {
      for (const file of Array.from(files)) {
        const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
        if (!ALLOWED_ATTACHMENT_TYPES[extension]) { setError(`${file.name}: this file type cannot be attached. Allowed: ${ATTACHMENT_EXTENSIONS_LABEL}`); break; }
        if (next.length >= MAX_ATTACHMENTS_PER_MESSAGE) { setError(`At most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per email`); break; }
        if (running + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
          setError(`Attachments are limited to ${formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)} per email. ${file.name} would make it ${formatBytes(running + file.size)}.`);
          break;
        }
        const form = new FormData();
        form.set('file', file);
        const res = await fetch('/api/email/attachments', { method: 'POST', body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data.error || `${file.name} could not be uploaded`); break; }
        next = [...next, data as ComposeAttachment];
        running += (data as ComposeAttachment).sizeBytes;
        onChange(next);
      }
    } catch {
      setError('The upload failed. Check your connection and try again.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (attachment: ComposeAttachment) => {
    onChange(attachments.filter((a) => a.id !== attachment.id));
    // Best effort: a failed delete leaves an unbound upload the server removes after a day.
    await fetch(`/api/email/attachments/${attachment.id}`, { method: 'DELETE' }).catch(() => undefined);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1 rounded-lg border border-card-border px-2 py-1 text-xs font-semibold text-text-secondary hover:text-text-primary focus-ring disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />}
          Attach files
        </button>
        <input ref={inputRef} type="file" multiple accept={ATTACHMENT_ACCEPT} className="hidden" onChange={(event) => void upload(event.target.files)} />
        {templateAttachments.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 rounded-full border border-dashed border-card-border px-2 py-0.5 text-xs text-text-muted" title="Sent with this template">
            <Paperclip className="h-3 w-3" aria-hidden="true" /> {a.name}
          </span>
        ))}
        {attachments.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-card-border/50 px-2 py-0.5 text-xs text-text-primary">
            <Paperclip className="h-3 w-3 text-text-muted" aria-hidden="true" />
            <span className="max-w-[12rem] truncate" title={a.name}>{a.name}</span>
            <span className="text-text-muted">{formatBytes(a.sizeBytes)}</span>
            <button type="button" aria-label={`Remove ${a.name}`} onClick={() => void remove(a)} className="rounded-full text-text-muted hover:text-brand-red focus-ring">
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        {attachments.length > 0 && <span className="text-xs text-text-muted">{formatBytes(total)} of {formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)}</span>}
      </div>
      {error && <p role="alert" className="text-xs font-semibold text-brand-red">{error}</p>}
    </div>
  );
}
