'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Mail, Send, X, Loader2, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { addMergeFallback, findMergeTags } from '@/lib/compose/merge';
import { isHtmlBlank, unchipifyMergeTags } from '@/lib/compose/html';
import { isHtml } from '@/lib/email/sanitize';
import ComposeEditor from '@/components/compose/ComposeEditor';
import MailboxSelect from '@/components/compose/MailboxSelect';
import RecipientField from '@/components/compose/RecipientField';
import SubjectField from '@/components/compose/SubjectField';
import AttachmentBar from '@/components/compose/AttachmentBar';
import TemplatePicker from '@/components/compose/TemplatePicker';
import { MissingValuesPanel, PreviewPane, SignatureBlock } from '@/components/compose/ComposeParts';
import AiVariablesPanel from '@/components/compose/AiVariablesPanel';
import { needsServerCheck, useAiVariables, useLeadPreview, useMailboxes, useMissingValues, useSnippets } from '@/components/compose/useComposeData';
import type { ComposeAttachment, MissingValue } from '@/components/compose/types';

interface Task { id: string; type: string; title: string; description: string; dueDate: string; status: string; leadId: string; }
interface Lead { id: string; firstName: string; lastName: string; company: string; title: string; email: string; phone?: string; sequenceId?: string; sequenceStep?: number; }
interface Template { id: string; name: string; channel: string; subject?: string | null; body: string }

interface MailComposerModalProps {
  lead: Lead;
  onClose: () => void;
  /** Optional task context (when composing from an email task). */
  task?: Task;
  /** Called after a successful send so the parent can refresh activities. */
  onSent?: () => void;
  /** Seed the subject and/or body (for example from an AI draft). A seeded body is never overwritten by a sequence template. */
  initialSubject?: string;
  initialBody?: string;
}

const DEFAULT_SUBJECT = 'Following up';

/**
 * Compose one email to a lead (from the lead drawer or an email task).
 *
 * The same editor, variable picker, snippets and attachments as the inbox reply and the template
 * editor (components/compose). What is sent is the raw draft with its merge fields: the server
 * fills them in from the real lead and the owner of the chosen mailbox, which is also what
 * "Preview as this lead" shows. Ctrl/Cmd+Enter sends; Escape asks before throwing a draft away.
 */
export default function MailComposerModal({ lead, onClose, task, onSent, initialSubject, initialBody }: MailComposerModalProps) {
  const { showToast } = useToast();
  // One id per open composer. A retried request reuses it, so the server resolves both
  // attempts to the same OutboundMessage instead of sending twice. A task, when present,
  // is a stronger key still and takes precedence server-side.
  const requestIdRef = useRef<string>(crypto.randomUUID());
  const [subject, setSubject] = useState(initialSubject ?? '');
  const [body, setBody] = useState(initialBody ?? '');
  const [accountId, setAccountId] = useState('');
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCopies, setShowCopies] = useState(false);
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [templateAttachments, setTemplateAttachments] = useState<Array<{ id: string; name: string }>>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [previewOn, setPreviewOn] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);

  const { mailboxes, loading: mailboxesLoading } = useMailboxes();
  const { snippets, createSnippet } = useSnippets();
  const account = mailboxes.find((m) => m.id === accountId) ?? null;

  useEffect(() => {
    if (!accountId && mailboxes.length > 0) setAccountId(mailboxes[0].id);
  }, [mailboxes, accountId]);

  const ai = useAiVariables(lead.id);
  const clientMissing = useMissingValues(lead, subject, body, ai.loaded ? ai.saved : null);
  // Company data, the sender and the lead's local time are known to the server only: when the draft
  // uses one, the server render runs in the background so its "no value" warnings show without opening the preview.
  const draftText = `${subject}
${body}`;
  const serverCheck = previewOn || needsServerCheck(draftText);
  const { preview, serverMissing, loading: previewLoading, error: previewError } = useLeadPreview({
    enabled: serverCheck, leadId: lead.id, accountId, subject, body, refreshKey: ai.version,
  });
  const usesAiVariables = useMemo(() => findMergeTags(unchipifyMergeTags(draftText)).some((tag) => tag.field.startsWith('ai.')), [draftText]);
  const missing: MissingValue[] = useMemo(() => {
    const used = new Set(findMergeTags(unchipifyMergeTags(draftText)).map((tag) => tag.field));
    const byField = new Map<string, MissingValue>();
    for (const m of [...clientMissing, ...(serverCheck ? serverMissing.filter((s) => used.has(s.field)) : [])]) if (!byField.has(m.field)) byField.set(m.field, m);
    return [...byField.values()];
  }, [clientMissing, serverMissing, serverCheck, draftText]);

  // A draft worth asking about: the rep has written or attached something of their own.
  const hasExtras = attachments.length > 0 || cc.length > 0 || bcc.length > 0;
  const isDirty = hasExtras || (isHtmlBlank(body) ? false : body !== (initialBody ?? '') || subject !== (initialSubject ?? ''));

  const discardUploads = useCallback(() => {
    for (const a of attachments) void fetch(`/api/email/attachments/${a.id}`, { method: 'DELETE' }).catch(() => undefined);
  }, [attachments]);

  const requestClose = useCallback(() => {
    if (sending) return;
    if (isDirty) { setAskDiscard(true); return; }
    onClose();
  }, [isDirty, onClose, sending]);

  const discard = () => { discardUploads(); onClose(); };

  // Escape: an open menu or popover claims it first (it stops the event before it gets here; the
  // editor's own key handling marks it as handled, so default-prevented is not a signal);
  // otherwise ask before discarding a draft, and a second Escape on the question goes back to writing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (askDiscard) setAskDiscard(false); else requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [askDiscard, requestClose]);

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch('/api/templates').then((r) => (r.ok ? r.json() : [])),
      lead.sequenceId ? fetch(`/api/sequences/${lead.sequenceId}`).then((r) => (r.ok ? r.json() : null)) : Promise.resolve(null),
    ])
      .then(([tpls, sequenceData]: [Template[], { steps?: Array<{ order: number; templateId?: string | null }> } | null]) => {
        if (!live) return;
        const emailTemplates = Array.isArray(tpls) ? tpls.filter((t) => t.channel === 'email') : [];
        setTemplates(emailTemplates);
        const stepConfig = sequenceData?.steps?.find((s) => s.order === lead.sequenceStep);
        const t = emailTemplates.find((x) => x.id === (stepConfig?.templateId ?? ''));
        if (t && !initialBody) {
          setSelectedTemplateId(t.id);
          setSubject(t.subject ?? DEFAULT_SUBJECT);
          setBody(t.body);
        } else {
          setSubject((prev) => prev || DEFAULT_SUBJECT);
        }
      })
      .catch(() => { if (live) setSubject((prev) => prev || DEFAULT_SUBJECT); })
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.sequenceId, lead.sequenceStep]);

  // The files a template always sends, so the rep sees everything that will go out.
  useEffect(() => {
    if (!selectedTemplateId) { setTemplateAttachments([]); return; }
    let live = true;
    fetch(`/api/templates/${selectedTemplateId}/attachments`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Array<{ id: string; name: string }>) => { if (live) setTemplateAttachments(Array.isArray(list) ? list : []); })
      .catch(() => { if (live) setTemplateAttachments([]); });
    return () => { live = false; };
  }, [selectedTemplateId]);

  // The template goes in as written, merge fields and all: they are filled in on the server from
  // the lead and the mailbox owner. Filling them in here used to put "SDR" into every email.
  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const t = templates.find((x) => x.id === templateId);
    if (!t) return;
    setSubject(t.subject ?? DEFAULT_SUBJECT);
    setBody(t.body);
  };

  const addFallback = (field: string, text: string) => {
    setSubject((prev) => addMergeFallback(prev, field, text));
    setBody((prev) => addMergeFallback(prev, field, text));
  };

  const saveSnippet = async (html: string) => {
    const name = window.prompt('Name this snippet')?.trim();
    if (!name) return;
    const result = await createSnippet(name, html);
    showToast(result.ok ? `Snippet "${name}" saved` : result.error, result.ok ? 'success' : 'error');
  };

  const canSend = Boolean(account) && !account?.sendPausedAt && !sending && !mailboxesLoading && !isHtmlBlank(body) && subject.trim() !== '';

  const submit = async () => {
    if (!account) {
      setError('Please select or connect an active email account before sending.');
      showToast('No active email account connected', 'error');
      return;
    }
    if (!canSend) return;

    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accountId: account.id,
          to: lead.email,
          subject,
          body,
          leadId: lead.id,
          templateId: selectedTemplateId || undefined,
          taskId: task?.id,
          clientRequestId: requestIdRef.current,
          ...(cc.length ? { cc } : {}),
          ...(bcc.length ? { bcc } : {}),
          ...(attachments.length ? { attachmentIds: attachments.map((a) => a.id) } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to send email.');

      showToast(`Email queued to ${lead.email}`, 'success');
      const dropped = (data.droppedCopies ?? []) as Array<{ address: string; reason: string }>;
      if (dropped.length > 0) showToast(`Not copied: ${dropped.map((d) => `${d.address} (${d.reason})`).join(', ')}`, 'warning');
      onSent?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send email.';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Compose email">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={requestClose} />

      <form
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); }
        }}
        className="bg-card-bg border border-card-border rounded-2xl shadow-2xl w-full max-w-3xl relative z-10 animate-in zoom-in-95 duration-150 flex flex-col max-h-[92vh]"
      >
        <div className="flex items-center justify-between p-4 border-b border-card-border bg-bg-main/50 rounded-t-2xl">
          <h2 className="font-display font-bold text-sm text-text-primary flex items-center gap-2">
            <Mail className="w-4 h-4 text-blue-500" aria-hidden="true" />
            <span>Compose Email</span>
          </h2>
          <button type="button" onClick={requestClose} aria-label="Close composer"
            className="text-text-muted hover:text-text-primary rounded p-1 hover:bg-card-border/30 focus-ring">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto text-xs">
          <MailboxSelect id="mail-account" mailboxes={mailboxes} selectedId={accountId} onSelect={setAccountId} onNavigate={onClose} />
          {mailboxes.length === 0 && !mailboxesLoading && (
            <p className="text-xs text-text-muted">
              Or <a href={`mailto:${lead.email}?subject=${encodeURIComponent(subject)}`} className="text-brand-orange-text font-semibold hover:underline">open your mail app</a>.
            </p>
          )}

          <div className="flex items-center gap-2">
            <label htmlFor="mail-to" className="w-16 shrink-0 text-xs font-semibold text-text-muted">To</label>
            <input id="mail-to" type="text" readOnly value={`${lead.firstName} ${lead.lastName} <${lead.email}>`}
              className="flex-1 bg-card-border/20 border border-transparent rounded-lg px-2.5 py-1.5 text-text-muted font-medium" />
            {!showCopies && (
              <button type="button" onClick={() => setShowCopies(true)} className="text-xs font-semibold text-brand-orange-text hover:underline focus-ring rounded">
                Cc / Bcc
              </button>
            )}
          </div>
          {(showCopies || cc.length > 0 || bcc.length > 0) && (
            <>
              <RecipientField id="mail-cc" label="Cc" value={cc} onChange={setCc} exclude={[lead.email.toLowerCase()]} />
              <RecipientField id="mail-bcc" label="Bcc" value={bcc} onChange={setBcc} exclude={[lead.email.toLowerCase(), ...cc]} />
            </>
          )}

          <TemplatePicker templates={templates} selectedId={selectedTemplateId} onSelect={applyTemplate} />
          <SubjectField id="mail-subject" value={subject} onChange={setSubject} required missingFields={missing.filter((m) => m.where !== 'body').map((m) => m.field)} />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-muted">Message</span>
              <button
                type="button"
                aria-pressed={previewOn}
                onClick={() => setPreviewOn((on) => !on)}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold focus-ring ${previewOn ? 'border-brand-red/30 bg-brand-red/10 text-brand-red' : 'border-card-border text-text-secondary hover:text-text-primary'}`}
              >
                {previewOn ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                Preview as {lead.firstName || 'this lead'}
              </button>
            </div>
            {/* Kept mounted while previewing so the draft, caret and undo history survive. */}
            <div className={previewOn ? 'hidden' : ''}>
              <ComposeEditor
                value={body}
                onChange={setBody}
                ariaLabel="Email body"
                placeholder="Write your email. Type {{ for variables or / for snippets."
                snippets={snippets}
                onCreateSnippet={(html) => void saveSnippet(html)}
                missingFields={missing.filter((m) => m.where !== 'subject').map((m) => m.field)}
              />
            </div>
            {previewOn && (
              <PreviewPane preview={preview} loading={previewLoading} error={previewError} signatureHtml={account?.signaturePreview} to={lead.email} />
            )}
            {!previewOn && !isHtml(body) && body.trim() !== '' && (
              <p className="text-xs text-text-muted">Plain text: sent without formatting. Switch off &ldquo;Plain text&rdquo; above to format it.</p>
            )}
          </div>

          <MissingValuesPanel lead={lead} missing={missing} onAddFallback={addFallback} />
          <AiVariablesPanel ai={ai} leadFirstName={lead.firstName} defaultOpen={usesAiVariables} />
          {!previewOn && account && <SignatureBlock html={account.signaturePreview} mailboxEmail={account.email} onNavigate={onClose} />}
          <AttachmentBar attachments={attachments} onChange={setAttachments} templateAttachments={templateAttachments} disabled={sending} />

          {error && <p role="alert" className="text-xs text-brand-red font-semibold">{error}</p>}
        </div>

        <div className="p-4 border-t border-card-border bg-bg-main/30 rounded-b-2xl">
          {askDiscard ? (
            <div role="alertdialog" aria-label="Discard this draft?" className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-text-primary">Discard this draft? What you wrote and attached will be lost.</p>
              <div className="flex gap-2">
                <button type="button" autoFocus onClick={() => setAskDiscard(false)}
                  className="px-3.5 py-2 border border-card-border bg-bg-main hover:bg-card-border/30 rounded-lg text-xs font-semibold text-text-secondary focus-ring">
                  Keep writing
                </button>
                <button type="button" onClick={discard}
                  className="px-3.5 py-2 bg-brand-red hover:bg-brand-red-hover text-white rounded-lg text-xs font-semibold focus-ring">
                  Discard
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-text-muted">Ctrl+Enter to send</p>
              <div className="flex gap-2">
                <button type="button" onClick={requestClose}
                  className="px-3.5 py-2 border border-card-border bg-bg-main hover:bg-card-border/30 rounded-lg text-xs font-semibold text-text-secondary transition-colors focus-ring">
                  Cancel
                </button>
                <button type="submit" disabled={!account || Boolean(account.sendPausedAt) || !canSend}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5 active:scale-95 focus-ring">
                  {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Send className="w-3.5 h-3.5" aria-hidden="true" />}
                  <span>{sending ? 'Sending…' : missing.length > 0 ? 'Send anyway' : 'Send Email'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
