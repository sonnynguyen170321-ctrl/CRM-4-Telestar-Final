'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Mail,
  Send,
  Trash2,
  AlertTriangle,
  Loader2,
  Search,
  CheckCircle,
  Inbox,
  Reply,
  Sparkles,
  Wand2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import DOMPurify from 'isomorphic-dompurify';
import { useRouter } from 'next/navigation';
import { openLeadSlideOver } from '@/lib/leads/openLead';
import { describeDelivery } from '@/lib/inbox/deliveryStatus';
import ComposeEditor from '@/components/compose/ComposeEditor';
import RecipientField from '@/components/compose/RecipientField';
import AttachmentBar from '@/components/compose/AttachmentBar';
import { SignatureBlock } from '@/components/compose/ComposeParts';
import { useMailboxes, useSnippets } from '@/components/compose/useComposeData';
import type { ComposeAttachment } from '@/components/compose/types';
import { ScheduleMenu } from '@/components/compose/SendControls';
import ScheduledEmailActions from '@/components/compose/ScheduledEmailActions';
import { useDraftAutosave } from '@/components/compose/useDraftAutosave';
import { UNDO_DELAY_SECONDS } from '@/lib/email/sendControls';
import { isHtmlBlank, plainTextToHtml } from '@/lib/compose/html';
import { bodySnippet, bodyToText } from '@/lib/compose/snippet';

interface Message {
  id: string;
  type: 'inbound' | 'outbound';
  fromEmail: string;
  fromName: string | null;
  to: string;
  subject: string;
  body: string | null;
  bodyHtml: string | null;
  providerMessageId: string;
  date: string;
  isRead: boolean;
  isSpam: boolean;
  isTrash: boolean;
  replyClass?: string | null;
  replyKind?: string | null;
  replyConfidence?: number | null;
  classificationSource?: string | null;
  /** Outbound only: where the send stands (queued, sent, failed, ...) and why, when it did not go. */
  deliveryStatus?: string | null;
  deliveryError?: string | null;
  /** Outbound only: when a scheduled send goes out, and whether the viewer wrote it (Cancel / Edit time are theirs). */
  scheduledFor?: string | null;
  canManageSchedule?: boolean;
}

interface Thread {
  id: string;
  subject: string;
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    company: string;
    operatingState?: string | null;
  } | null;
  messages: Message[];
  latestMessageAt: string;
  isRead: boolean;
  folder: string;
}

/** GET /api/inbox/views: the inboxes this viewer may open, and the chosen one's mailboxes. */
interface InboxViews {
  ownerId: string;
  people: { id: string; firstName: string; lastName: string; role: string }[];
  mailboxes: { id: string; email: string; isActive: boolean }[];
}

function inboxQuery(folder: string, ownerId: string, accountId: string): string {
  const params = new URLSearchParams({ folder });
  if (ownerId) params.set('userId', ownerId);
  if (accountId) params.set('accountId', accountId);
  return params.toString();
}

export default function InboxPage() {
  const { showToast } = useToast();
  const router = useRouter();
  const [folder, setFolder] = useState<'inbox' | 'sent' | 'spam' | 'trash'>('inbox');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(false);
  // The server reads a window of the most recent messages per direction and says, in a header,
  // whether that window was full. When it is, the list is "recent mail", not "all mail", and
  // the column says so rather than implying an older thread simply does not exist.
  const [windowInfo, setWindowInfo] = useState<{ truncated: boolean; size: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Whose inbox, and which of its mailboxes (lib/inbox/scope.ts). Empty owner = the viewer's own.
  const [inboxOwnerId, setInboxOwnerId] = useState('');
  const [mailboxFilter, setMailboxFilter] = useState('');
  const [views, setViews] = useState<InboxViews | null>(null);
  
  // Reply box states
  const [replyBody, setReplyBody] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  // Copies and files for the reply being written; cleared when it is queued.
  const [replyCc, setReplyCc] = useState<string[]>([]);
  const [replyBcc, setReplyBcc] = useState<string[]>([]);
  const [showReplyCopies, setShowReplyCopies] = useState(false);
  const [replyAttachments, setReplyAttachments] = useState<ComposeAttachment[]>([]);
  // Send later: null sends now (after the 10 s undo window).
  const [replyScheduleAt, setReplyScheduleAt] = useState<Date | null>(null);
  const { mailboxes } = useMailboxes();
  const { snippets: replySnippets, createSnippet } = useSnippets();
  // One id per reply being written. A retried click (double tap, flaky network) reuses it, so the
  // server resolves both to the same queued message. A new one is minted after each queued reply.
  const replyRequestIdRef = useRef<string>(crypto.randomUUID());

  // AI 1-Click Draft Assistant states
  const [aiDraftsLoading, setAiDraftsLoading] = useState(false);
  const [aiDraftResult, setAiDraftResult] = useState<any>(null);
  const [aiCustomInstruction, _setAiCustomInstruction] = useState('');
  const [showAiDrafts, setShowAiDrafts] = useState(false);

  // Load threads
  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inbox?${inboxQuery(folder, inboxOwnerId, mailboxFilter)}`);
      if (res.ok) {
        const data = await res.json();
        setThreads(data);
        setWindowInfo({
          truncated: res.headers.get('X-Inbox-Truncated') === 'true',
          size: Number(res.headers.get('X-Inbox-Window') ?? 0),
        });

        // Functional form on purpose: reading `selectedThread` directly would put it in this
        // callback's deps, which would change loadThreads' identity on every selection and —
        // once the effect below depends on it — refetch the whole folder each time a user
        // clicks a thread.
        setSelectedThread((prev) => {
          // Nothing selected yet: land on the first thread.
          if (!prev) return data.length > 0 ? data[0] : null;
          // Keep the same thread selected, with its refreshed content. Null when it is gone
          // from this folder.
          return data.find((t: Thread) => t.id === prev.id) || null;
        });
      } else {
        showToast('Failed to load inbox threads', 'error');
      }
    } catch {
      showToast('Network error loading inbox', 'error');
    } finally {
      setLoading(false);
    }
  }, [folder, inboxOwnerId, mailboxFilter, showToast]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    let cancelled = false;
    const query = inboxOwnerId ? `?userId=${encodeURIComponent(inboxOwnerId)}` : '';
    fetch(`/api/inbox/views${query}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: InboxViews | null) => {
        if (!cancelled) setViews(data);
      })
      .catch(() => {
        if (!cancelled) setViews(null);
      });
    return () => {
      cancelled = true;
    };
  }, [inboxOwnerId]);

  const switchInbox = (ownerId: string) => {
    setInboxOwnerId(ownerId);
    setMailboxFilter('');
    setSelectedThread(null);
  };

  // Mark selected thread as read if unread
  useEffect(() => {
    if (selectedThread && !selectedThread.isRead) {
      const unreadInboundIds = selectedThread.messages
        .filter((m) => m.type === 'inbound' && !m.isRead)
        .map((m) => m.id);

      if (unreadInboundIds.length > 0) {
        fetch('/api/inbox', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageIds: unreadInboundIds, action: 'read' }),
        }).then((res) => {
          if (res.ok) {
            // Update local state
            setThreads((prev) =>
              prev.map((t) =>
                t.id === selectedThread.id
                  ? {
                      ...t,
                      isRead: true,
                      messages: t.messages.map((m) =>
                        unreadInboundIds.includes(m.id) ? { ...m, isRead: true } : m
                      ),
                    }
                  : t
              )
            );
            setSelectedThread((prev) =>
              prev
                ? {
                    ...prev,
                    isRead: true,
                    messages: prev.messages.map((m) =>
                      unreadInboundIds.includes(m.id) ? { ...m, isRead: true } : m
                    ),
                  }
                : null
            );
          }
        });
      }
    }
  }, [selectedThread]);

  // Handle actions (archive/trash/spam)
  const handleBulkAction = async (action: 'read' | 'unread' | 'spam' | 'trash' | 'delete', thread: Thread) => {
    const inboundIds = thread.messages.filter((m) => m.type === 'inbound').map((m) => m.id);
    if (inboundIds.length === 0 && action !== 'delete') {
      showToast('Only received messages can be updated in folder states', 'info');
      return;
    }

    try {
      const res = await fetch('/api/inbox', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageIds: action === 'delete' ? thread.messages.map((m) => m.id) : inboundIds,
          action,
        }),
      });

      if (res.ok) {
        showToast(`Conversation moved to ${action}`, 'success');
        
        // Remove from list
        setThreads((prev) => prev.filter((t) => t.id !== thread.id));
        if (selectedThread?.id === thread.id) {
          setSelectedThread(null);
        }
      } else {
        showToast('Failed to apply folder action', 'error');
      }
    } catch {
      showToast('Network error applying folder action', 'error');
    }
  };

  // After a reply is queued, look at its real state a few times and show it: sent, deferred by a
  // sending limit, or failed with the reason. Silent: no list spinner, no change of selection.
  const watchDelivery = async (outboundId: string) => {
    for (const waitMs of [4_000, 8_000, 20_000, 30_000]) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      try {
        const res = await fetch(`/api/inbox?${inboxQuery(folder, inboxOwnerId, mailboxFilter)}`);
        if (!res.ok) continue;
        const fresh: Thread[] = await res.json();
        const found = fresh.flatMap((t) => t.messages).find((m) => m.id === outboundId);
        if (!found) return;
        const patch = (t: Thread): Thread => ({
          ...t,
          messages: t.messages.map((m) =>
            m.id === outboundId ? { ...m, deliveryStatus: found.deliveryStatus, deliveryError: found.deliveryError } : m
          ),
        });
        setThreads((prev) => prev.map(patch));
        setSelectedThread((prev) => (prev ? patch(prev) : prev));
        if (found.deliveryStatus === 'sent') {
          showToast('Reply sent', 'success');
          return;
        }
        if (found.deliveryStatus && !['pending', 'sending'].includes(found.deliveryStatus)) {
          const shown = describeDelivery(found.deliveryStatus, null);
          const why = found.deliveryError ?? shown?.detail;
          showToast(`Reply ${shown?.label.toLowerCase() ?? 'not sent'}${why ? `: ${why}` : ''}`, 'error');
          return;
        }
      } catch {
        // Next look.
      }
    }
  };

  // Handle sending reply
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedThread || isHtmlBlank(replyBody) || sendingReply) return;

    setSendingReply(true);
    try {
      const res = await fetch(`/api/inbox/threads/${encodeURIComponent(selectedThread.id)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: replyBody,
          subject: selectedThread.subject,
          leadId: selectedThread.lead?.id,
          clientRequestId: replyRequestIdRef.current,
          ...(replyScheduleAt ? { scheduledFor: replyScheduleAt.toISOString() } : { delaySeconds: UNDO_DELAY_SECONDS }),
          ...(replyCc.length ? { cc: replyCc } : {}),
          ...(replyBcc.length ? { bcc: replyBcc } : {}),
          ...(replyAttachments.length ? { attachmentIds: replyAttachments.map((a) => a.id) } : {}),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Queued, not sent: a worker sends it. The message below shows its real state, and a
        // failure is toasted when it happens.
        showToast(data.sendAt ? `Reply scheduled for ${new Date(data.sendAt).toLocaleString()}` : 'Reply queued. You can undo it for a few seconds.', 'success');
        replyDraft.markSent();
        setReplyScheduleAt(null);
        const dropped = (data.droppedCopies ?? []) as Array<{ address: string; reason: string }>;
        if (dropped.length > 0) showToast(`Not copied: ${dropped.map((d) => `${d.address} (${d.reason})`).join(', ')}`, 'warning');
        replyRequestIdRef.current = crypto.randomUUID();
        if (!data.sendAt) void watchDelivery(data.outboundMessage.id);
        
        // Clear editor
        setReplyBody('');
        setReplyCc([]);
        setReplyBcc([]);
        setReplyAttachments([]);
        
        // Update thread local state
        const queued = { ...data.outboundMessage, deliveryStatus: data.status ?? 'pending', deliveryError: null };
        const updatedMessages = [...selectedThread.messages, queued];
        setSelectedThread({ ...selectedThread, messages: updatedMessages });
        setThreads((prev) =>
          prev.map((t) =>
            t.id === selectedThread.id ? { ...t, messages: updatedMessages, latestMessageAt: data.outboundMessage.date } : t
          )
        );
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to send reply', 'error');
      }
    } catch {
      showToast('Network error sending reply', 'error');
    } finally {
      setSendingReply(false);
    }
  };

  const saveReplySnippet = async (html: string) => {
    const name = window.prompt('Name this snippet')?.trim();
    if (!name) return;
    const result = await createSnippet(name, html);
    showToast(result.ok ? `Snippet "${name}" saved` : result.error, result.ok ? 'success' : 'error');
  };

  const handleGenerateAiDrafts = async () => {
    if (!selectedThread) return;
    setAiDraftsLoading(true);
    setShowAiDrafts(true);
    try {
      const res = await fetch('/api/ai/draft-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: selectedThread.id,
          leadId: selectedThread.lead?.id,
          subject: selectedThread.subject,
          customInstructions: aiCustomInstruction || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiDraftResult(data.data);
      } else {
        // The route says why (e.g. no AI provider available) and never fills in canned drafts.
        const failure = await res.json().catch(() => null);
        showToast(failure?.message || failure?.error || 'Failed to generate AI drafts', 'error');
      }
    } catch {
      showToast('Network error generating AI drafts', 'error');
    } finally {
      setAiDraftsLoading(false);
    }
  };

  const handleApplyAiDraft = (draftBody: string) => {
    setReplyBody(plainTextToHtml(draftBody));
    showToast('AI draft inserted into composer!', 'success');
  };

  const replyMailbox = useMemo(() => {
    const latestInbound = [...(selectedThread?.messages ?? [])].reverse().find((m) => m.type === 'inbound');
    const wrote = latestInbound?.to?.toLowerCase();
    return wrote ? mailboxes.find((m) => m.email.toLowerCase() === wrote) ?? null : null;
  }, [selectedThread, mailboxes]);

  // Autosave of the reply being written, per thread; restored when the thread is opened again.
  const replyDraft = useDraftAutosave(
    { leadId: selectedThread?.lead?.id ?? '', threadId: selectedThread?.id },
    { subject: selectedThread?.subject ?? '', bodyHtml: replyBody, cc: replyCc, bcc: replyBcc, accountId: replyMailbox?.id ?? '', attachments: replyAttachments },
    Boolean(selectedThread?.lead) && !isHtmlBlank(replyBody) && !sendingReply,
  );
  const selectedThreadId = selectedThread?.id;
  // A different thread starts with an empty reply box (the old text would otherwise be saved into it).
  useEffect(() => {
    setReplyBody(''); setReplyCc([]); setReplyBcc([]); setReplyAttachments([]); setReplyScheduleAt(null);
  }, [selectedThreadId]);
  const restoredReply = replyDraft.restored;
  useEffect(() => {
    if (!restoredReply) return;
    setReplyBody(restoredReply.bodyHtml);
    setReplyCc(restoredReply.cc);
    setReplyBcc(restoredReply.bcc);
    setReplyAttachments(restoredReply.attachments);
    if (restoredReply.cc.length || restoredReply.bcc.length) setShowReplyCopies(true);
  }, [restoredReply]);

  // Undo a reply still in its window, or take back a scheduled one: the message leaves the thread and,
  // for an undo, its text returns to the reply box.
  const takeBack = async (msg: Message) => {
    const res = await fetch(`/api/email/outbound/${encodeURIComponent(msg.id)}/cancel`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || 'It could not be taken back', 'error'); return; }
    const drop = (t: Thread): Thread => ({ ...t, messages: t.messages.filter((m) => m.id !== msg.id) });
    setThreads((prev) => prev.map(drop));
    setSelectedThread((prev) => (prev ? drop(prev) : prev));
    if (!msg.scheduledFor && isHtmlBlank(replyBody)) { setReplyBody(msg.bodyHtml || msg.body || ''); replyDraft.markSent(); }
    showToast(msg.scheduledFor ? 'Scheduled reply cancelled' : 'Send cancelled. Your reply is back in the box.', 'success');
  };

  const [classFilter, setClassFilter] = useState<'all' | 'needs_attention' | 'C' | 'D' | 'B' | 'A'>('all');

  // Filter threads by search query & AI classification filter
  const filteredThreads = threads.filter((t) => {
    const query = searchQuery.toLowerCase();
    const matchesLead = t.lead
      ? `${t.lead.firstName} ${t.lead.lastName} ${t.lead.company}`.toLowerCase().includes(query)
      : false;
    const matchesSubject = t.subject.toLowerCase().includes(query);
    const matchesBody = t.messages.some((m) => m.body?.toLowerCase().includes(query));
    const matchesQuery = query === '' || matchesLead || matchesSubject || matchesBody;

    if (!matchesQuery) return false;

    if (classFilter === 'all') return true;
    if (classFilter === 'needs_attention') {
      return (
        t.lead?.operatingState === 'human_attention' ||
        t.messages.some((m) => m.replyClass === 'C' || m.replyClass === 'D')
      );
    }
    return t.messages.some((m) => m.replyClass === classFilter);
  });

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-bg-main">
      {/* Search Header */}
      <div className="h-14 border-b border-card-border bg-card-bg px-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold text-text-primary">Unified Inbox</h1>
          <span className="text-xs bg-brand-red/10 border border-brand-red/20 text-brand-red px-2 py-0.5 rounded-full uppercase font-bold font-mono">
            Live
          </span>
          {views && views.people.length > 1 && (
            <select
              aria-label="Whose inbox"
              value={inboxOwnerId || views.ownerId}
              onChange={(e) => switchInbox(e.target.value)}
              className="ml-2 bg-bg-main border border-card-border rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-brand-red"
            >
              {views.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {`${p.firstName} ${p.lastName}`.trim()}{p.id === views.ownerId && !inboxOwnerId ? ' (me)' : ''}
                </option>
              ))}
            </select>
          )}
          {views && views.mailboxes.length > 1 && (
            <select
              aria-label="Mailbox"
              value={mailboxFilter}
              onChange={(e) => { setMailboxFilter(e.target.value); setSelectedThread(null); }}
              className="bg-bg-main border border-card-border rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-brand-red"
            >
              <option value="">All mailboxes</option>
              {views.mailboxes.map((m) => (
                <option key={m.id} value={m.id}>{m.email}{m.isActive ? '' : ' (disconnected)'}</option>
              ))}
            </select>
          )}
        </div>
        <div className="relative w-72">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted dark:text-zinc-400" />
          <input
            type="text"
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-xl pl-9 pr-4 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-red/20 focus:border-brand-red font-medium transition-all placeholder:text-text-muted dark:placeholder:text-zinc-500 shadow-2xs"
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* COLUMN 1: Folder Navigation Folders */}
        <div className="w-56 border-r border-card-border bg-card-bg p-3 space-y-4 select-none text-left overflow-y-auto">
          <div className="space-y-1">
            <span className="px-3 text-[10px] font-bold text-text-secondary uppercase tracking-wider block">
              Folders
            </span>
            <button
              onClick={() => { setFolder('inbox'); setClassFilter('all'); }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                folder === 'inbox' && classFilter === 'all'
                  ? 'bg-brand-red/10 text-brand-red font-bold'
                  : 'text-text-secondary hover:bg-card-border/30 hover:text-text-primary'
              }`}
            >
              <div className="flex items-center gap-2">
                <Inbox className="w-4 h-4" />
                <span>Inbox</span>
              </div>
              {threads.filter((t) => !t.isRead && t.folder === 'inbox').length > 0 && (
                <span className="px-1.5 py-0.5 bg-brand-red text-white text-xs font-bold rounded-full font-mono">
                  {threads.filter((t) => !t.isRead && t.folder === 'inbox').length}
                </span>
              )}
            </button>

            <button
              onClick={() => setFolder('sent')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                folder === 'sent'
                  ? 'bg-brand-red/10 text-brand-red font-bold'
                  : 'text-text-secondary hover:bg-card-border/30 hover:text-text-primary'
              }`}
            >
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4" />
                <span>Sent</span>
              </div>
            </button>

            <button
              onClick={() => setFolder('spam')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                folder === 'spam'
                  ? 'bg-brand-red/10 text-brand-red font-bold'
                  : 'text-text-secondary hover:bg-card-border/30 hover:text-text-primary'
              }`}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                <span>Spam</span>
              </div>
            </button>

            <button
              onClick={() => setFolder('trash')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                folder === 'trash'
                  ? 'bg-brand-red/10 text-brand-red font-bold'
                  : 'text-text-secondary hover:bg-card-border/30 hover:text-text-primary'
              }`}
            >
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                <span>Trash</span>
              </div>
            </button>
          </div>

          {/* AI Reply Queues */}
          {folder === 'inbox' && (
            <div className="space-y-1 pt-2 border-t border-card-border">
              <span className="px-3 text-[10px] font-bold text-text-secondary uppercase tracking-wider block">
                AI Reply Queues
              </span>

              <button
                onClick={() => setClassFilter('needs_attention')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  classFilter === 'needs_attention'
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold border border-amber-500/40'
                    : 'text-text-secondary hover:bg-card-border/30 hover:text-text-primary'
                }`}
              >
                <span>Needs Attention</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-500/20 rounded text-amber-800 dark:text-amber-300 font-bold">
                  {threads.filter((t) => t.lead?.operatingState === 'human_attention' || t.messages.some((m) => m.replyClass === 'C' || m.replyClass === 'D')).length}
                </span>
              </button>

              <button
                onClick={() => setClassFilter('C')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  classFilter === 'C'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-500/40'
                    : 'text-text-secondary hover:bg-card-border/30 hover:text-text-primary'
                }`}
              >
                <span>Sales Engagement (Class C)</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-emerald-500/20 rounded text-emerald-800 dark:text-emerald-300 font-bold">
                  {threads.filter((t) => t.messages.some((m) => m.replyClass === 'C')).length}
                </span>
              </button>

              <button
                onClick={() => setClassFilter('D')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  classFilter === 'D'
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold border border-amber-500/40'
                    : 'text-text-secondary hover:bg-card-border/30 hover:text-text-primary'
                }`}
              >
                <span>Review Required (Class D)</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-500/20 rounded text-amber-800 dark:text-amber-300 font-bold">
                  {threads.filter((t) => t.messages.some((m) => m.replyClass === 'D')).length}
                </span>
              </button>

              <button
                onClick={() => setClassFilter('B')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  classFilter === 'B'
                    ? 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 font-bold border border-zinc-500/40'
                    : 'text-text-secondary hover:bg-card-border/30 hover:text-text-primary'
                }`}
              >
                <span>Admin / OOO (Class B)</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-zinc-500/20 rounded text-zinc-700 dark:text-zinc-300 font-bold">
                  {threads.filter((t) => t.messages.some((m) => m.replyClass === 'B')).length}
                </span>
              </button>

              <button
                onClick={() => setClassFilter('A')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  classFilter === 'A'
                    ? 'bg-red-500/15 text-red-700 dark:text-red-300 font-bold border border-red-500/40'
                    : 'text-text-secondary hover:bg-card-border/30 hover:text-text-primary'
                }`}
              >
                <span>Opt-Out / Stop (Class A)</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-red-500/20 rounded text-red-700 dark:text-red-300 font-bold">
                  {threads.filter((t) => t.messages.some((m) => m.replyClass === 'A')).length}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* COLUMN 2: Message Thread List */}
        <div className="w-80 border-r border-card-border bg-card-bg flex flex-col overflow-y-auto">
          {windowInfo?.truncated && (
            <div
              role="status"
              className="px-3 py-2 text-[10px] leading-relaxed text-text-secondary bg-bg-main/60 border-b border-card-border/40"
            >
              Showing threads from the {windowInfo.size} most recent messages in each direction. Older
              mail is not listed here.
            </div>
          )}
          {loading && threads.length === 0 ? (
            <div className="flex-1 flex justify-center items-center">
              <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="flex-1 flex flex-col justify-center items-center p-8 text-center text-text-muted space-y-1">
              <span className="text-2xl">📥</span>
              <p className="text-xs font-semibold">No messages in this folder.</p>
              <p className="text-[10px] text-text-muted">All caught up!</p>
            </div>
          ) : (
            <div className="divide-y divide-card-border">
              {filteredThreads.map((thread) => {
                const isSelected = selectedThread?.id === thread.id;
                const latestMsg = thread.messages[thread.messages.length - 1];
                return (
                  <div
                    key={thread.id}
                    onClick={() => setSelectedThread(thread)}
                    className={`p-3.5 cursor-pointer text-left transition-all relative border-l-2 ${
                      isSelected
                        ? 'bg-brand-red/10 border-brand-red'
                        : 'hover:bg-bg-main/60 border-transparent'
                    }`}
                  >
                    {/* Unread dot indicator */}
                    {!thread.isRead && (
                      <span className="absolute right-3.5 top-4 w-2 h-2 rounded-full bg-brand-red" />
                    )}

                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between items-start pr-4">
                        <span className={`font-semibold truncate max-w-[130px] ${!thread.isRead ? 'text-text-primary font-bold' : 'text-text-secondary'}`}>
                          {thread.lead ? `${thread.lead.firstName} ${thread.lead.lastName}` : latestMsg?.fromName || latestMsg?.fromEmail}
                        </span>
                        <span className="text-xs text-text-muted font-mono whitespace-nowrap">
                          {new Date(thread.latestMessageAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className={`truncate font-medium text-text-primary ${!thread.isRead ? 'font-bold' : ''}`}>
                        {thread.subject}
                      </p>
                      <p className="text-text-muted truncate text-xs pr-2">
                        {bodySnippet(latestMsg?.body, 200) || '(Empty email body)'}
                      </p>
                      {thread.lead && (
                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                          <span className="text-[10px] font-semibold text-brand-orange-text border border-brand-orange/20 bg-brand-orange/10 px-1.5 py-0.5 rounded font-mono">
                            {thread.lead.company}
                          </span>
                          {thread.lead.operatingState === 'human_attention' && (
                            <span className="text-[9px] font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                              Needs Attention
                            </span>
                          )}
                          {thread.lead.operatingState === 'ai_managed' && (
                            <span className="text-[9px] font-bold text-blue-500 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">
                              AI Managing
                            </span>
                          )}
                          {thread.lead.operatingState === 'waiting_for_prospect' && (
                            <span className="text-[9px] font-bold text-text-muted bg-card-border/30 border border-card-border px-1.5 py-0.5 rounded">
                              Waiting
                            </span>
                          )}
                          {latestMsg?.replyClass === 'A' && (
                            <span className="text-[9px] font-bold text-red-500 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded font-mono">
                              Class A · Opt-Out
                            </span>
                          )}
                          {latestMsg?.replyClass === 'B' && (
                            <span className="text-[9px] font-bold text-gray-400 bg-gray-500/10 border border-gray-500/20 px-1.5 py-0.5 rounded font-mono">
                              Class B · Admin
                            </span>
                          )}
                          {latestMsg?.replyClass === 'C' && (
                            <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded font-mono">
                              Class C · Sales
                            </span>
                          )}
                          {latestMsg?.replyClass === 'D' && (
                            <span className="text-[9px] font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded font-mono">
                              Class D · Review
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* COLUMN 3: Reading Pane & Reply Composer */}
        <div className="flex-1 bg-card-bg flex flex-col overflow-hidden">
          {selectedThread ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Toolbar */}
              <div className="h-12 border-b border-card-border px-5 flex items-center justify-between bg-bg-main">
                <div className="flex items-center gap-1">
                  {folder !== 'trash' && (
                    <button
                      onClick={() => handleBulkAction('trash', selectedThread)}
                      className="p-1.5 hover:bg-card-border/50 text-text-muted hover:text-brand-red rounded transition-colors"
                      title="Move to Trash"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  {folder !== 'spam' && (
                    <button
                      onClick={() => handleBulkAction('spam', selectedThread)}
                      className="p-1.5 hover:bg-card-border/50 text-text-muted hover:text-brand-orange-text rounded transition-colors"
                      title="Mark as Spam"
                    >
                      <AlertTriangle className="w-4 h-4" />
                    </button>
                  )}
                  {!selectedThread.isRead ? (
                    <button
                      onClick={() => handleBulkAction('read', selectedThread)}
                      className="p-1.5 hover:bg-card-border/50 text-text-muted hover:text-text-primary rounded transition-colors"
                      title="Mark as Read"
                    >
                      <CheckCircle className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleBulkAction('unread', selectedThread)}
                      className="p-1.5 hover:bg-card-border/50 text-text-muted hover:text-text-primary rounded transition-colors"
                      title="Mark as Unread"
                    >
                      <Mail className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {selectedThread.lead && (
                  <button
                    type="button"
                    onClick={() => openLeadSlideOver(router, selectedThread.lead!.id)}
                    className="text-[10px] font-bold text-brand-red hover:underline uppercase"
                  >
                    View Lead Profile →
                  </button>
                )}
              </div>

              {/* Thread Messages Timeline */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-bg-main/40 text-left">
                <div className="pb-3 border-b border-card-border">
                  <h2 className="text-sm font-bold text-text-primary">{selectedThread.subject}</h2>
                </div>

                <div className="space-y-4">
                  {selectedThread.messages.map((msg) => {
                    const isOutbound = msg.type === 'outbound';
                    return (
                      <div
                        key={msg.id}
                        className={`p-4 border rounded-2xl shadow-sm max-w-2xl text-xs space-y-3 ${
                          isOutbound
                            ? 'bg-card-bg border-card-border ml-auto text-right'
                            : 'bg-card-bg border-card-border'
                        }`}
                      >
                        <div className={`flex justify-between items-start gap-4 ${isOutbound ? 'flex-row-reverse text-right' : ''}`}>
                          <div className="min-w-0">
                            <p className="font-bold text-text-primary truncate">
                              {isOutbound ? 'Me' : msg.fromName || msg.fromEmail}
                            </p>
                            <p className="text-[10px] text-text-muted truncate mt-0.5">
                              {isOutbound ? `To: ${msg.to}` : `From: ${msg.fromEmail}`}
                            </p>
                          </div>
                          <span className="text-[9px] text-text-muted font-mono whitespace-nowrap">
                            {new Date(msg.date).toLocaleString()}
                          </span>
                        </div>

                        {/* Where an outgoing message stands, and why it did not go */}
                        {isOutbound && (() => {
                          // The server already put the reason in plain words (deliveryError); the label and tone come from the status.
                          const base = describeDelivery(msg.deliveryStatus, null, msg.scheduledFor);
                          if (!base) return null;
                          const shown = { ...base, detail: msg.deliveryError ?? base.detail };
                          const tone =
                            shown.tone === 'ok'
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                              : shown.tone === 'bad'
                                ? 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30'
                                : shown.tone === 'warn'
                                  ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30'
                                  : 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/30';
                          return (
                            <div role="status" className="flex flex-col items-end gap-1">
                              <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${tone}`}>{shown.label}</span>
                              {shown.detail && <span className="text-[11px] text-text-secondary leading-snug">{shown.detail}</span>}
                            </div>
                          );
                        })()}

                        {isOutbound && msg.canManageSchedule && msg.deliveryStatus === 'pending' && (
                          msg.scheduledFor ? (
                            <ScheduledEmailActions
                              outboundMessageId={msg.id}
                              scheduledFor={msg.scheduledFor}
                              leadTimezone={null}
                              onChanged={(change) => {
                                if (change.kind === 'cancelled') {
                                  const drop = (t: Thread): Thread => ({ ...t, messages: t.messages.filter((m) => m.id !== msg.id) });
                                  setThreads((prev) => prev.map(drop));
                                  setSelectedThread((prev) => (prev ? drop(prev) : prev));
                                } else {
                                  const move = (t: Thread): Thread => ({ ...t, messages: t.messages.map((m) => (m.id === msg.id ? { ...m, scheduledFor: change.scheduledFor } : m)) });
                                  setThreads((prev) => prev.map(move));
                                  setSelectedThread((prev) => (prev ? move(prev) : prev));
                                }
                              }}
                            />
                          ) : (
                            <button type="button" onClick={() => void takeBack(msg)} className="self-end rounded-lg border border-card-border px-2 py-1 text-xs font-semibold text-brand-orange-text hover:bg-card-border/30">
                              Undo send
                            </button>
                          )
                        )}

                        {/* AI Reply Classification Banner */}
                        {!isOutbound && msg.replyClass && (
                          <div className="p-3.5 rounded-xl border text-xs space-y-2 text-left bg-card-bg dark:bg-zinc-900 border-card-border dark:border-zinc-700/80 shadow-2xs">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold text-[10px] text-text-secondary uppercase">AI Classification:</span>
                                {msg.replyClass === 'A' && (
                                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/30 font-mono">
                                    Class A · Opt-Out / Stop
                                  </span>
                                )}
                                {msg.replyClass === 'B' && (
                                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border border-zinc-500/30 font-mono">
                                    Class B · Administrative (OOO)
                                  </span>
                                )}
                                {msg.replyClass === 'C' && (
                                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-mono">
                                    Class C · Sales Engagement
                                  </span>
                                )}
                                {msg.replyClass === 'D' && (
                                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/30 font-mono">
                                    Class D · Human Review Required
                                  </span>
                                )}
                              </div>
                              {selectedThread.lead && (msg.replyClass === 'C' || msg.replyClass === 'D') && (
                                <button
                                  type="button"
                                  onClick={() => router.push(`/ai?leadId=${selectedThread.lead!.id}`)}
                                  className="text-[10px] font-bold text-brand-red hover:underline flex items-center gap-1 ml-auto bg-brand-red/10 px-2 py-0.5 rounded-lg border border-brand-red/20 cursor-pointer"
                                >
                                  <span>{msg.replyClass === 'C' ? 'Review Handoff Workspace' : 'Review Prospect Workspace'}</span>
                                  <span>→</span>
                                </button>
                              )}
                            </div>

                            {/* Class-specific operational guidance */}
                            {msg.replyClass === 'A' && (
                              <p className="text-xs text-red-800 dark:text-red-300 font-medium bg-red-500/10 p-2.5 rounded-lg border border-red-500/20 leading-relaxed">
                                ✋ <strong>Opt-out / Stop:</strong> Autonomous outreach stopped. Prospect suppressed from sequence. No SDR task required.
                              </p>
                            )}
                            {msg.replyClass === 'B' && (
                              <p className="text-xs text-zinc-800 dark:text-zinc-300 font-medium bg-zinc-500/10 p-2.5 rounded-lg border border-zinc-500/20 leading-relaxed">
                                ⏸ <strong>Administrative (OOO):</strong> Follow-up paused. Does not count as sales engagement. Cadence will resume when return period expires.
                              </p>
                            )}
                            {msg.replyClass === 'C' && (
                              <p className="text-xs text-emerald-800 dark:text-emerald-300 font-medium bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/20 leading-relaxed">
                                🎯 <strong>Sales Engagement:</strong> AI outreach stopped. Prospect transferred to SDR for human-managed follow-up.
                              </p>
                            )}
                            {msg.replyClass === 'D' && (
                              <p className="text-xs text-amber-900 dark:text-amber-300 font-medium bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20 leading-relaxed">
                                🔍 <strong>Human Review Required:</strong> Classification intent uncertain. Inspect prospect context before resuming outreach.
                              </p>
                            )}

                            {(msg.replyKind || msg.classificationSource) && (
                              <p className="text-[10px] text-text-secondary leading-snug font-mono">
                                {msg.replyKind ? `Kind: ${msg.replyKind}` : ''} {msg.classificationSource ? `· Source: ${msg.classificationSource}` : ''} {msg.replyConfidence != null ? `· Confidence: ${Math.round(msg.replyConfidence * 100)}%` : ''}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Email Body Content — inbound HTML is attacker-controlled, sanitize before render */}
                        {msg.bodyHtml ? (
                          <div
                            className={`text-xs text-text-primary leading-relaxed font-sans select-text border-t border-card-border/40 pt-3 text-left ql-editor`}
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(msg.bodyHtml) }}
                          />
                        ) : (
                          <div className="text-xs text-text-primary whitespace-pre-wrap leading-relaxed font-sans border-t border-card-border/40 pt-3 text-left select-text">
                            {bodyToText(msg.body) || '(Empty email body)'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* AI 1-Click Draft Copilot Banner */}
              {selectedThread.lead && (
                <div className="border-t border-card-border/60 bg-gradient-to-r from-brand-red/5 via-orange-500/5 to-amber-500/5 p-3 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="p-1.5 rounded-lg bg-brand-red/10 text-brand-red">
                        <Sparkles className="w-4 h-4" />
                      </span>
                      <div>
                        <p className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                          <span>AI Reply Copilot</span>
                          {aiDraftResult?.intentLabel && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-card-bg border border-card-border shadow-xs text-text-secondary">
                              {aiDraftResult.intentLabel} ({Math.round((aiDraftResult.confidence || 0.9) * 100)}%)
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-text-muted">
                          {aiDraftResult?.summary || 'Analyze prospect reply and generate 3 calibrated response strategies.'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleGenerateAiDrafts}
                        disabled={aiDraftsLoading}
                        className="px-3 py-1 bg-brand-red hover:bg-brand-red-hover text-white text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                      >
                        {aiDraftsLoading ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Drafting...</span>
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-3.5 h-3.5" />
                            <span>{aiDraftResult ? 'Regenerate Drafts' : 'Generate 1-Click Drafts'}</span>
                          </>
                        )}
                      </button>

                      {aiDraftResult && (
                        <button
                          type="button"
                          onClick={() => setShowAiDrafts(!showAiDrafts)}
                          className="p-1 text-text-muted hover:text-text-primary rounded"
                        >
                          {showAiDrafts ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* An unsubscribe or out-of-office gets advice, not a pitch. */}
                  {showAiDrafts && aiDraftResult?.guidance && (
                    <p className="mt-3 pt-2 border-t border-card-border/40 text-[12px] text-text-secondary" role="status">
                      {aiDraftResult.summary ? `${aiDraftResult.summary} ` : ''}
                      {aiDraftResult.guidance}
                    </p>
                  )}

                  {/* Render 3 Calibrated Draft Options */}
                  {showAiDrafts && aiDraftResult?.drafts && aiDraftResult.drafts.length > 0 && (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-2 border-t border-card-border/40">
                      {aiDraftResult.drafts.map((d: any) => (
                        <div
                          key={d.id}
                          className="bg-card-bg border border-card-border hover:border-brand-red/40 rounded-xl p-3 space-y-2 shadow-xs transition-all flex flex-col justify-between"
                        >
                          <div className="space-y-1">
                            <p className="text-xs font-bold text-text-primary">{d.title}</p>
                            <p className="text-[10px] text-text-muted leading-tight">{d.strategy}</p>
                            <div className="bg-bg-main/60 p-2 rounded-lg text-[11px] text-text-secondary whitespace-pre-wrap leading-relaxed max-h-24 overflow-y-auto border border-card-border/30 text-left">
                              {d.body}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleApplyAiDraft(d.body)}
                            className="w-full py-1 text-[10px] font-bold text-brand-red bg-brand-red/5 hover:bg-brand-red/10 border border-brand-red/20 rounded-lg transition-colors text-center"
                          >
                            Insert into Composer →
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Reply Composer Editor */}
              {selectedThread.lead ? (
                <form
                  onSubmit={handleSendReply}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.requestSubmit(); }
                  }}
                  className="border-t border-card-border p-4 bg-card-bg space-y-3"
                >
                  {/* Smart Quick Reply Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 pb-1">
                    <span className="text-[10px] text-text-secondary font-bold font-mono mr-1">QUICK REPLIES:</span>
                    {/* Neutral openers only: no links, no attachments, no claims about the company. The
                        rep fills in the substance. */}
                    <button
                      type="button"
                      onClick={() => handleApplyAiDraft(`Hi ${selectedThread.lead?.firstName || 'there'},\n\nThanks for getting back to me. `)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/30 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Thank them
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyAiDraft(`Hi ${selectedThread.lead?.firstName || 'there'},\n\nWould you have 15 minutes for a quick call this week? Let me know a day and time that suits you.`)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Ask for a call
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyAiDraft(`Hi ${selectedThread.lead?.firstName || 'there'},\n\nUnderstood, thank you for letting me know.`)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-700 dark:text-zinc-300 border border-zinc-500/30 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Acknowledge
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-left">
                    <span className="text-[10px] font-bold text-text-muted uppercase flex items-center gap-1">
                      <Reply className="w-3.5 h-3.5" />
                      <span>Reply to {selectedThread.lead.firstName}</span>
                    </span>
                    {!showReplyCopies && (
                      <button type="button" onClick={() => setShowReplyCopies(true)} className="text-xs font-semibold text-brand-orange-text hover:underline focus-ring rounded">
                        Cc / Bcc
                      </button>
                    )}
                  </div>

                  {replyMailbox?.sendPausedAt && (
                    <p role="status" className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-text-secondary">
                      Sending is paused for <strong>{replyMailbox.email}</strong>{replyMailbox.sendPauseReason ? ` - ${replyMailbox.sendPauseReason}` : ''}. A manager can resume it under Email Health.
                    </p>
                  )}

                  {(showReplyCopies || replyCc.length > 0 || replyBcc.length > 0) && (
                    <div className="space-y-1.5">
                      <RecipientField id="reply-cc" label="Cc" value={replyCc} onChange={setReplyCc} />
                      <RecipientField id="reply-bcc" label="Bcc" value={replyBcc} onChange={setReplyBcc} exclude={replyCc} />
                    </div>
                  )}

                  <ComposeEditor
                    value={replyBody}
                    onChange={setReplyBody}
                    ariaLabel="Reply"
                    placeholder="Type your reply here..."
                    heightClass="min-h-[5rem] max-h-44"
                    compact
                    snippets={replySnippets}
                    onCreateSnippet={(html) => void saveReplySnippet(html)}
                  />

                  {replyMailbox && <SignatureBlock html={replyMailbox.signaturePreview} mailboxEmail={replyMailbox.email} />}
                  <AttachmentBar attachments={replyAttachments} onChange={setReplyAttachments} disabled={sendingReply} />

                  <div className="flex items-center justify-end gap-2">
                    <ScheduleMenu value={replyScheduleAt} onChange={setReplyScheduleAt} leadTimezone={null} disabled={sendingReply} />
                    <button
                      type="submit"
                      disabled={sendingReply || isHtmlBlank(replyBody) || Boolean(replyMailbox?.sendPausedAt)}
                      className="px-4 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-60 shadow-sm"
                    >
                      {sendingReply ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Sending...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5" />
                          <span>{replyScheduleAt ? 'Schedule Reply' : 'Send Reply'}</span>
                          <span className="hidden text-xs font-normal opacity-80 xl:inline">Ctrl+Enter</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="border-t border-card-border p-4 bg-card-bg text-center text-xs text-text-muted italic">
                  Cannot reply: Thread is not linked to an active CRM lead.
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-center items-center text-text-muted space-y-2 p-8">
              <span className="text-3xl">📭</span>
              <p className="text-xs font-semibold">No Conversation Selected</p>
              <p className="text-xs text-text-muted">Select a thread from the list to view the full dialogue history.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
