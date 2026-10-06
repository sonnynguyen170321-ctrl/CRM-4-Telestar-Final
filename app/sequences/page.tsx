'use client';

import { SequenceSendersPanel } from '@/components/sequences/SequenceSendersPanel';
import EmailLogTable from '@/components/email/EmailLogTable';
import { SequenceSharingPanel } from '@/components/sequences/SequenceSharingPanel';
import { SequenceTrackingPanel } from '@/components/sequences/SequenceTrackingPanel';
import { SequencePerformancePanel } from '@/components/sequences/SequencePerformancePanel';
import { SequenceActivityPanel } from '@/components/sequences/SequenceActivityPanel';
import { SequenceRulesPanel } from '@/components/sequences/SequenceRulesPanel';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Mail,
  Phone,
  MessageSquare,
  ChevronRight,
  Repeat,
  Loader2,
  Play,
  Pause,
  StopCircle,
  History,
  X,
} from 'lucide-react';
import Linkedin from '@/components/icons/Linkedin';
import SequencePreview from '@/components/sequences/SequencePreview';
import { describeHold } from '@/lib/sequences/holdReasons';
import { describeSendWindow, describeStepWait, describeWeekendRule } from '@/lib/sequences/stepDescription';
import { canReplyInThread, previousEmailOrder } from '@/lib/sequences/threadingRules';
import { stepOwnership } from '@/lib/sequences/stepOwnership';
import { useToast } from '@/context/ToastContext';
import { useAppContext } from '@/context/AppContext';
import Link from 'next/link';

interface SequenceStep {
  id: string;
  order: number;
  channel: 'email' | 'phone' | 'linkedin' | 'whatsapp';
  delayDays: number;
  delayHours: number;
  instructions: string;
  templateId?: string | null;
  template?: { id: string; name: string; channel: string } | null;
  autoComplete: boolean;
  /** Minutes since midnight in the lead's timezone. Null on both = send any time. */
  sendWindowStartMinutes?: number | null;
  sendWindowEndMinutes?: number | null;
  /** Send as a reply in the previous email's thread instead of a new email. */
  replyInThread?: boolean;
}

interface Template {
  id: string;
  name: string;
  channel: string;
  subject?: string | null;
}

interface Sequence {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  /** Per-sequence rule (Settings → Rules). Absent or false = weekends are skipped. */
  sendOnWeekends?: boolean;
  /** Visible to the whole company; otherwise to its creator and the managers above them. */
  isShared?: boolean;
  createdById?: string;
  createdBy?: { id: string; firstName: string; lastName: string } | null;
  /** The caller may change it: its creator, or a manager above the creator (from the API). */
  canManage?: boolean;
  steps: SequenceStep[];
  _count?: { leads: number };
}

/** A step that can only be a new email — the first one, or any non-email — is never a reply. */
function withValidThreading(list: SequenceStep[]): SequenceStep[] {
  return list.map((step) =>
    step.replyInThread && !(step.channel === 'email' && step.autoComplete && canReplyInThread(list, step.order))
      ? { ...step, replyInThread: false }
      : step
  );
}

export default function SequencesPage() {
  const { showToast } = useToast();
  const { currentRole, currentUserId } = useAppContext();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [selectedSeq, setSelectedSeq] = useState<Sequence | null>(null);
  const [steps, setSteps] = useState<SequenceStep[]>([]);
  const [newStepChannel, setNewStepChannel] = useState<SequenceStep['channel']>('email');
  const [newStepDelayDays, setNewStepDelayDays] = useState(1);
  const [newStepDelayHours, setNewStepDelayHours] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSeqName, setNewSeqName] = useState('');
  const [newSeqDesc, setNewSeqDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);

  // Enrollment Dashboard State
  const [activeTab, setActiveTab] = useState<'builder' | 'enrollments' | 'performance' | 'activity' | 'sends' | 'settings'>('builder');
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [selectedEnrollments, setSelectedEnrollments] = useState<string[]>([]);
  const [enrollmentFilters, setEnrollmentFilters] = useState({ step: '', status: '' });
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  // When the list was read, so "overdue" is judged against that moment and not during render.
  const [enrollmentsLoadedAt, setEnrollmentsLoadedAt] = useState(0);
  const [bulkActioning, setBulkActioning] = useState(false);

  const [selectedEnrollmentForLogs, setSelectedEnrollmentForLogs] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsData, setLogsData] = useState<{ tasks: any[]; outboundMessages: any[]; activities: any[] } | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // The viewer's timezone for the schedule preview. Read after mount: the server render has no
  // browser to ask, and a value that differs between the two is a hydration mismatch.
  const [viewerTimezone, setViewerTimezone] = useState('UTC');
  useEffect(() => {
    setViewerTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, []);

  const minutesToTimeValue = (mins?: number | null): string => {
    if (mins == null) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const timeValueToMinutes = (timeStr: string): number | null => {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':').map((n) => parseInt(n, 10));
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  };

  const handleSendWindowChange = (stepId: string, boundary: 'start' | 'end', timeStr: string) => {
    const mins = timeValueToMinutes(timeStr);
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== stepId) return s;
        return boundary === 'start'
          ? { ...s, sendWindowStartMinutes: mins }
          : { ...s, sendWindowEndMinutes: mins };
      })
    );
  };

  const handleClearSendWindow = (stepId: string) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, sendWindowStartMinutes: null, sendWindowEndMinutes: null } : s))
    );
  };

  const handleThreadModeChange = (stepId: string, replyInThread: boolean) => {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, replyInThread } : s)));
  };

  const fetchLogs = useCallback(async (enrollmentId: string) => {
    if (!selectedSeq) return;
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/sequences/${selectedSeq.id}/enrollments/${enrollmentId}/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogsData(data);
      } else {
        showToast('Failed to fetch sequence logs', 'error');
      }
    } catch {
      showToast('Network error fetching sequence logs', 'error');
    } finally {
      setLogsLoading(false);
    }
  }, [selectedSeq, showToast]);

  useEffect(() => {
    if (selectedEnrollmentForLogs) {
      fetchLogs(selectedEnrollmentForLogs);
    } else {
      setLogsData(null);
    }
  }, [selectedEnrollmentForLogs, fetchLogs]);

  const handleRunNow = async (enrollmentId: string) => {
    if (!selectedSeq) return;
    setActionLoadingId(enrollmentId);
    try {
      const res = await fetch(`/api/sequences/${selectedSeq.id}/enrollments/${enrollmentId}/run-now`, {
        method: 'POST',
      });
      if (res.ok) {
        const result = await res.json();
        showToast(result.message || 'Execution triggered successfully!', 'success');
        loadEnrollments();
        refreshEnrollmentsSoon();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to force execute step', 'error');
      }
    } catch {
      showToast('Network error forcing sequence execution', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleToggleStatus = async (enrollmentId: string, currentStatus: string) => {
    if (!selectedSeq) return;
    setActionLoadingId(enrollmentId);
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    try {
      const res = await fetch(`/api/sequences/${selectedSeq.id}/enrollments/${enrollmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        showToast(`Sequence ${newStatus === 'active' ? 'resumed' : 'paused'} successfully!`, 'success');
        setEnrollments((prev) =>
          prev.map((e) => (e.id === enrollmentId ? { ...e, status: newStatus } : e))
        );
        loadEnrollments();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to toggle status', 'error');
      }
    } catch {
      showToast('Network error toggling sequence status', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const loadSequences = useCallback(async () => {
    const res = await fetch('/api/sequences', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setSequences(Array.isArray(data) ? data : []);
    }
  }, []);

  const loadEnrollments = useCallback(async () => {
    if (!selectedSeq) return;
    setLoadingEnrollments(true);
    const q = new URLSearchParams();
    if (enrollmentFilters.step) q.append('step', enrollmentFilters.step);
    if (enrollmentFilters.status) q.append('status', enrollmentFilters.status);
    const res = await fetch(`/api/sequences/${selectedSeq.id}/enrollments?${q.toString()}`);
    if (res.ok) {
      setEnrollments(await res.json());
      setEnrollmentsLoadedAt(Date.now());
    }
    setLoadingEnrollments(false);
  }, [selectedSeq, enrollmentFilters]);

  useEffect(() => {
    loadSequences();
    fetch('/api/templates')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [loadSequences]);

  useEffect(() => {
    if (activeTab === 'enrollments' && selectedSeq) {
      loadEnrollments();
      setSelectedEnrollments([]);
    }
  }, [activeTab, selectedSeq, enrollmentFilters, loadEnrollments]);

  // After Run now the worker answers a moment later, so the list is read once more to show the
  // send, or why it was held. The timer always calls the newest loader: one captured at the click
  // would refetch the sequence and filters of five seconds ago and put those rows over the
  // current ones.
  const loadEnrollmentsRef = useRef(loadEnrollments);
  useEffect(() => { loadEnrollmentsRef.current = loadEnrollments; }, [loadEnrollments]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshEnrollmentsSoon = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => { void loadEnrollmentsRef.current(); }, 5000);
  };
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  const handleSelectSequence = (seq: Sequence) => {
    setSelectedSeq(seq);
    setSteps(seq.steps.map((s) => ({ ...s })));
    setActiveTab('builder');
  };

  // The weekend rule is edited on the Settings tab and described on every step card, so it is
  // re-read whenever the builder is shown rather than trusted from the list this row came from.
  const selectedSeqId = selectedSeq?.id;
  useEffect(() => {
    if (activeTab !== 'builder' || !selectedSeqId) return;
    let cancelled = false;
    fetch(`/api/sequences/${selectedSeqId}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((fresh) => {
        if (cancelled || !fresh) return;
        setSelectedSeq((current) =>
          current && current.id === selectedSeqId ? { ...current, sendOnWeekends: Boolean(fresh.sendOnWeekends) } : current
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeTab, selectedSeqId]);

  const handleAddStep = () => {
    const nextOrder = steps.length + 1;
    const newStep: SequenceStep = {
      id: `step_new_${Date.now()}`,
      order: nextOrder,
      channel: newStepChannel,
      delayDays: newStepDelayDays,
      delayHours: newStepDelayHours,
      instructions: `Log touchpoint details for the ${newStepChannel} outreach.`,
      templateId: null,
      autoComplete: newStepChannel === 'email',
      // A follow-up email continues the conversation unless someone decides otherwise.
      replyInThread: newStepChannel === 'email' && canReplyInThread(steps, nextOrder),
    };
    setSteps((prev) => [...prev, newStep]);
  };

  const handleCreateSequence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSeqName.trim()) return;
    setCreating(true);
    const res = await fetch('/api/sequences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newSeqName, description: newSeqDesc, isActive: true, steps: [] }),
    });
    setCreating(false);
    if (res.ok) {
      showToast('Sequence created!', 'success');
      setShowCreateModal(false);
      setNewSeqName('');
      setNewSeqDesc('');
      await loadSequences();
    } else {
      showToast('Failed to create sequence', 'error');
    }
  };

  const handleDuplicate = async (seq: Sequence) => {
    const res = await fetch('/api/sequences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${seq.name} (Copy)`,
        description: seq.description,
        isActive: false,
        steps: seq.steps.map(({ channel, order, delayDays, delayHours, instructions, templateId, autoComplete, sendWindowStartMinutes, sendWindowEndMinutes, replyInThread }) => ({
          channel, order, delayDays, delayHours, instructions, templateId, autoComplete,
          sendWindowStartMinutes: sendWindowStartMinutes ?? null,
          sendWindowEndMinutes: sendWindowEndMinutes ?? null,
          replyInThread: Boolean(replyInThread),
        })),
      }),
    });
    if (res.ok) {
      showToast('Sequence duplicated', 'success');
      await loadSequences();
    } else {
      showToast('Failed to duplicate sequence', 'error');
    }
  };

  const handleArchiveSeq = async (seq: Sequence) => {
    if (!window.confirm(`Archive "${seq.name}"? It will be hidden from the list.`)) return;
    const res = await fetch(`/api/sequences/${seq.id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Sequence archived', 'success');
      await loadSequences();
    } else {
      // 403 for someone who is neither its creator nor a manager; the API says so.
      const detail = await res.json().catch(() => null);
      showToast(detail?.error ?? 'Failed to archive sequence', 'error');
    }
  };

  const handleStepTemplateChange = (stepId: string, templateId: string | null) => {
    const tpl = templates.find((t) => t.id === templateId) ?? null;
    setSteps((prev) => prev.map((s) =>
      s.id === stepId ? { ...s, templateId: templateId ?? null, template: tpl ? { id: tpl.id, name: tpl.name, channel: tpl.channel } : null } : s
    ));
  };

  const handleDeleteStep = (id: string) => {
    const filtered = steps.filter((s) => s.id !== id);
    setSteps(withValidThreading(filtered.map((s, idx) => ({ ...s, order: idx + 1 }))));
  };

  const handleMoveStep = (index: number, direction: 'up' | 'down') => {
    const updated = [...steps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= steps.length) return;
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setSteps(withValidThreading(updated.map((s, idx) => ({ ...s, order: idx + 1 }))));
  };

  const handleSaveBuilder = async () => {
    if (!selectedSeq) return;
    setSaving(true);
    const res = await fetch(`/api/sequences/${selectedSeq.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: selectedSeq.name,
        description: selectedSeq.description,
        isActive: selectedSeq.isActive,
        steps: steps.map((s) => ({
          channel: s.channel,
          order: s.order,
          delayDays: s.delayDays,
          delayHours: s.delayHours,
          instructions: s.instructions,
          templateId: s.templateId ?? null,
          autoComplete: s.autoComplete,
          sendWindowStartMinutes: s.sendWindowStartMinutes ?? null,
          sendWindowEndMinutes: s.sendWindowEndMinutes ?? null,
          replyInThread: Boolean(s.replyInThread),
        })),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      // The API refuses edits the builder cannot fully prevent: removing a step an active
      // enrollment is sitting on, a non-manager changing a send window, an auto-complete
      // email step with no template. A validation refusal carries the specific reason in
      // `details[0].message`; the top-level `error` is only "Invalid sequence update".
      const detail = await res.json().catch(() => null);
      showToast(detail?.details?.[0]?.message ?? detail?.error ?? 'Failed to save sequence', 'error');
      return;
    }
    showToast('Sequence cadence saved!', 'success');
    setSequences((prev) =>
      prev.map((s) => (s.id === selectedSeq.id ? { ...s, steps } : s))
    );
    loadSequences();
  };

  const handleBulkAction = async (action: string) => {
    if (selectedEnrollments.length === 0 || !selectedSeq) return;
    setBulkActioning(true);
    const res = await fetch(`/api/sequences/${selectedSeq.id}/enrollments/bulk-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollmentIds: selectedEnrollments, action })
    });
    setBulkActioning(false);
    if (res.ok) {
      // Say how many actually moved: a paused lead, a manual step or someone else's lead is
      // skipped, and "completed" for a click that changed nothing reads as a broken button.
      const result = await res.json().catch(() => null);
      const done = typeof result?.processedCount === 'number' ? result.processedCount : selectedEnrollments.length;
      const skipped = selectedEnrollments.length - done;
      // For Run now the count is what was started, not what was delivered: the mailbox can still
      // hold one, and the Status column says so.
      const verb = action === 'run-now' ? 'Sending now for' : 'Done for';
      showToast(
        skipped > 0 ? `${verb} ${done} of ${selectedEnrollments.length} — ${skipped} skipped` : `${verb} ${done}`,
        done > 0 ? 'success' : 'error'
      );
      if (action === 'run-now') refreshEnrollmentsSoon();
      setSelectedEnrollments([]);
      loadEnrollments();
      loadSequences(); // Refresh lead counts
    } else {
      showToast('Failed to perform bulk action', 'error');
    }
  };

  const toggleEnrollmentSelection = (id: string) => {
    setSelectedEnrollments(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleAllEnrollments = () => {
    if (selectedEnrollments.length === enrollments.length) {
      setSelectedEnrollments([]);
    } else {
      setSelectedEnrollments(enrollments.map(e => e.id));
    }
  };

  const getChannelColor = (channel: SequenceStep['channel']) => {
    switch (channel) {
      case 'email': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
      case 'phone': return 'text-green-500 bg-green-500/10 border-green-500/20';
      case 'linkedin': return 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20';
      case 'whatsapp': return 'text-teal-500 bg-teal-500/10 border-teal-500/20';
    }
  };

  const getChannelIcon = (channel: SequenceStep['channel']) => {
    switch (channel) {
      case 'email': return <Mail className="w-4 h-4" />;
      case 'phone': return <Phone className="w-4 h-4" />;
      case 'linkedin': return <Linkedin className="w-4 h-4" />;
      case 'whatsapp': return <MessageSquare className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6 flex-1 flex flex-col">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-extrabold text-2xl text-text-primary tracking-tight">
            Sequence Cadences
          </h1>
          <p className="text-xs text-text-secondary mt-0.5 prose-measure">
            Design multi-step, multi-channel automated drip touchpoints for campaigns.
          </p>
        </div>
        {selectedSeq === null && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg shadow-sm transition-colors active:scale-95 flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Sequence</span>
          </button>
        )}
      </div>

      {selectedSeq === null ? (
        <div className="grid grid-cols-3 gap-6">
          {sequences.length === 0 && (
            <div className="col-span-3 text-center py-12 text-text-muted text-xs">
              No sequences yet. Create one to get started.
            </div>
          )}
          {sequences.map((seq) => (
            <div
              key={seq.id}
              className="bg-card-bg border border-card-border rounded-2xl p-5 shadow-sm flex flex-col justify-between hover:border-brand-red hover:shadow-md transition-all duration-200"
            >
              <div>
                <div className="flex items-center justify-between mb-3.5">
                  <div className="bg-brand-orange/10 border border-brand-orange/20 rounded-lg p-1.5 text-brand-orange-text">
                    <Repeat className="w-5 h-5" />
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold border font-mono ${
                      seq.isActive
                        ? 'bg-green-500/15 text-green-500 border-green-500/20'
                        : 'bg-gray-500/10 text-gray-500'
                    }`}
                  >
                    {seq.isActive ? 'ACTIVE' : 'PAUSED'}
                  </span>
                </div>

                <h2 className="font-display font-bold text-sm text-text-primary mb-1">{seq.name}</h2>
                <p className="text-xs text-text-secondary leading-relaxed mb-4">{seq.description}</p>

                <div className="space-y-2 border-t border-card-border/30 pt-3 text-xs mb-5">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Total Steps:</span>
                    <span className="font-semibold text-text-primary font-mono">
                      {seq.steps.length} steps
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Visible to:</span>
                    <span className="font-semibold text-text-primary">
                      {seq.isShared
                        ? 'Whole team'
                        : seq.createdById === currentUserId
                          ? 'Only you and your managers'
                          : `${seq.createdBy ? `${seq.createdBy.firstName} ${seq.createdBy.lastName}` : 'Its owner'} and their managers`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Enrolled Leads:</span>
                    <span className="font-semibold text-brand-orange-text font-mono">
                      {seq._count?.leads ?? 0} active
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleSelectSequence(seq)}
                  className="flex-1 py-2 bg-bg-main hover:bg-brand-red hover:text-white border border-card-border hover:border-brand-red rounded-xl text-xs font-semibold text-text-primary transition-all flex items-center justify-center gap-1 active:scale-95"
                >
                  <span>Manage</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDuplicate(seq)}
                  title="Duplicate sequence"
                  className="px-3 py-2 bg-bg-main hover:bg-card-border border border-card-border rounded-xl text-xs font-semibold text-text-muted hover:text-text-primary transition-all active:scale-95"
                >
                  Copy
                </button>
                <button
                  onClick={() => handleArchiveSeq(seq)}
                  title="Archive sequence"
                  className="px-3 py-2 bg-bg-main hover:bg-brand-red/5 border border-card-border hover:border-brand-red/30 rounded-xl text-xs font-semibold text-text-muted hover:text-brand-red transition-all active:scale-95"
                >
                  Archive
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Header & Tabs */}
          <div className="bg-card-bg border border-card-border rounded-2xl p-4 flex flex-col gap-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider">
                  Managing Sequence
                </span>
                <h2 className="font-display font-bold text-base text-text-primary mt-0.5">
                  {selectedSeq.name}
                </h2>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedSeq(null)}
                  className="px-3 py-1.5 border border-card-border bg-bg-main hover:bg-card-border/30 rounded-lg text-xs font-semibold text-text-secondary transition-colors"
                >
                  Back to All
                </button>
                {activeTab === 'builder' && (
                  <button
                    onClick={handleSaveBuilder}
                    disabled={saving}
                    className="px-3 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white rounded-lg text-xs font-semibold shadow-sm transition-colors disabled:opacity-60"
                  >
                    {saving ? 'Saving...' : 'Save Cadence'}
                  </button>
                )}
              </div>
            </div>
            
            <div className="flex gap-4 border-b border-card-border">
              <button
                onClick={() => setActiveTab('builder')}
                className={`pb-2 text-xs font-semibold transition-colors ${activeTab === 'builder' ? 'text-brand-red border-b-2 border-brand-red' : 'text-text-secondary hover:text-text-primary'}`}
              >
                Steps Builder
              </button>
              <button
                onClick={() => setActiveTab('enrollments')}
                className={`pb-2 text-xs font-semibold transition-colors ${activeTab === 'enrollments' ? 'text-brand-red border-b-2 border-brand-red' : 'text-text-secondary hover:text-text-primary'}`}
              >
                Enrollments Dashboard
              </button>
              <button
                onClick={() => setActiveTab('performance')}
                className={`pb-2 text-xs font-semibold transition-colors ${activeTab === 'performance' ? 'text-brand-red border-b-2 border-brand-red' : 'text-text-secondary hover:text-text-primary'}`}
              >
                Performance
              </button>
              <button
                onClick={() => setActiveTab('activity')}
                className={`pb-2 text-xs font-semibold transition-colors ${activeTab === 'activity' ? 'text-brand-red border-b-2 border-brand-red' : 'text-text-secondary hover:text-text-primary'}`}
              >
                Activity
              </button>
              <button
                onClick={() => setActiveTab('sends')}
                className={`pb-2 text-xs font-semibold transition-colors ${activeTab === 'sends' ? 'text-brand-red border-b-2 border-brand-red' : 'text-text-secondary hover:text-text-primary'}`}
              >
                Sends
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`pb-2 text-xs font-semibold transition-colors ${activeTab === 'settings' ? 'text-brand-red border-b-2 border-brand-red' : 'text-text-secondary hover:text-text-primary'}`}
              >
                Settings
              </button>
            </div>
          </div>

          {activeTab === 'performance' ? (
            <SequencePerformancePanel sequenceId={selectedSeq.id} />
          ) : activeTab === 'activity' ? (
            <SequenceActivityPanel sequenceId={selectedSeq.id} />
          ) : activeTab === 'sends' ? (
            <EmailLogTable sequenceId={selectedSeq.id} />
          ) : activeTab === 'settings' ? (
            <div className="space-y-4">
              <SequenceSharingPanel
                sequenceId={selectedSeq.id}
                isShared={Boolean(selectedSeq.isShared)}
                ownerName={
                  selectedSeq.createdById === currentUserId
                    ? 'you'
                    : selectedSeq.createdBy
                      ? `${selectedSeq.createdBy.firstName} ${selectedSeq.createdBy.lastName}`
                      : null
                }
                canShare={
                  (currentRole === 'director' || currentRole === 'floor_manager' || currentRole === 'team_lead') &&
                  Boolean(selectedSeq.canManage)
                }
                onChange={(isShared) => {
                  setSelectedSeq((current) => (current ? { ...current, isShared } : current));
                  setSequences((prev) => prev.map((s) => (s.id === selectedSeq.id ? { ...s, isShared } : s)));
                }}
              />
              <SequenceSendersPanel sequenceId={selectedSeq.id} />
              <SequenceRulesPanel sequenceId={selectedSeq.id} />
              <SequenceTrackingPanel sequenceId={selectedSeq.id} />
            </div>
          ) : activeTab === 'builder' ? (
            <div className="grid grid-cols-3 gap-6 flex-1 items-start">
              <div className="col-span-2 space-y-3">
                {steps.map((step, idx) => {
                  const previous = idx > 0 ? steps[idx - 1] : null;
                  const sendOnWeekends = Boolean(selectedSeq.sendOnWeekends);
                  // The CRM sends it, rather than a rep.
                  const sendsItself = step.channel === 'email' && step.autoComplete;
                  const mayReply = sendsItself && canReplyInThread(steps, step.order);
                  const isReply = mayReply && Boolean(step.replyInThread);
                  const replyTo = previousEmailOrder(steps, step.order);
                  const stepTemplate = templates.find((t) => t.id === step.templateId);
                  const subjectMissing = Boolean(stepTemplate) && !(stepTemplate?.subject ?? '').trim();
                  const windowUnset = step.sendWindowStartMinutes == null && step.sendWindowEndMinutes == null;
                  return (
                  <div
                    key={step.id}
                    className="bg-card-bg border border-card-border rounded-xl p-4 shadow-sm flex items-start justify-between gap-4 hover:bg-bg-main/20 transition-all"
                  >
                    <div className="flex gap-3">
                      <div className="w-7 h-7 rounded-lg bg-card-border/40 border border-card-border flex items-center justify-center font-mono font-bold text-xs text-text-secondary">
                        {step.order}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-bold border capitalize flex items-center gap-1 ${getChannelColor(step.channel)}`}
                          >
                            {getChannelIcon(step.channel)}
                            <span>{step.channel}</span>
                          </span>
                          {sendsItself && (
                            <span className="type-micro font-semibold text-text-secondary">
                              {isReply ? `Reply in thread · step ${replyTo}` : 'New email'}
                            </span>
                          )}
                        </div>
                        {/* When it is due, in a sentence: what the wait is measured from, and
                            whether its days are business days. */}
                        <p className="type-meta text-text-primary pr-4">
                          {describeStepWait({
                            delayDays: step.delayDays,
                            delayHours: step.delayHours,
                            previousOrder: previous?.order ?? null,
                            previousIsAutomatic: Boolean(previous && previous.channel === 'email' && previous.autoComplete),
                            sendOnWeekends,
                          })}{' '}
                          <span className="text-text-muted">
                            {describeWeekendRule(sendOnWeekends)}
                          </span>
                        </p>
                        {/* A task note is for a person. An email the CRM sends has no one to read it. */}
                        {!sendsItself && step.instructions && (
                          <p className="type-meta text-text-secondary pr-4">{step.instructions}</p>
                        )}
                        {/* Who sends it. Only email can be sent by the CRM; every other channel is
                            a task for the rep, so the switch is offered for email alone. */}
                        {step.channel === 'email' ? (
                          <label className="flex items-center gap-2 cursor-pointer mt-1.5 select-none">
                            <div
                              onClick={() => setSteps((prev) => withValidThreading(prev.map((s) => s.id === step.id ? { ...s, autoComplete: !s.autoComplete } : s)))}
                              className={`w-8 h-4 rounded-full border transition-colors flex items-center px-0.5 ${step.autoComplete ? 'bg-emerald-500/20 border-emerald-500/40' : 'bg-card-border border-card-border'}`}
                            >
                              <div className={`w-3 h-3 rounded-full transition-transform ${step.autoComplete ? 'bg-emerald-500 translate-x-4' : 'bg-text-muted translate-x-0'}`} />
                            </div>
                            <span className="type-micro text-text-secondary">
                              {step.autoComplete
                                ? 'Sends automatically — the CRM sends this email when it is due'
                                : 'Manual — the rep gets a task and sends this email themselves'}
                            </span>
                          </label>
                        ) : (
                          <p className="mt-1.5 type-micro text-text-secondary">
                            Manual — the rep gets a task for this. Completing it starts the next step’s wait.
                          </p>
                        )}
                        {/* Armed with nothing to send. The API refuses this on save; saying it
                            here, next to the toggle, is what stops the click in the first place. */}
                        {sendsItself && !step.templateId && (
                          <p role="status" className="mt-1.5 type-micro text-brand-orange-text">
                            An automatic email needs a template — this step cannot send without one.
                          </p>
                        )}
                        {/* Same thread or a new email. Only a follow-up can be a reply: the first
                            email has nothing to reply to. */}
                        {sendsItself && (
                          <div className="mt-2">
                            {mayReply ? (
                              <div role="radiogroup" aria-label={`Step ${step.order}: send as`} className="flex items-center gap-2">
                                <span className="type-micro text-text-secondary">Send as</span>
                                {([true, false] as const).map((asReply) => (
                                  <button
                                    key={String(asReply)}
                                    type="button"
                                    role="radio"
                                    aria-checked={isReply === asReply}
                                    onClick={() => handleThreadModeChange(step.id, asReply)}
                                    className={`rounded border px-2 py-1 type-micro font-semibold ${
                                      isReply === asReply
                                        ? 'border-brand-red bg-brand-red/10 text-text-primary'
                                        : 'border-card-border text-text-secondary hover:bg-card-border/40'
                                    }`}
                                  >
                                    {asReply ? 'Reply in same thread' : 'New email'}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="type-micro text-text-muted">
                                Sent as a new email — there is no earlier automatic email in this sequence to reply to.
                              </p>
                            )}
                            {mayReply && (
                              <p className="mt-1 type-micro text-text-muted">
                                {isReply
                                  ? `Goes out as a reply to the email from step ${replyTo}, under “Re:” and that email’s subject; this step’s template subject is not used. Gmail and SMTP mailboxes thread it. An Outlook mailbox, or a lead whose earlier email came from a different mailbox, gets it as a new email under the same subject.`
                                  : 'Starts a new conversation under this template’s own subject.'}
                              </p>
                            )}
                            {!isReply && step.templateId && subjectMissing && (
                              <p role="status" className="mt-1 type-micro text-brand-orange-text">
                                {mayReply
                                  ? 'This template has no subject, so the email will reuse the earlier email’s subject. Add a subject under Templates to start a new conversation, or switch to “Reply in same thread”.'
                                  : 'This template has no subject, so the email would arrive with an empty subject line. Add one under Templates.'}
                              </p>
                            )}
                          </div>
                        )}
                        {/* Send window — deliverability policy, so managers only (spec §27) */}
                        {step.autoComplete && (
                          <>
                          <div className="flex items-center gap-2 mt-2">
                            <label className="type-micro text-text-secondary" htmlFor={`win-start-${step.id}`}>
                              Time of day: between
                            </label>
                            <input
                              id={`win-start-${step.id}`}
                              type="time"
                              value={minutesToTimeValue(step.sendWindowStartMinutes)}
                              onChange={(e) => handleSendWindowChange(step.id, 'start', e.target.value)}
                              className="bg-bg-main border border-card-border rounded px-2 py-1 text-[10px] text-text-secondary focus:outline-none focus:border-brand-red font-mono disabled:opacity-50"
                            />
                            <span className="text-[10px] text-text-muted">and</span>
                            <input
                              type="time"
                              aria-label={`Step ${step.order} send window end`}
                              value={minutesToTimeValue(step.sendWindowEndMinutes)}
                              onChange={(e) => handleSendWindowChange(step.id, 'end', e.target.value)}
                              className="bg-bg-main border border-card-border rounded px-2 py-1 text-[10px] text-text-secondary focus:outline-none focus:border-brand-red font-mono disabled:opacity-50"
                            />
                            {!windowUnset && (
                                <button
                                  onClick={() => handleClearSendWindow(step.id)}
                                  className="type-micro text-text-muted hover:text-brand-red underline"
                                >
                                  Clear
                                </button>
                              )}
                          </div>
                          {/* What the two boxes mean, including when they are empty — the blank
                              "--:--" pair with "any time" beside it is what nobody could read. */}
                          <p className="mt-1 type-micro text-text-muted pr-4">
                            {describeSendWindow(step.sendWindowStartMinutes, step.sendWindowEndMinutes)}
                          </p>
                          </>
                        )}
                        {/* Template link */}
                        {(step.channel === 'email' || step.channel === 'linkedin') && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <select
                              value={step.templateId ?? ''}
                              onChange={(e) => handleStepTemplateChange(step.id, e.target.value || null)}
                              className="bg-bg-main border border-card-border rounded px-2 py-1 text-[10px] text-text-secondary focus:outline-none focus:border-brand-red font-mono max-w-[200px]"
                            >
                              <option value="">— No template —</option>
                              {templates.filter((t) => t.channel === step.channel).map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                            {step.template && (
                              <span className="text-[9px] font-mono text-brand-orange-text bg-brand-orange/10 border border-brand-orange/20 px-1.5 py-0.5 rounded">
                                {step.template.name}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleMoveStep(idx, 'up')}
                        disabled={idx === 0}
                        className="p-1 hover:bg-card-border/50 text-text-secondary disabled:opacity-40 disabled:hover:bg-transparent rounded"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMoveStep(idx, 'down')}
                        disabled={idx === steps.length - 1}
                        className="p-1 hover:bg-card-border/50 text-text-secondary disabled:opacity-40 disabled:hover:bg-transparent rounded"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteStep(step.id)}
                        className="p-1 hover:bg-brand-red/10 text-text-muted hover:text-brand-red rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  );
                })}

                {steps.length === 0 && (
                  <div className="border border-dashed border-card-border rounded-xl p-8 text-center text-xs text-text-muted">
                    No steps yet. Add a step from the panel on the right.
                  </div>
                )}
              </div>

              {/* One right-hand column for the form and the preview. No card chrome on the wrapper:
                  the two cards are its children, and a card does not go inside a card. */}
              <div className="space-y-6">
              <div className="bg-card-bg border border-card-border rounded-2xl p-5 shadow-sm space-y-4">
                <h3 className="type-section text-text-primary flex items-center gap-2">
                  <span>➕</span> Add New Cadence Step
                </h3>

                <div className="space-y-3.5 text-xs">
                  <div>
                    <label className="text-[10px] font-bold text-text-secondary uppercase block mb-1">
                      Select Channel
                    </label>
                    <select
                      value={newStepChannel}
                      onChange={(e) => setNewStepChannel(e.target.value as SequenceStep['channel'])}
                      className="w-full bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red font-medium cursor-pointer"
                    >
                      <option value="email">📧 Email outreach</option>
                      <option value="phone">📞 Phone call dial</option>
                      <option value="linkedin">💼 LinkedIn touch</option>
                      <option value="whatsapp">💬 WhatsApp message</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-text-secondary uppercase block mb-1">
                        Wait Days
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={newStepDelayDays}
                        onChange={(e) => setNewStepDelayDays(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-full bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-text-secondary uppercase block mb-1">
                        Wait Hours
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={newStepDelayHours}
                        onChange={(e) => setNewStepDelayHours(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-full bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red text-xs font-mono"
                      />
                    </div>
                  </div>

                  <p className="type-micro text-text-muted">
                    The wait counts from when the previous step is sent or completed; the first step counts from
                    enrollment. Days are business days unless this sequence sends on weekends.
                  </p>

                  <button
                    onClick={handleAddStep}
                    className="w-full py-2 bg-brand-orange hover:bg-brand-orange-hover text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-1 active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Step to Sequence</span>
                  </button>
                </div>

                <div className="pt-2 border-t border-card-border text-[10px] text-text-muted leading-relaxed font-mono">
                  * Changes are saved when you click "Save Cadence" above.
                </div>
              </div>

              {/* Schedule preview (spec §28), computed by the server with the same function the
                  worker uses. The table that stood here was worked out in the browser: it always
                  began on "Monday 09:00", counted calendar days and ignored the weekend rule, so
                  it showed sends on days the engine never sends. */}
              <div className="bg-card-bg border border-card-border rounded-2xl p-5 shadow-sm space-y-3">
                <SequencePreview
                  steps={steps.map((s) => ({
                    order: s.order,
                    channel: s.channel,
                    delayDays: s.delayDays,
                    delayHours: s.delayHours,
                    autoComplete: s.channel === 'email' && s.autoComplete,
                    sendWindowStartMinutes: s.sendWindowStartMinutes ?? null,
                    sendWindowEndMinutes: s.sendWindowEndMinutes ?? null,
                  }))}
                  timezone={viewerTimezone}
                  sequenceId={selectedSeq.id}
                />
                <p className="type-micro text-text-muted">
                  {describeWeekendRule(Boolean(selectedSeq.sendOnWeekends))} Change it under Settings. Each step waits
                  for the one before it, so a step that goes late moves every step after it. A full or paused mailbox
                  can also hold an email past the time shown.
                </p>
              </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex gap-2">
                  <select 
                    value={enrollmentFilters.step} 
                    onChange={e => setEnrollmentFilters(p => ({ ...p, step: e.target.value }))}
                    className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-brand-red font-medium cursor-pointer shadow-2xs"
                  >
                    <option value="">All Steps</option>
                    {steps.map(s => (
                      <option key={s.id} value={s.order}>Step {s.order} ({s.channel})</option>
                    ))}
                  </select>
                  <select 
                    value={enrollmentFilters.status} 
                    onChange={e => setEnrollmentFilters(p => ({ ...p, status: e.target.value }))}
                    className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-brand-red font-medium cursor-pointer shadow-2xs"
                  >
                    <option value="">Status: Active & Paused</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="unenrolled">Unenrolled</option>
                  </select>
                </div>
                
                {selectedEnrollments.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-muted mr-2">{selectedEnrollments.length} selected</span>
                    <button
                      onClick={() => handleBulkAction('run-now')}
                      disabled={bulkActioning}
                      className="px-3 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white rounded-lg text-xs font-semibold shadow-sm transition-colors disabled:opacity-60 flex items-center gap-1"
                    >
                      <Play className="w-3.5 h-3.5" /> Run Now
                    </button>
                    <button
                      onClick={() => handleBulkAction('pause')}
                      disabled={bulkActioning}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors disabled:opacity-60 flex items-center gap-1"
                    >
                      <Pause className="w-3.5 h-3.5" /> Pause
                    </button>
                    <button
                      onClick={() => handleBulkAction('resume')}
                      disabled={bulkActioning}
                      className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors disabled:opacity-60 flex items-center gap-1"
                    >
                      <Repeat className="w-3.5 h-3.5" /> Resume
                    </button>
                    <button
                      onClick={() => handleBulkAction('unenroll')}
                      disabled={bulkActioning}
                      className="px-3 py-1.5 border border-card-border bg-bg-main hover:bg-card-border/50 text-text-secondary rounded-lg text-xs font-semibold shadow-sm transition-colors disabled:opacity-60 flex items-center gap-1"
                    >
                      <StopCircle className="w-3.5 h-3.5" /> Unenroll
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-card-bg border border-card-border rounded-xl shadow-sm overflow-hidden">
                {loadingEnrollments ? (
                  <div className="p-8 flex justify-center items-center">
                    <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
                  </div>
                ) : enrollments.length === 0 ? (
                  <div className="p-8 text-center text-xs text-text-muted">
                    No enrollments found matching the criteria.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-card-border bg-bg-main/50">
                        <th className="px-4 py-3 font-semibold text-text-secondary w-10">
                          <input 
                            type="checkbox" 
                            checked={selectedEnrollments.length === enrollments.length && enrollments.length > 0}
                            onChange={toggleAllEnrollments}
                            className="rounded border-card-border bg-bg-main"
                          />
                        </th>
                        <th className="px-4 py-3 font-semibold text-text-secondary">Lead</th>
                        <th className="px-4 py-3 font-semibold text-text-secondary">Company</th>
                        <th className="px-4 py-3 font-semibold text-text-secondary">Status</th>
                        <th className="px-4 py-3 font-semibold text-text-secondary">Current Step</th>
                        <th className="px-4 py-3 font-semibold text-text-secondary">Next step due (your time)</th>
                        <th className="px-4 py-3 font-semibold text-text-secondary text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-card-border">
                      {enrollments.map((enr) => {
                        const isSelected = selectedEnrollments.includes(enr.id);
                        const pendingTask = enr.lead.tasks?.[0];
                        // A LinkedIn or call step is the rep's to make; the worker only sends
                        // email. Saying so here is what stops a due date on a manual step from
                        // reading as a broken engine.
                        const ownership = stepOwnership(pendingTask?.type);
                        const hold = describeHold(enr.holdReason);
                        // More than a few minutes late; a step due this minute is simply due.
                        const isOverdue =
                          enr.status === 'active' &&
                          Boolean(pendingTask) &&
                          new Date(pendingTask.dueDate).getTime() < enrollmentsLoadedAt - 5 * 60 * 1000;
                        return (
                          <tr key={enr.id} className={`hover:bg-bg-main/30 transition-colors ${isSelected ? 'bg-brand-red/5' : ''}`}>
                            <td className="px-4 py-3">
                              <input 
                                type="checkbox" 
                                checked={isSelected}
                                onChange={() => toggleEnrollmentSelection(enr.id)}
                                className="rounded border-card-border bg-bg-main"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <Link href={`/leads/${enr.lead.id}`} className="font-semibold text-text-primary hover:text-brand-red transition-colors">
                                {enr.lead.firstName} {enr.lead.lastName}
                              </Link>
                            </td>
                            <td className="px-4 py-3 text-text-secondary">{enr.lead.company}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${
                                enr.status === 'active' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                enr.status === 'paused' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                                'bg-card-border text-text-secondary border-card-border'
                              }`}>
                                {enr.status.toUpperCase()}
                              </span>
                              {/* Why the step has not gone, when it has not. Without this a held
                                  step and a broken one look the same: a date in the past. */}
                              {enr.status === 'active' && hold && (
                                <div className={`mt-1 type-meta ${hold.needsAction ? 'text-brand-orange-text' : 'text-text-muted'}`}>
                                  {hold.label}
                                </div>
                              )}
                              {enr.status === 'paused' && enr.pausedReason && (
                                <div className="mt-1 type-meta text-text-muted">
                                  {enr.pausedReason === 'send_failed'
                                    ? 'The last email could not be sent — check the mailbox, then resume'
                                    : `Paused: ${String(enr.pausedReason).replace(/_/g, ' ')}`}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-mono text-text-primary">Step {enr.currentStep}</div>
                              {pendingTask && (
                                <div
                                  className={`mt-0.5 type-meta ${ownership.owner === 'human' ? 'text-amber-500' : 'text-text-muted'}`}
                                  title={ownership.reason}
                                >
                                  {ownership.label}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono text-text-muted">
                              {pendingTask ? new Date(pendingTask.dueDate).toLocaleString() : '-'}
                              {isOverdue && (
                                <div className="mt-0.5 type-meta font-sans text-brand-orange-text">Overdue</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => setSelectedEnrollmentForLogs(enr.id)}
                                  className="p-1 hover:bg-card-border/50 text-text-muted hover:text-text-primary rounded transition-colors"
                                  title="View Execution Audit Log"
                                >
                                  <History className="w-4 h-4" />
                                </button>
                                {enr.status === 'active' && (
                                  <button
                                    onClick={() => handleRunNow(enr.id)}
                                    disabled={actionLoadingId !== null || !ownership.canRunNow}
                                    className="p-1 hover:bg-green-500/10 text-text-muted hover:text-green-500 rounded transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted disabled:cursor-not-allowed"
                                    title={ownership.canRunNow ? 'Send this step now — skips the send window and the weekend rule' : ownership.reason}
                                  >
                                    <Play className="w-4 h-4 fill-current" />
                                  </button>
                                )}
                                {(enr.status === 'active' || enr.status === 'paused') && (
                                  <button
                                    onClick={() => handleToggleStatus(enr.id, enr.status)}
                                    disabled={actionLoadingId !== null}
                                    className={`p-1 rounded transition-colors disabled:opacity-50 ${
                                      enr.status === 'active'
                                        ? 'hover:bg-amber-500/10 text-text-muted hover:text-amber-500'
                                        : 'hover:bg-green-500/10 text-text-muted hover:text-green-500'
                                    }`}
                                    title={enr.status === 'active' ? 'Pause Sequence' : 'Resume Sequence'}
                                  >
                                    {enr.status === 'active' ? (
                                      <Pause className="w-4 h-4" />
                                    ) : (
                                      <Play className="w-4 h-4 animate-in fade-in" />
                                    )}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create New Sequence Modal */}
      {showCreateModal && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <form
              onSubmit={handleCreateSequence}
              className="pointer-events-auto bg-card-bg border border-card-border rounded-2xl shadow-2xl w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-200 p-6 space-y-4"
            >
              <div>
                <h2 className="font-display font-bold text-sm text-text-primary">Create New Sequence</h2>
                <p className="text-[10px] text-text-muted mt-0.5">Build a reusable multi-step cadence</p>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-text-muted uppercase mb-1">
                  Sequence Name *
                </label>
                <input
                  type="text"
                  required
                  value={newSeqName}
                  onChange={(e) => setNewSeqName(e.target.value)}
                  placeholder="e.g. Cold Email → LinkedIn → Call"
                  className="w-full px-3 py-2 bg-bg-main border border-card-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-brand-red"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-text-muted uppercase mb-1">
                  Description
                </label>
                <textarea
                  value={newSeqDesc}
                  onChange={(e) => setNewSeqDesc(e.target.value)}
                  placeholder="What is this sequence for?"
                  rows={2}
                  className="w-full px-3 py-2 bg-bg-main border border-card-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-brand-red resize-none placeholder-text-muted"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2 border border-card-border bg-bg-main hover:bg-card-border/30 rounded-lg text-xs font-semibold text-text-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-2 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-60"
                >
                  {creating ? 'Creating...' : 'Create Sequence'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Right-side Audit Log Slide-over Panel */}
      {selectedEnrollmentForLogs && (
        <div className="fixed inset-y-0 right-0 w-96 bg-card-bg border-l border-card-border shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-250 text-left">
          {/* Header */}
          <div className="p-4 border-b border-card-border flex items-center justify-between bg-bg-main">
            <div className="flex items-center gap-2">
              <span className="text-base">📋</span>
              <div className="text-left">
                <h3 className="text-xs font-bold text-text-primary uppercase">Sequence Audit Log</h3>
                <p className="text-xs text-text-muted mt-0.5">
                  Lead: {enrollments.find((e) => e.id === selectedEnrollmentForLogs)?.lead.firstName} {enrollments.find((e) => e.id === selectedEnrollmentForLogs)?.lead.lastName}
                </p>
              </div>
            </div>
            <button
              onClick={() => setSelectedEnrollmentForLogs(null)}
              className="p-1 hover:bg-card-border/60 text-text-muted hover:text-text-primary rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs bg-bg-main/50">
            {logsLoading ? (
              <div className="flex justify-center items-center h-48">
                <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
              </div>
            ) : logsData ? (
              <div className="space-y-4">
                {/* Activity Timeline */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-text-muted uppercase">Execution Timeline</h4>
                  {logsData.activities.length === 0 && logsData.tasks.length === 0 ? (
                    <p className="text-text-muted italic text-xs">No sequence execution events recorded yet.</p>
                  ) : (
                    <div className="relative border-l border-card-border pl-4 ml-1.5 space-y-4 text-left">
                      {[
                        ...logsData.activities.map((a) => ({
                          type: 'activity' as const,
                          date: new Date(a.createdAt),
                          title: a.description,
                          meta: a.metadata,
                          status: null as string | null,
                          key: `act-${a.id}`,
                        })),
                        ...logsData.tasks.map((t) => ({
                          type: 'task' as const,
                          date: new Date(t.completedAt || t.dueDate),
                          title: `Step ${t.sequenceStep}: ${t.title}`,
                          status: t.status as string | null,
                          meta: null,
                          key: `task-${t.id}`,
                        })),
                      ]
                        .sort((a, b) => b.date.getTime() - a.date.getTime())
                        .map((item) => (
                          <div key={item.key} className="relative">
                            <span className={`absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-card-bg ${
                              item.type === 'activity' ? 'bg-blue-500' :
                              item.status === 'completed' ? 'bg-green-500' :
                              item.status === 'skipped' ? 'bg-text-muted' :
                              'bg-amber-500'
                            }`} />
                            <div className="space-y-0.5">
                              <p className="font-semibold text-text-primary">{item.title}</p>
                              <div className="flex items-center gap-1.5 text-xs text-text-muted font-mono">
                                <span>{item.date.toLocaleString()}</span>
                                {item.status && (
                                  <span className={`px-1 rounded text-xs uppercase border ${
                                    item.status === 'completed' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                    item.status === 'skipped' ? 'bg-card-border text-text-secondary border-card-border' :
                                    'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                  }`}>
                                    {item.status}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* Outbound Messages */}
                {logsData.outboundMessages.length > 0 && (
                  <div className="space-y-2 border-t border-card-border/60 pt-3 text-left">
                    <h4 className="text-xs font-bold text-text-muted uppercase">Sent Outbound Emails</h4>
                    <div className="space-y-2">
                      {logsData.outboundMessages.map((msg) => (
                        <div key={msg.id} className="p-2 border border-card-border rounded-lg bg-card-bg space-y-1">
                          <p className="font-semibold text-text-primary truncate">{msg.subject || '(No Subject)'}</p>
                          <div className="flex justify-between items-center text-xs text-text-muted font-mono">
                            <span>{new Date(msg.createdAt).toLocaleString()}</span>
                            <span className={`px-1 rounded text-xs uppercase ${
                              msg.status === 'sent' ? 'bg-green-500/10 text-green-500' :
                              msg.status === 'failed' ? 'bg-red-500/10 text-red-500' :
                              'bg-amber-500/10 text-amber-500'
                            }`}>
                              {msg.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-text-muted italic text-center">Failed to load sequence audit log.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
