'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Mail, Send, X, Loader2, Eye, EyeOff, Undo2 } from 'lucide-react';
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
import { ChecklistPanel, ScheduleMenu, TestSendButton, TrackingToggles, usePreflight } from '@/components/compose/SendControls';
import { useDraftAutosave } from '@/components/compose/useDraftAutosave';
import { followOutbound } from '@/lib/compose/followOutbound';
import { UNDO_DELAY_SECONDS } from '@/lib/email/sendControls';

interface Task { id: string; type: string; title: string; description: string; dueDate: string; status: string; leadId: string; sequenceId?: string | null; sequenceStep?: number | null; }

/** The builder's placeholder instructions say nothing a rep needs; real instructions are worth showing. */
const PLACEHOLDER_INSTRUCTIONS = /^Log touchpoint details for the \w+ outreach\.?$/;
interface Lead { id: string; firstName: string; lastName: string; company: string; title: string; email: string; phone?: string; sequenceId?: string; sequenceStep?: number; timezone?: string | null; }
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
  // Send controls: a scheduled time (null = now), per-email tracking (preset from the tenant default),
  // and the undo window that follows an immediate send.
  const [scheduleAt, setScheduleAt] = useState<Date | null>(null);
  const [trackOpens, setTrackOpens] = useState(false);
  const [trackClicks, setTrackClicks] = useState(false);
  const [undo, setUndo] = useState<{ id: string; left: number } | null>(null);
  const draftRestoredRef = useRef(false);

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

  const draft = useDraftAutosave(
    { leadId: lead.id },
    { subject, bodyHtml: body, cc, bcc, accountId, attachments },
    isDirty && !sending && !undo,
  );

  // What was saved last time wins over a default template: restore it once, when it arrives.
  useEffect(() => {
    const saved = draft.restored;
    if (!saved || draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    setSubject(saved.subject);
    setBody(saved.bodyHtml);
    setCc(saved.cc);
    setBcc(saved.bcc);
    setAttachments(saved.attachments);
    if (saved.accountId) setAccountId(saved.accountId);
    if (saved.cc.length || saved.bcc.length) setShowCopies(true);
    showToast('Draft restored', 'info');
  }, [draft.restored, showToast]);

  // The tracking toggles start from the tenant default.
  useEffect(() => {
    let live = true;
    fetch('/api/email/send-defaults')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { trackOpens: boolean; trackClicks: boolean } | null) => {
        if (live && d) { setTrackOpens(d.trackOpens); setTrackClicks(d.trackClicks); }
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  const checklist = usePreflight({
    enabled: Boolean(account) && !mailboxesLoading && !undo,
    leadId: lead.id, accountId, subject, body, bulk: Boolean(lead.sequenceId),
  });

  const discardUploads = useCallback(() => {
    for (const a of attachments) void fetch(`/api/email/attachments/${a.id}`, { method: 'DELETE' }).catch(() => undefined);
  }, [attachments]);

  const requestClose = useCallback(() => {
    if (sending) return;
    if (isDirty) { setAskDiscard(true); return; }
    onClose();
  }, [isDirty, onClose, sending]);

  const discard = () => { discardUploads(); void draft.discard(); onClose(); };

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
      // The task's own step when composing for one: a lead can be in several sequences.
      (task?.sequenceId ?? lead.sequenceId)
        ? fetch(`/api/sequences/${task?.sequenceId ?? lead.sequenceId}`).then((r) => (r.ok ? r.json() : null))
        : Promise.resolve(null),
    ])
      .then(([tpls, sequenceData]: [Template[], { steps?: Array<{ order: number; templateId?: string | null }> } | null]) => {
        if (!live) return;
        const emailTemplates = Array.isArray(tpls) ? tpls.filter((t) => t.channel === 'email') : [];
        setTemplates(emailTemplates);
        const stepConfig = sequenceData?.steps?.find((s) => s.order === (task?.sequenceStep ?? lead.sequenceStep));
        const t = emailTemplates.find((x) => x.id === (stepConfig?.templateId ?? ''));
        if (draftRestoredRef.current) return;
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
  }, [lead.id, lead.sequenceId, lead.sequenceStep, task?.sequenceId, task?.sequenceStep]);

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

  const canSend = Boolean(account) && !account?.sendPausedAt && !sending && !undo && !mailboxesLoading && !isHtmlBlank(body) && subject.trim() !== '' && checklist.canSend;

  // After an immediate send the email waits UNDO_DELAY_SECONDS in the queue. The composer stays
  // mounted (hidden), so Undo restores exactly what was written; when the window ends it closes and
  // a toast follows the message to sent / held back / failed.
  useEffect(() => {
    if (!undo) return;
    if (undo.left <= 0) {
      const id = undo.id;
      setUndo(null);
      onSent?.();
      followOutbound(id, lead.email, showToast);
      onClose();
      return;
    }
    const timer = setTimeout(() => setUndo((u) => (u ? { ...u, left: u.left - 1 } : u)), 1000);
    return () => clearTimeout(timer);
  }, [undo, onClose, onSent, lead.email, showToast]);

  const undoSend = async () => {
    if (!undo) return;
    const { id } = undo;
    try {
      const res = await fetch(`/api/email/outbound/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'It could not be taken back.', 'error');
        setUndo({ id, left: 0 });
        return;
      }
    } catch {
      showToast('It could not be taken back.', 'error');
      setUndo({ id, left: 0 });
      return;
    }
    // A fresh key: this is a new attempt, not a retry of the one just cancelled.
    requestIdRef.current = crypto.randomUUID();
    draft.markSent();
    setUndo(null);
    showToast('Send cancelled. Your draft is back.', 'info');
  };

  const sendTest = async () => {
    if (!account) return { ok: false, message: 'No mailbox' };
    try {
      const res = await fetch('/api/email/test-send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id, accountId: account.id, subject, body,
          ...(attachments.length ? { attachmentIds: attachments.map((a) => a.id) } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      const message = res.ok
        ? data.dryRun ? 'Test not sent: this environment is in dry-run mode' : `Test sent to ${data.to}`
        : data.error || 'The test could not be sent';
      showToast(message, res.ok ? (data.dryRun ? 'info' : 'success') : 'error');
      return { ok: res.ok, message };
    } catch {
      showToast('The test could not be sent', 'error');
      return { ok: false, message: 'error' };
    }
  };

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
          trackOpens,
          trackClicks,
          ...(scheduleAt ? { scheduledFor: scheduleAt.toISOString() } : { delaySeconds: UNDO_DELAY_SECONDS }),
          ...(cc.length ? { cc } : {}),
          ...(bcc.length ? { bcc } : {}),
          ...(attachments.length ? { attachmentIds: attachments.map((a) => a.id) } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to send email.');

      const dropped = (data.droppedCopies ?? []) as Array<{ address: string; reason: string }>;
      if (dropped.length > 0) showToast(`Not copied: ${dropped.map((d) => `${d.address} (${d.reason})`).join(', ')}`, 'warning');
      draft.markSent();
      if (data.sendAt) {
        showToast(`Scheduled for ${new Date(data.sendAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Cancel or change it from the Sent folder.`, 'success');
        onSent?.();
        onClose();
      } else if (data.undoSeconds > 0) {
        setUndo({ id: data.outboundMessageId, left: data.undoSeconds });
      } else {
        showToast(`Email queued to ${lead.email}`, 'success');
        onSent?.();
        followOutbound(data.outboundMessageId, lead.email, showToast);
        onClose();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send email.';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSending(false);
    }
  };

  if (undo) {
    return (
      <div role="status" className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-card-border bg-card-bg px-4 py-3 text-xs shadow-2xl">
        <Loader2 className="h-4 w-4 animate-spin text-blue-500" aria-hidden="true" />
        <span className="font-semibold text-text-primary">Sending to {lead.email} in {undo.left}s...</span>
        <button type="button" onClick={() => void undoSend()} className="inline-flex items-center gap-1 rounded-lg border border-card-border px-2.5 py-1 font-semibold text-brand-orange-text hover:bg-card-border/30 focus-ring">
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Undo
        </button>
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4${undo ? ' hidden' : ''}`} role="dialog" aria-modal="true" aria-label="Compose email">
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
          {task?.sequenceStep != null && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-text-secondary">
              <p>This is step {task.sequenceStep} of a sequence. The step is completed, and the sequence moves on, once this email is confirmed sent.</p>
              {task.description && !PLACEHOLDER_INSTRUCTIONS.test(task.description.trim()) && (
                <p className="mt-1 text-text-primary">{task.description}</p>
              )}
            </div>
          )}
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

          <ChecklistPanel state={checklist} />
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
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs text-text-muted">Ctrl+Enter to send{draft.savedAt ? ' - draft saved' : ''}</p>
                <ScheduleMenu value={scheduleAt} onChange={setScheduleAt} leadTimezone={lead.timezone} disabled={sending} />
                <TrackingToggles opens={trackOpens} clicks={trackClicks} onChange={(t) => { setTrackOpens(t.opens); setTrackClicks(t.clicks); }} disabled={sending} />
                <TestSendButton disabled={!canSend} onSend={sendTest} />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={requestClose}
                  className="px-3.5 py-2 border border-card-border bg-bg-main hover:bg-card-border/30 rounded-lg text-xs font-semibold text-text-secondary transition-colors focus-ring">
                  Cancel
                </button>
                <button type="submit" disabled={!account || Boolean(account.sendPausedAt) || !canSend}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5 active:scale-95 focus-ring">
                  {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Send className="w-3.5 h-3.5" aria-hidden="true" />}
                  <span>{sending ? 'Sending…' : scheduleAt ? 'Schedule' : missing.length > 0 ? 'Send anyway' : 'Send Email'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
