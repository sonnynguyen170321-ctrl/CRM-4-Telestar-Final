'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useAppContext } from '@/context/AppContext';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { X, Send, Copy, ThumbsUp, ThumbsDown, ChevronDown, Sparkles } from 'lucide-react';
import { MODEL_LABELS, MODEL_DESCRIPTIONS, DEFAULT_MODEL, SELECTABLE_MODEL_IDS, isKnownModelId } from '@/lib/ai/models';
import type { ModelId } from '@/lib/ai/models';
import { resolveTurnExecutionId, type FailedTurn } from '@/lib/ai/executionId';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  feedback?: 'up' | 'down';
  executionId?: string;
}

/**
 * Auto first, then the three approved models.
 *
 * The picker used to be built from every key in `MODEL_LABELS`, which is how it went on
 * offering three withdrawn Groq models long after they stopped answering. Listing Auto first
 * and defaulting to it means the normal SDR never has to know which provider is healthy.
 */
const MODELS: ModelId[] = ['auto', ...SELECTABLE_MODEL_IDS];

const MEMORY_TRIGGERS = [
  'remember', 'i prefer', 'always', 'never again', 'my client', 'my campaign',
  "don't forget", 'keep in mind', 'note that', 'your name is', 'call you',
];

function detectMemoryIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return MEMORY_TRIGGERS.some((t) => lower.includes(t));
}

/** Carries the status code so the copy below can distinguish a session drop from an outage. */
class HttpError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

/**
 * What the SDR reads when the request itself failed.
 *
 * A status code is not an explanation, and "Sorry, I hit an issue: HTTP 401" tells the reader
 * nothing they can act on. Each case here maps to something they can actually do next.
 */
function messageForRequestError(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) {
      return 'Your session expired. Refresh the page and sign in again.';
    }
    if (err.status === 413) {
      return 'This conversation has gotten too long. Start a new chat and I will pick it up from there.';
    }
    if (err.status === 400) {
      return "I couldn't read that message. Try rephrasing it.";
    }
    if (err.status === 429) {
      return 'Telestar AI is temporarily at capacity. Try that again shortly.';
    }
    return 'Telestar AI is temporarily unavailable. The rest of the CRM is still working.';
  }
  // A network drop, an aborted request, or the tab going offline all land here.
  return "I couldn't reach Telestar AI. Check your connection and try that again.";
}

function getContextChips(page: string, hasLead: boolean): string[] {
  if (hasLead) return ['Best angle for this lead', 'Research this company', 'Prep me for a call', 'Write an opener'];
  if (page === '/') return ['Morning brief', 'What to focus on?', 'Summarize my day', 'Teach me SPIN'];
  if (page === '/templates') return ['Write a cold email', 'Improve this subject line', 'LinkedIn message', 'Break-up email'];
  if (page === '/leads') return ['Research a lead', 'Handle objection', 'Best angle for a prospect', 'After no reply'];
  return ['Cold email opener', 'Handle objection', 'After no reply', 'Book a meeting'];
}

function CopilotIcon({ hasUnread, isThinking }: { hasUnread: boolean; isThinking: boolean }) {
  return (
    <div className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-brand-red to-brand-orange text-white shadow-sm">
      <Sparkles className={`w-4 h-4 ${isThinking ? 'animate-spin' : ''}`} />
      {hasUnread && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 border-2 border-zinc-950" />
      )}
    </div>
  );
}

export default function AiAssistant() {
  const { currentUserId, currentUser, currentRole, isSessionLoading } = useAppContext();
  const pathname = usePathname();
  const isDesktop = useIsDesktop();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [modelId, setModelId] = useState<ModelId>(DEFAULT_MODEL);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [feedbackPendingIdx, setFeedbackPendingIdx] = useState<number | null>(null);
  const [assistantName, setAssistantName] = useState('AI SDR Assistant');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  // Prevents React StrictMode from double-firing the memory fetch in dev
  const memoryFetchedRef = useRef(false);
  /** The turn that failed mid-stream, so resending the same message retries it rather than duplicating it. */
  const failedTurnRef = useRef<FailedTurn | null>(null);

  const firstName = currentUser?.firstName || 'there';

  function bustMemCache() {
    try { sessionStorage.removeItem(`ai_mem_${currentUserId || 'anon'}`); } catch { /* ignore */ }
  }

  const getCrmContext = useCallback(() => {
    const w = typeof window !== 'undefined' ? (window as unknown as Record<string, Record<string, unknown> | null>) : null;
    const leadCtx = w?.__crm_lead_context ?? null;
    const sdrStats = w?.__crm_sdr_stats ?? null;
    return {
      page: pathname,
      userName: firstName,
      userRole: currentRole,
      ...(sdrStats || {}),
      ...(leadCtx || {}),
    };
  }, [pathname, firstName, currentRole]);

  // Load memories and preferred model on mount
  useEffect(() => {
    if (!currentUserId || pathname === '/login') return;
    if (memoryFetchedRef.current) return;
    memoryFetchedRef.current = true;

    const cacheKey = `ai_mem_${currentUserId}`;

    function applyMemories(mems: string[]) {
      const nameMem = mems.find((m) => m.startsWith('assistant_name: '));
      if (nameMem) setAssistantName(nameMem.replace('assistant_name: ', ''));

      const modelMem = mems.find((m) => m.startsWith('preferred_model: '));
      if (modelMem) {
        // A stored preference for a model this build no longer recognises is ignored rather
        // than sent. That is how `llama-3.3-70b-versatile` outlived its own withdrawal: it sat
        // in a memory row and was replayed into every request.
        const saved = modelMem.replace('preferred_model: ', '');
        if (isKnownModelId(saved)) setModelId(saved);
      }
    }

    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        applyMemories(JSON.parse(cached));
        return;
      }
    } catch { /* sessionStorage unavailable */ }

    fetch('/api/ai/memory')
      .then((r) => (r.ok ? r.json() : []))
      .then((mems: unknown) => {
        const list = Array.isArray(mems) ? (mems as string[]) : [];
        try { sessionStorage.setItem(cacheKey, JSON.stringify(list)); } catch { /* ignore */ }
        applyMemories(list);
      })
      .catch(() => {});
  }, [currentUserId, pathname]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close model menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setShowModelMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ⌘J / Ctrl+J global keyboard shortcut to toggle Copilot
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Morning briefing — fires once per day on first open
  const fireMorningBriefing = useCallback(async () => {
    const today = new Date().toISOString().split('T')[0];
    const key = `ai_briefing_${today}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');

    try {
      const res = await fetch('/api/ai/briefing?type=morning');
      if (!res.ok) return;
      const data = await res.json();

      const lines: string[] = [`Good morning, ${firstName}! Here's your day at a glance:`];

      if (data.overdueTasks > 0) {
        lines.push(`\n⚠️ **${data.overdueTasks} overdue task${data.overdueTasks > 1 ? 's' : ''}** — tackle these first.`);
      }

      if (data.todayTaskCount > 0) {
        const channelBreakdown = Object.entries(data.todayTasksByChannel as Record<string, number>)
          .map(([ch, n]) => `${n} ${ch}`)
          .join(', ');
        lines.push(`\n📋 **${data.todayTaskCount} tasks due today** (${channelBreakdown})`);
      } else {
        lines.push(`\n✅ No tasks due today — great time to prospect or enroll leads in sequences.`);
      }

      if (data.staleLeads > 0) {
        lines.push(`\n🕐 **${data.staleLeads} leads untouched for 7+ days** — they're going cold.`);
      }

      if (data.recentReplies?.length > 0) {
        const names = (data.recentReplies as Array<{ firstName: string; lastName: string; company: string }>)
          .map((l) => `${l.firstName} ${l.lastName} at ${l.company}`)
          .join(', ');
        lines.push(`\n🔥 **Hot leads who replied recently:** ${names}`);
      }

      if (data.hotLeads?.length > 0) {
        lines.push(`\n→ I'd start with these leads first — they have the highest conversion potential.`);
      }

      lines.push(`\nWhat do you want to tackle first?`);

      setMessages([{ role: 'assistant', content: lines.join('') }]);
    } catch {
      // silently skip if briefing fails
    }
  }, [firstName]);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
    setHasUnread(false);

    if (messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content: `Hey ${firstName}! 👋 I'm your Telestar AI Assistant. I'm connected with live context on your leads, campaigns, and sequence tasks.\n\nHow can I help you today?`,
        },
      ]);
      fireMorningBriefing();
    }

    setTimeout(() => inputRef.current?.focus(), 100);
  }, [messages.length, firstName, fireMorningBriefing]);

  useEffect(() => {
    const handleCustomOpen = (e: any) => {
      setIsOpen(true);
      if (e?.detail?.action === 'briefing') {
        setTimeout(() => {
          sendMessage('Give me my 8:30 AM Daily Morning Briefing on top priority leads, tasks due today, and recommended messaging angles.');
        }, 150);
      }
    };
    window.addEventListener('telestar:open-ai-assistant', handleCustomOpen);
    return () => window.removeEventListener('telestar:open-ai-assistant', handleCustomOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendMessage(text?: string) {
    const content = (text || input).trim();
    if (!content || isStreaming) return;
    setInput('');

    // Detect reset commands
    const lower = content.toLowerCase();
    if (lower.includes('reset my context') || lower.includes('clear memory')) {
      await fetch('/api/ai/memory', { method: 'DELETE' });
      bustMemCache();
      memoryFetchedRef.current = false;
      const resetMsg = { role: 'assistant' as const, content: `Memory cleared. How can I help you today?` };
      setMessages((prev) => [...prev, { role: 'user', content }, resetMsg]);
      return;
    }

    // One id per logical turn, minted here rather than inside the fetch: a retry of the
    // same message must reuse it, and anything generated per network attempt cannot.
    const executionId = resolveTurnExecutionId(content, failedTurnRef.current);
    const userMsg: Message = { role: 'user', content, executionId };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    // Auto-save memory if detected
    if (detectMemoryIntent(content)) {
      fetch('/api/ai/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memory: content }),
      }).then(() => bustMemCache()).catch(() => {});
    }

    // Handle EOD summary trigger
    const isEodRequest = /summarize my day|end of day|what did i do today|eod report|daily summary/i.test(content);
    let injectedContext = getCrmContext();

    if (isEodRequest) {
      try {
        const eodRes = await fetch('/api/ai/briefing?type=eod');
        if (eodRes.ok) {
          const eodData = await eodRes.json();
          injectedContext = { ...injectedContext, eodData: JSON.stringify(eodData) } as typeof injectedContext;
        }
      } catch {}
    }

    setIsStreaming(true);
    let assistantContent = '';
    const assistantIdx = newMessages.length;

    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          modelId,
          context: injectedContext,
          executionId,
        }),
      });

      if (!res.ok) throw new HttpError(res.status);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No stream');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        assistantContent = `${assistantContent}${chunk}`;
        const currentText = assistantContent;
        setMessages((prev) => {
          const updated = [...prev];
          updated[assistantIdx] = { role: 'assistant', content: currentText };
          return updated;
        });
      }

      // A 200 that streamed nothing still leaves an empty bubble and a stuck-looking panel.
      // Say something, and treat the turn as failed so resending it retries rather than
      // duplicating.
      if (assistantContent.trim().length === 0) {
        failedTurnRef.current = { content, executionId };
        setMessages((prev) => {
          const updated = [...prev];
          updated[assistantIdx] = {
            role: 'assistant',
            content: "I couldn't finish that response. Try that again.",
          };
          return updated;
        });
        return;
      }

      // The turn completed, so a later message with the same text is a new turn, not a retry.
      failedTurnRef.current = null;
    } catch (err) {
      // Keep the namespace so resending the same message retries this turn.
      failedTurnRef.current = { content, executionId };
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIdx] = { role: 'assistant', content: messageForRequestError(err) };
        return updated;
      });
    } finally {
      // Always clears, on every path — a stuck `true` here disables the input and the send
      // button permanently, which reads as the whole assistant being broken.
      setIsStreaming(false);
      // The textarea was disabled while streaming, so the browser moved focus off it. Putting
      // it back is what lets a failed turn be retried by typing, without reaching for the mouse.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  async function handleModelChange(id: ModelId) {
    setModelId(id);
    setShowModelMenu(false);
    await fetch('/api/ai/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memory: `preferred_model: ${id}` }),
    }).then(() => bustMemCache()).catch(() => {});
  }

  async function handleFeedback(idx: number, type: 'up' | 'down') {
    const msg = messages[idx];
    if (!msg || msg.feedback) return;

    if (type === 'down') {
      setFeedbackPendingIdx(idx);
      return;
    }

    setMessages((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], feedback: type };
      return updated;
    });
  }

  async function handleFeedbackReason(idx: number, reason: string) {
    const msg = messages[idx];
    setFeedbackPendingIdx(null);
    setMessages((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], feedback: 'down' };
      return updated;
    });
    await fetch('/api/ai/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memory: `feedback: response not helpful (${reason}) — context: "${msg.content.slice(0, 100)}"` }),
    }).then(() => bustMemCache()).catch(() => {});
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const hasLead = typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).__crm_lead_context;
  const chips = getContextChips(pathname, hasLead);

  if (isSessionLoading || !currentUserId || pathname === '/login' || !isDesktop) return null;

  return (
    <>
      {/* Global CSS for robot animations */}
      <style>{`
        /* No idle float, no bounce, no pulse. Perpetual decorative motion on a
           always-on-screen widget is both an "AI-generated UI" tell and a
           distraction in a tool people stare at all day. State is carried by the
           badge and the antenna colour instead; only hover moves, and only once. */
        .ai-robot-idle { transition: transform 0.16s ease-out; }
        .ai-robot-idle:hover { transform: translateY(-2px); }
        .ai-robot-unread { transition: transform 0.16s ease-out; }
        .ai-robot-thinking { opacity: 0.75; }
        /* Typing indicator: a linear fade, not the springy default bounce. */
        @keyframes aiTypingFade {
          0%, 100% { opacity: 0.25; }
          50% { opacity: 1; }
        }
        .ai-typing-dot { animation: aiTypingFade 1.1s ease-in-out infinite; }
        .ai-chat-panel {
          box-shadow: 0 4px 16px rgba(0,0,0,0.12);
        }
        .ai-message-content { white-space: pre-wrap; word-break: break-word; }
        .ai-message-content strong { font-weight: 600; }
      `}</style>

      {/* Floating trigger button — Linear-grade Copilot trigger */}
      {!isOpen && (
        <button
          onClick={handleOpen}
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-3 py-2 rounded-xl bg-zinc-950/90 dark:bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 shadow-xl hover:border-brand-red/50 hover:shadow-brand-red/10 transition-all duration-150 cursor-pointer group select-none ${hasUnread ? 'ring-2 ring-brand-red ring-offset-2 ring-offset-zinc-950' : ''}`}
          title={`Open ${assistantName} (⌘J)`}
          aria-label={`Open ${assistantName}`}
        >
          <CopilotIcon hasUnread={hasUnread} isThinking={isStreaming} />
          <div className="flex flex-col items-start pr-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white tracking-wide group-hover:text-brand-orange-text transition-colors">
                AI Copilot
              </span>
              <kbd className="text-[10px] font-mono bg-zinc-850 text-zinc-400 px-1 py-0.5 border border-zinc-700/60 rounded">
                ⌘J
              </kbd>
            </div>
            <span className="text-[10px] text-zinc-400 font-medium leading-none">
              {isStreaming ? 'Thinking...' : 'Live Assistant'}
            </span>
          </div>
        </button>
      )}

      {/* Expanded chat panel */}
      {isOpen && (
        <div
          role="dialog"
          aria-label={assistantName}
          onKeyDown={(e) => {
            // Escape closes the panel — but only when a menu is not the thing that should
            // close first, or the SDR loses the whole conversation reaching for the menu.
            if (e.key !== 'Escape') return;
            if (showModelMenu) setShowModelMenu(false);
            else setIsOpen(false);
          }}
          className="ai-chat-panel fixed bottom-6 right-6 z-50 flex flex-col bg-white dark:bg-[#111] border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-2xl"
          style={{ width: 390, height: 560 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#0A0A0A] border-b border-zinc-800">
            <div className="flex items-center gap-2.5">
              <CopilotIcon hasUnread={false} isThinking={isStreaming} />
              <div>
                <div className="text-white font-semibold text-xs leading-tight">{assistantName}</div>
                <div className="text-emerald-400 text-[10px] flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Live Context Connected
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Model selector */}
              <div className="relative" ref={modelMenuRef}>
                <button
                  onClick={() => setShowModelMenu((v) => !v)}
                  className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors px-2 py-1 rounded-md hover:bg-zinc-800"
                  aria-haspopup="menu"
                  aria-expanded={showModelMenu}
                  aria-label={`AI model: ${MODEL_LABELS[modelId]}. Change model`}
                >
                  {MODEL_LABELS[modelId]} <ChevronDown size={12} aria-hidden="true" />
                </button>
                {showModelMenu && (
                  <div
                    role="menu"
                    aria-label="AI model"
                    className="absolute bottom-8 right-0 w-72 bg-[#1A1A1A] border border-zinc-700 rounded-xl shadow-2xl overflow-hidden z-10"
                  >
                    {MODELS.map((id) => (
                      <button
                        key={id}
                        role="menuitemradio"
                        aria-checked={id === modelId}
                        onClick={() => handleModelChange(id)}
                        className={`w-full text-left px-3 py-2.5 hover:bg-zinc-800 transition-colors ${id === modelId ? 'bg-zinc-800' : ''}`}
                      >
                        <div className="text-white text-xs font-medium">{MODEL_LABELS[id]}</div>
                        <div className="text-zinc-500 text-xs mt-0.5 leading-snug">{MODEL_DESCRIPTIONS[id]}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-zinc-400 hover:text-white transition-colors"
                aria-label={`Close ${assistantName}`}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
            style={{ background: '#FAFAFA' }}
            role="log"
            aria-label="Conversation"
            aria-live="polite"
            aria-busy={isStreaming}
          >
            {messages.length === 0 && (
              <div className="text-center text-zinc-600 text-sm mt-4 space-y-3">
                <div className="font-bold text-zinc-800 text-base">👋 Hey {firstName}!</div>
                <div className="text-xs text-zinc-500">I'm your Telestar Sales Copilot. How can I accelerate your outreach today?</div>

                <button
                  type="button"
                  onClick={() => sendMessage('Give me my 8:30 AM Daily Morning Briefing on top priority leads, tasks due today, and recommended messaging angles.')}
                  className="w-full mx-auto max-w-xs p-2.5 rounded-xl bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-brand-red/10 border border-orange-500/20 hover:border-brand-red/40 text-left transition-all shadow-xs flex items-center gap-2.5 group cursor-pointer"
                >
                  <span className="p-1.5 rounded-lg bg-orange-500/20 text-orange-600 group-hover:scale-105 transition-transform text-sm">
                    🌅
                  </span>
                  <div>
                    <p className="text-xs font-bold text-zinc-900 group-hover:text-brand-red transition-colors">Daily Morning Briefing</p>
                    <p className="text-[10px] text-zinc-500">Priority hot leads & cadence tasks due today</p>
                  </div>
                </button>
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] ${msg.role === 'user' ? 'order-1' : 'order-0'}`}>
                  <div
                    className={`rounded-2xl px-3 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-[#D42B1E] text-white rounded-tr-sm'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 rounded-tl-sm'
                    }`}
                  >
                    {msg.role === 'assistant' && isStreaming && idx === messages.length - 1 && msg.content === '' ? (
                      // The dots carry the state visually; the label carries it for a screen
                      // reader and for anyone who cannot distinguish the animation.
                      <span className="flex gap-1 items-center py-0.5" role="status" aria-label="Generating a response">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 ai-typing-dot" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 ai-typing-dot" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 ai-typing-dot" style={{ animationDelay: '300ms' }} />
                      </span>
                    ) : (
                      <span className="ai-message-content" dangerouslySetInnerHTML={{
                        __html: msg.content
                          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                          .replace(/\n/g, '<br/>')
                      }} />
                    )}
                  </div>
                  {/* AI message actions */}
                  {msg.role === 'assistant' && msg.content && !(isStreaming && idx === messages.length - 1) && (
                    <>
                      <div className="flex items-center gap-2 mt-1 px-1">
                        <button
                          onClick={() => copyToClipboard(msg.content)}
                          className="text-zinc-400 hover:text-zinc-600 transition-colors"
                          title="Copy"
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          onClick={() => handleFeedback(idx, 'up')}
                          className={`transition-colors ${msg.feedback === 'up' ? 'text-emerald-500' : 'text-zinc-400 hover:text-emerald-500'}`}
                          title="Helpful"
                        >
                          <ThumbsUp size={12} />
                        </button>
                        <button
                          onClick={() => handleFeedback(idx, 'down')}
                          className={`transition-colors ${msg.feedback === 'down' ? 'text-red-500' : 'text-zinc-400 hover:text-red-500'}`}
                          title="Not helpful"
                        >
                          <ThumbsDown size={12} />
                        </button>
                      </div>
                      {feedbackPendingIdx === idx && (
                        <div className="mt-1.5 px-1 flex flex-wrap gap-1">
                          {['Too generic', 'Not accurate', 'Too long', 'Not relevant'].map((reason) => (
                            <button
                              key={reason}
                              onClick={() => handleFeedbackReason(idx, reason)}
                              className="text-xs px-2 py-0.5 rounded-full border border-red-400/40 text-red-400 hover:bg-red-400/10 transition-colors"
                            >
                              {reason}
                            </button>
                          ))}
                          <button
                            onClick={() => setFeedbackPendingIdx(null)}
                            className="text-xs px-2 py-0.5 rounded-full border border-zinc-600 text-zinc-500 hover:bg-zinc-700/30 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick action chips */}
          <div className="flex gap-2 px-4 pb-2 pt-1 overflow-x-auto" style={{ background: '#FAFAFA' }}>
            {chips.map((chip) => (
              <button
                key={chip}
                onClick={() => sendMessage(chip)}
                disabled={isStreaming}
                className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-[#D42B1E] hover:text-[#D42B1E] transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="px-3 pb-3 pt-1 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111]">
            <div className="flex gap-2 items-end bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 px-3 py-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Ask me anything..."
                rows={1}
                disabled={isStreaming}
                aria-label={`Message ${assistantName}`}
                className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 resize-none border-0 outline-none leading-snug"
                style={{ maxHeight: 80, overflowY: 'auto' }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || isStreaming}
                className="p-1.5 rounded-lg bg-[#D42B1E] text-white disabled:opacity-40 hover:bg-[#B82418] transition-colors flex-shrink-0"
                aria-label="Send"
              >
                <Send size={14} />
              </button>
            </div>
            {/* text-text-muted (#6B7280, 4.83:1), not text-zinc-400 (2.62:1) — this footer
                sits on the panel's bg-white, so the zinc-400 failed WCAG AA. The dark header
                above still uses zinc-400 correctly. */}
            <div className="text-center text-text-muted text-xs mt-1">Enter to send · Shift+Enter for newline</div>
          </div>
        </div>
      )}
    </>
  );
}
