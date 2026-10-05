'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import { ImagePlus } from 'lucide-react';
import {
  DEFAULT_SIGNATURE_FIELDS,
  buildSignatureHtml,
  type SignatureFields,
  type SignatureLayout,
} from '@/lib/email/signatureBuilder';
import { SIGNATURE_IMAGE_TYPES, SIGNATURE_LIMITS } from '@/lib/email/signatureLimits';

/**
 * Three ways to make a mailbox signature, one preview.
 *
 * - Builder: fields and a layout, for a rep starting from nothing.
 * - Paste: copy a signature out of Gmail or Outlook and paste it whole — layout, links and hosted
 *   images survive. Pasted or added image files become data URIs, which the server moves into
 *   `signatureImages` and sends inline (lib/email/signature.ts).
 * - HTML: the source, for whoever has one from a designer.
 *
 * The value is always HTML. The preview renders it in a sandboxed iframe (no scripts, no same
 * origin) after the same kind of sanitizing the server applies on save.
 */

type Tab = 'builder' | 'paste' | 'html';

type Props = {
  value: string;
  onChange: (html: string) => void;
  /** Builder starting point — the mailbox and the rep's display name. */
  seed: { email: string; name: string };
  onError: (message: string) => void;
};

const TABS: { id: Tab; label: string }[] = [
  { id: 'builder', label: 'Builder' },
  { id: 'paste', label: 'Paste from Gmail / Outlook' },
  { id: 'html', label: 'HTML' },
];

const LAYOUTS: { id: SignatureLayout; label: string }[] = [
  { id: 'logo-left', label: 'Logo left' },
  { id: 'stacked', label: 'Stacked' },
  { id: 'minimal', label: 'Minimal' },
];

const FIELD_INPUT =
  'w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-brand-red placeholder-text-muted';

function readImageFile(file: File, onError: (message: string) => void): Promise<string | null> {
  if (!(SIGNATURE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    onError('Use a PNG, JPEG, GIF or WebP image');
    return Promise.resolve(null);
  }
  if (file.size > SIGNATURE_LIMITS.maxImageBytes) {
    onError(`That image is ${Math.ceil(file.size / 1000)} KB; the limit is ${SIGNATURE_LIMITS.maxImageBytes / 1000} KB`);
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => {
      onError('Could not read that image');
      resolve(null);
    };
    reader.readAsDataURL(file);
  });
}

function seedFields(seed: Props['seed']): SignatureFields {
  const [firstName = '', ...rest] = seed.name.trim().split(/\s+/);
  return { ...DEFAULT_SIGNATURE_FIELDS, firstName, lastName: rest.join(' '), shortName: firstName, email: seed.email };
}

export default function SignatureEditor({ value, onChange, seed, onError }: Props) {
  const [tab, setTab] = useState<Tab>(value ? 'paste' : 'builder');
  const [fields, setFields] = useState<SignatureFields>(() => seedFields(seed));
  const pasteRef = useRef<HTMLDivElement>(null);

  // The paste surface is uncontrolled while focused; load the current value whenever it opens.
  useEffect(() => {
    if (tab === 'paste' && pasteRef.current) pasteRef.current.innerHTML = DOMPurify.sanitize(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on opening the tab
  }, [tab]);

  const updateField = <K extends keyof SignatureFields>(key: K, next: SignatureFields[K]) => {
    const updated = { ...fields, [key]: next };
    setFields(updated);
    onChange(buildSignatureHtml(updated));
  };

  const syncPaste = () => {
    if (pasteRef.current) onChange(pasteRef.current.innerHTML);
  };

  const insertAtCaret = (html: string) => {
    pasteRef.current?.focus();
    // Deprecated but still the only caret-aware insert contentEditable offers everywhere.
    const inserted = document.execCommand('insertHTML', false, html);
    if (!inserted && pasteRef.current) pasteRef.current.insertAdjacentHTML('beforeend', html);
    syncPaste();
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const html = event.clipboardData.getData('text/html');
    const files = Array.from(event.clipboardData.files);
    if (!html && files.length === 0) return; // plain text: let the browser insert it
    event.preventDefault();
    if (html) {
      insertAtCaret(DOMPurify.sanitize(html));
      return;
    }
    for (const file of files) {
      const dataUri = await readImageFile(file, onError);
      if (dataUri) insertAtCaret(`<img src="${dataUri}" alt="">`);
    }
  };

  const addImage = async (file: File | undefined, target: 'logo' | 'paste') => {
    if (!file) return;
    const dataUri = await readImageFile(file, onError);
    if (!dataUri) return;
    if (target === 'logo') updateField('logoSrc', dataUri);
    else insertAtCaret(`<img src="${dataUri}" alt="" style="display:block;border:0">`);
  };

  const previewDoc = useMemo(
    () =>
      '<!doctype html><html><body style="margin:12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222">' +
      '<p style="color:#888;margin:0 0 8px 0">…your email…</p><p style="color:#888;margin:0">--</p>' +
      `${DOMPurify.sanitize(value)}</body></html>`,
    [value]
  );

  const text = (key: keyof SignatureFields, label: string, placeholder = '') => (
    <label className="space-y-1">
      <span className="type-micro text-text-secondary">{label}</span>
      <input
        value={fields[key]}
        onChange={(e) => updateField(key, e.target.value)}
        placeholder={placeholder}
        className={FIELD_INPUT}
      />
    </label>
  );

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="How to make the signature" className="flex gap-1 border-b border-card-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-brand-orange text-text-primary' : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          {tab === 'builder' && (
            <>
              <p className="type-micro text-text-muted">Changing a field here replaces the current signature.</p>
              <div className="grid grid-cols-2 gap-2">
                {text('closing', 'Closing', 'Best regards,')}
                {text('shortName', 'Sign-off name', 'Mei')}
                {text('firstName', 'First name')}
                {text('lastName', 'Last name')}
              </div>
              {text('title', 'Job title', 'Business Development Manager')}
              <div className="grid grid-cols-2 gap-2">
                {text('phone', 'Phone', '+84 968052740')}
                {text('email', 'Email')}
              </div>
              {text('website', 'Website', 'www.example.com')}
              <div className="space-y-1">
                <span className="type-micro text-text-secondary">Logo — a link, or upload a file</span>
                <div className="flex gap-2">
                  <input
                    value={fields.logoSrc.startsWith('data:') ? '(uploaded image)' : fields.logoSrc}
                    onChange={(e) => updateField('logoSrc', e.target.value)}
                    placeholder="https://…/logo.png"
                    className={FIELD_INPUT}
                  />
                  <label className="shrink-0 cursor-pointer px-2.5 py-1.5 border border-card-border rounded-lg text-xs text-text-secondary hover:text-text-primary">
                    Upload
                    <input type="file" accept={SIGNATURE_IMAGE_TYPES.join(',')} className="sr-only" onChange={(e) => addImage(e.target.files?.[0], 'logo')} />
                  </label>
                </div>
              </div>
              <div className="flex items-end gap-4">
                <label className="space-y-1">
                  <span className="type-micro text-text-secondary block">Name colour</span>
                  <input type="color" value={fields.nameColor} onChange={(e) => updateField('nameColor', e.target.value)} className="h-7 w-12 rounded border border-card-border" />
                </label>
                <label className="space-y-1">
                  <span className="type-micro text-text-secondary block">Accent</span>
                  <input type="color" value={fields.accentColor} onChange={(e) => updateField('accentColor', e.target.value)} className="h-7 w-12 rounded border border-card-border" />
                </label>
                <fieldset className="flex gap-1">
                  <legend className="type-micro text-text-secondary mb-1">Layout</legend>
                  {LAYOUTS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={fields.layout === l.id}
                      onClick={() => updateField('layout', l.id)}
                      className={`px-2 py-1 rounded-md border text-xs ${
                        fields.layout === l.id ? 'border-brand-orange text-text-primary' : 'border-card-border text-text-muted'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </fieldset>
              </div>
            </>
          )}

          {tab === 'paste' && (
            <>
              <p className="type-micro text-text-muted">
                Open an email you sent from Gmail or Outlook, select the whole signature, copy, and paste it below. You can
                edit the text here too.
              </p>
              <div
                ref={pasteRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                aria-label="Signature"
                onPaste={handlePaste}
                onInput={syncPaste}
                className="min-h-40 max-h-72 overflow-auto bg-white text-black border border-card-border rounded-lg p-3 text-xs focus:outline-none focus:border-brand-red"
              />
              <label className="inline-flex items-center gap-1.5 cursor-pointer px-2.5 py-1.5 border border-card-border rounded-lg text-xs text-text-secondary hover:text-text-primary">
                <ImagePlus className="w-3.5 h-3.5" aria-hidden />
                Add image
                <input type="file" accept={SIGNATURE_IMAGE_TYPES.join(',')} className="sr-only" onChange={(e) => addImage(e.target.files?.[0], 'paste')} />
              </label>
            </>
          )}

          {tab === 'html' && (
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              spellCheck={false}
              aria-label="Signature HTML"
              className="w-full h-72 bg-bg-main border border-card-border rounded-lg p-3 font-mono text-xs text-text-primary focus:outline-none focus:border-brand-red resize-none"
            />
          )}
        </div>

        <div className="space-y-1">
          <span className="type-micro text-text-secondary">Preview — as a prospect sees it</span>
          <iframe title="Signature preview" sandbox="" srcDoc={previewDoc} className="w-full h-80 bg-white border border-card-border rounded-lg" />
        </div>
      </div>
    </div>
  );
}
