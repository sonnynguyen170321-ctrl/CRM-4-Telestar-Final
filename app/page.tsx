'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Check,
  Clock,
  Calendar,
  MessageSquare,
  PhoneCall,
  Mail,
  BarChart,
  Users,
  Award,
  FileText,
  MoreHorizontal,
  Flame,
  PhoneOff,
  PartyPopper,
  CheckCircle,
  Briefcase,
  Zap,
  Keyboard,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

// Slide-over loads on demand — its chunk fetches the first time a task's lead is opened.
const LeadDetailPanel = dynamic(() => import('@/components/LeadDetailPanel'), { ssr: false });

interface TaskLead {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  priority: string;
  stage: string;
  tags?: string[];
  campaign?: { id: string; name: string; client?: { id: string; name: string } | null } | null;
}

interface Task {
  id: string;
  leadId: string;
  lead: TaskLead;
  type: 'email' | 'phone' | 'linkedin' | 'whatsapp' | 'manual';
  title: string;
  description: string;
  dueDate: string;
  status: 'pending' | 'completed' | 'skipped';
  completedAt: string | null;
  priority: string;
}

/**
 * Activity-feed timestamp: show just the time for today's entries, but prefix the
 * date for older ones so a reverse-chron feed that spans days doesn't read as if
 * the times were out of order (e.g. "10:18" sitting above "Jun 21 · 17:20").
 */
function formatActivityTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isToday) return time;
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${day} · ${time}`;
}

export default function DashboardPage() {
  const { isManager, currentRole, isSessionLoading } = useAppContext();
  const { showToast } = useToast();
  const router = useRouter();

  // Leadgen has its own environment — send them there instead of the task dashboard.
  useEffect(() => {
    if (isSessionLoading) return;
    if (currentRole === 'leadgen') router.replace('/leadgen');
    if (currentRole === 'leadgen_manager') router.replace('/leadgen-manager');
  }, [isSessionLoading, currentRole, router]);

  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [yesterdayTasks, setYesterdayTasks] = useState<Task[]>([]);
  const [overdueTasks, setOverdueTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedSdrId, setSelectedSdrId] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'today' | 'yesterday' | 'overdue'>('today');
  const [loggingTask, setLoggingTask] = useState<Task | null>(null);
  const [callOutcome, setCallOutcome] = useState('no_answer');
  const [channelAction, setChannelAction] = useState('');
  const [responseReceived, setResponseReceived] = useState(false);
  const [responseStage, setResponseStage] = useState('');
  const [activityNote, setActivityNote] = useState('');
  const [loggingModalOpen, setLoggingModalOpen] = useState(false);
  const [rescheduleTask, setRescheduleTask] = useState<Task | null>(null);
  const [newDueDate, setNewDueDate] = useState('');
  // Tasks the user "skipped for now": kept pending, but sorted to the end of the active
  // list so they always come back (this session and on the next load) until completed or
  // rescheduled. Client-only — a skip never closes a task, so it can't become a report gap.
  const [deferredIds, setDeferredIds] = useState<Set<string>>(new Set());
  const [meetingPrompt, setMeetingPrompt] = useState<Task | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [quickNoteTask, setQuickNoteTask] = useState<Task | null>(null);
  const [quickNoteText, setQuickNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [sdrPipelineCounts, setSdrPipelineCounts] = useState<Record<string, number>>({});
  const [showStats, setShowStats] = useState<boolean>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('crm:showStats') !== 'false';
    return true;
  });
  const [overflowOpenId, setOverflowOpenId] = useState<string | null>(null);

  // ── Task filters (F4A) + bulk selection (F4B) ──────────────────────────────
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [campaignFilter, setCampaignFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [taskSearch, setTaskSearch] = useState('');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkRescheduleDate, setBulkRescheduleDate] = useState('');
  const [bulkReassignId, setBulkReassignId] = useState('');
  const [bulkNoteText, setBulkNoteText] = useState('');
  const [bulkPanel, setBulkPanel] = useState<'reschedule' | 'reassign' | 'note' | null>(null);

  // ── Keyboard shortcuts & active task selection ──────────────────────────────
  const [focusedTaskIndex, setFocusedTaskIndex] = useState<number>(0);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  const toggleStats = () => {
    setShowStats((v) => {
      const next = !v;
      if (typeof window !== 'undefined') localStorage.setItem('crm:showStats', String(next));
      return next;
    });
  };

  const fetchTasks = useCallback(async (tab: string, userId?: string) => {
    const params = new URLSearchParams({ tab });
    if (userId && userId !== 'all') params.set('userId', userId);
    const res = await fetch(`/api/tasks?${params}`);
    if (!res.ok) return [];
    return res.json();
  }, []);

  const loadAll = useCallback(async () => {
    const uid = isManager ? selectedSdrId : undefined;
    const actParams = uid && uid !== 'all' ? `?limit=20&userId=${uid}` : '?limit=20';
    const fetches: Promise<any>[] = [
      fetchTasks('today', uid),
      fetchTasks('yesterday', uid),
      fetchTasks('overdue', uid),
      fetch(`/api/activities${actParams}`).then((r) => (r.ok ? r.json() : [])),
    ];
    if (!isManager) {
      fetches.push(fetch('/api/leads').then((r) => (r.ok ? r.json() : [])));
    }
    const results = await Promise.all(fetches);
    const [today, yesterday, overdue, acts] = results;
    const todayArr = Array.isArray(today) ? today : [];
    const overdueArr = Array.isArray(overdue) ? overdue : [];
    const actsArr = Array.isArray(acts) ? acts : [];
    setTodayTasks(todayArr);
    setYesterdayTasks(Array.isArray(yesterday) ? yesterday : []);
    setOverdueTasks(overdueArr);
    setActivities(actsArr);

    // Expose live stats for the AI Assistant widget
    (window as any).__crm_sdr_stats = {
      overdueTasks: overdueArr.length,
      todayTasks: todayArr.length,
      sdrCallsToday: actsArr.filter((a: { type: string }) => a.type === 'call_logged').length,
      sdrEmailsToday: actsArr.filter((a: { type: string }) => a.type === 'email_sent').length,
    };
    if (!isManager && results[4]) {
      const leadList: any[] = Array.isArray(results[4]) ? results[4] : [];
      const counts: Record<string, number> = {};
      leadList.forEach((l) => { counts[l.stage] = (counts[l.stage] ?? 0) + 1; });
      setSdrPipelineCounts(counts);
    }
  }, [isManager, selectedSdrId, fetchTasks]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    const handler = () => loadAll();
    window.addEventListener('crm:task-created', handler);
    return () => window.removeEventListener('crm:task-created', handler);
  }, [loadAll]);

  useEffect(() => {
    if (isManager) {
      fetch('/api/users')
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setUsers(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }, [isManager]);

  const completedTodayCount = todayTasks.filter((t) => t.status === 'completed').length;
  const pendingTodayCount = todayTasks.filter((t) => t.status === 'pending').length;

  const handleTaskComplete = (task: Task) => {
    if (task.type === 'phone' || task.type === 'linkedin' || task.type === 'whatsapp') {
      setLoggingTask(task);
      setCallOutcome('no_answer');
      setChannelAction('');
      setResponseReceived(false);
      setResponseStage('');
      setActivityNote('');
      setLoggingModalOpen(true);
    } else {
      submitComplete(task.id, 'completed', '', '');
    }
  };

  const submitComplete = async (
    taskId: string,
    status: 'completed' | 'skipped',
    notes: string,
    outcome: string
  ) => {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, notes, outcome }),
    });
    if (!res.ok) {
      showToast('Failed to update task', 'error');
      return;
    }
    if (status === 'skipped') showToast('Task skipped', 'info');
    else if (status === 'completed') showToast('Task completed ✓', 'success');
    clearDeferred(taskId);
    loadAll();
  };

  const handleLoggingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loggingTask) return;
    const task = loggingTask;
    if ((task.type === 'linkedin' || task.type === 'whatsapp') && !channelAction) return;
    const outcome = task.type === 'phone' ? callOutcome : channelAction;
    const noteWithResponse =
      (task.type === 'linkedin' || task.type === 'whatsapp') && responseReceived
        ? `[Response received] ${activityNote}`.trim()
        : activityNote;
    await submitComplete(task.id, 'completed', noteWithResponse, outcome);
    setLoggingModalOpen(false);
    setLoggingTask(null);

    if (responseStage && (task.type === 'linkedin' || task.type === 'whatsapp')) {
      await fetch(`/api/leads/${task.leadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: responseStage }),
      });
      showToast(`Lead moved to ${responseStage.replace(/_/g, ' ')}`, 'success');
    }
    setResponseStage('');

    if (outcome === 'connected_meeting_booked') {
      setMeetingPrompt(task);
    }

    if (outcome === 'callback_requested') {
      const due = new Date();
      due.setDate(due.getDate() + 1);
      due.setHours(9, 0, 0, 0);
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: task.leadId,
          type: 'phone',
          title: `Callback — ${task.lead.firstName} ${task.lead.lastName}`,
          description: 'Callback requested',
          dueDate: due.toISOString(),
          priority: 'high',
        }),
      });
      showToast('Follow-up callback task created for tomorrow', 'success');
    }

    if (outcome === 'wrong_number' || outcome === 'do_not_call') {
      const lead = task.lead;
      const existingTags: string[] = (lead as any).tags ?? [];
      const tag = outcome === 'do_not_call' ? 'do_not_call' : 'wrong_number';
      if (!existingTags.includes(tag)) {
        await fetch(`/api/leads/${task.leadId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: [...existingTags, tag] }),
        });
      }
      showToast(
        outcome === 'do_not_call' ? 'Lead flagged as Do Not Call' : 'Lead flagged as wrong number',
        'info'
      );
    }
  };

  const handleConfirmMeetingBooked = async () => {
    if (!meetingPrompt) return;
    const res = await fetch(`/api/leads/${meetingPrompt.leadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'meeting_booked' }),
    });
    if (res.ok) showToast('Lead moved to Meeting Booked', 'success');
    else showToast(await readApiError(res, 'Failed to update stage'), 'error');
    setMeetingPrompt(null);
  };

  const clearDeferred = (taskId: string) =>
    setDeferredIds((prev) => {
      if (!prev.has(taskId)) return prev;
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });

  // Skip = defer, not dismiss. The task stays pending and drops to the end of the list so
  // it resurfaces until it's logged & completed or rescheduled (no silent close → no data gap).
  const handleSkip = (task: Task) => {
    setDeferredIds((prev) => new Set(prev).add(task.id));
    showToast('Skipped for now — moved to the end of your list', 'info');
  };

  const handleQuickNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickNoteTask || !quickNoteText.trim()) return;
    setSavingNote(true);
    const res = await fetch(`/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: quickNoteTask.leadId, content: quickNoteText.trim() }),
    });
    setSavingNote(false);
    if (res.ok) {
      showToast('Note added', 'success');
      setQuickNoteTask(null);
      setQuickNoteText('');
    } else {
      showToast('Failed to save note', 'error');
    }
  };

  const handleRescheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rescheduleTask || !newDueDate) return;
    const res = await fetch(`/api/tasks/${rescheduleTask.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueDate: new Date(newDueDate).toISOString() }),
    });
    if (!res.ok) {
      showToast('Failed to reschedule task', 'error');
      return;
    }
    showToast('Task rescheduled ✓', 'success');
    clearDeferred(rescheduleTask.id);
    setRescheduleTask(null);
    setNewDueDate('');
    loadAll();
  };

  const getChannelIcon = (type: Task['type']) => {
    switch (type) {
      case 'email': return <Mail className="w-4 h-4 text-blue-500" />;
      case 'phone': return <PhoneCall className="w-4 h-4 text-green-500" />;
      case 'linkedin': return <MessageSquare className="w-4 h-4 text-indigo-500" />;
      case 'whatsapp': return <MessageSquare className="w-4 h-4 text-teal-500" />;
      default: return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getChannelColor = (type: Task['type']) => {
    switch (type) {
      case 'email': return 'bg-blue-500/5 text-blue-500';
      case 'phone': return 'bg-green-500/5 text-green-500';
      case 'linkedin': return 'bg-indigo-500/5 text-indigo-500';
      case 'whatsapp': return 'bg-teal-500/5 text-teal-500';
      default: return 'bg-gray-500/5 text-gray-500';
    }
  };

  // Skipped-for-now tasks sort to the end of the active work queue while staying pending.
  const orderDeferred = (list: Task[]) => {
    if (deferredIds.size === 0) return list;
    const active = list.filter((t) => !deferredIds.has(t.id));
    const deferred = list.filter((t) => deferredIds.has(t.id));
    return [...active, ...deferred];
  };

  const tabTasks =
    activeTab === 'today'
      ? orderDeferred(todayTasks.filter((t) => t.status === 'pending'))
      : activeTab === 'overdue'
      ? orderDeferred(overdueTasks)
      : yesterdayTasks;

  const matchesFilters = (task: Task) => {
    if (typeFilter !== 'all' && task.type !== typeFilter) return false;
    if (statusFilter !== 'all' && task.status !== statusFilter) return false;
    if (taskPriorityFilter !== 'all' && task.priority !== taskPriorityFilter) return false;
    if (stageFilter !== 'all' && task.lead?.stage !== stageFilter) return false;
    if (campaignFilter !== 'all' && task.lead?.campaign?.id !== campaignFilter) return false;
    if (clientFilter !== 'all' && task.lead?.campaign?.client?.id !== clientFilter) return false;
    if (taskSearch.trim()) {
      const needle = taskSearch.trim().toLowerCase();
      const haystack = [
        task.title,
        task.lead?.firstName,
        task.lead?.lastName,
        task.lead?.company,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  };

  const visibleTasks = tabTasks.filter(matchesFilters);

  const activeFilterCount = [
    typeFilter !== 'all',
    statusFilter !== 'all',
    taskPriorityFilter !== 'all',
    stageFilter !== 'all',
    campaignFilter !== 'all',
    clientFilter !== 'all',
    !!taskSearch.trim(),
  ].filter(Boolean).length;

  const clearTaskFilters = () => {
    setTypeFilter('all');
    setStatusFilter('all');
    setTaskPriorityFilter('all');
    setStageFilter('all');
    setCampaignFilter('all');
    setClientFilter('all');
    setTaskSearch('');
  };

  // Filter option lists come from the loaded tasks, so they only ever offer
  // campaigns/clients the current user can actually see.
  const allLoadedTasks = [...todayTasks, ...yesterdayTasks, ...overdueTasks];
  const campaignOptions = Array.from(
    new Map(
      allLoadedTasks
        .map((t) => t.lead?.campaign)
        .filter((c): c is NonNullable<TaskLead['campaign']> => !!c)
        .map((c) => [c.id, c])
    ).values()
  );
  const clientOptions = Array.from(
    new Map(
      allLoadedTasks
        .map((t) => t.lead?.campaign?.client)
        .filter((c): c is { id: string; name: string } => !!c)
        .map((c) => [c.id, c])
    ).values()
  );

  const selectedTasks = visibleTasks.filter((t) => selectedTaskIds.has(t.id));
  const allVisibleSelected = visibleTasks.length > 0 && selectedTasks.length === visibleTasks.length;

  const toggleTaskSelected = (taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedTaskIds(allVisibleSelected ? new Set() : new Set(visibleTasks.map((t) => t.id)));
  };

  const runBulkAction = async (
    action: 'complete' | 'skip' | 'reschedule' | 'reassign' | 'note',
    extra: Record<string, unknown> = {}
  ) => {
    const taskIds = Array.from(selectedTaskIds);
    if (taskIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch('/api/tasks/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds, action, ...extra }),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Bulk action failed'), 'error');
        return;
      }
      const data = await res.json();
      const failed = Array.isArray(data.failed) ? data.failed.length : 0;
      showToast(
        failed > 0
          ? `${data.updated} task(s) updated · ${failed} skipped (${data.failed[0]?.reason ?? 'not allowed'})`
          : `${data.updated} task(s) updated`,
        failed > 0 && data.updated === 0 ? 'error' : 'success'
      );
      setSelectedTaskIds(new Set());
      setBulkPanel(null);
      setBulkNoteText('');
      setBulkRescheduleDate('');
      setBulkReassignId('');
      loadAll();
    } catch {
      showToast('Network error during bulk action', 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  // ── Global Keyboard Shortcuts Handler ───────────────────────────────────────
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      // Escape always closes top-level dialogs
      if (e.key === 'Escape') {
        if (loggingModalOpen) {
          setLoggingModalOpen(false);
          setLoggingTask(null);
          return;
        }
        if (rescheduleTask) {
          setRescheduleTask(null);
          return;
        }
        if (selectedLeadId) {
          setSelectedLeadId(null);
          return;
        }
        if (showShortcutsHelp) {
          setShowShortcutsHelp(false);
          return;
        }
      }

      // Inside Call/Touch Logging Modal
      if (loggingModalOpen && loggingTask) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          const form = document.querySelector('form[data-modal="call-logger"]') as HTMLFormElement | null;
          if (form) form.requestSubmit();
          return;
        }

        if (!isInput && loggingTask.type === 'phone') {
          if (e.key === '1') { e.preventDefault(); setCallOutcome('no_answer'); }
          else if (e.key === '2') { e.preventDefault(); setCallOutcome('voicemail_left'); }
          else if (e.key === '3') { e.preventDefault(); setCallOutcome('connected_interested'); }
          else if (e.key === '4') { e.preventDefault(); setCallOutcome('callback_requested'); }
          else if (e.key === '5') { e.preventDefault(); setCallOutcome('connected_meeting_booked'); }
        }
        return;
      }

      // If typing inside an input/textarea, do not intercept list navigation
      if (isInput) return;
      if (selectedLeadId || rescheduleTask || meetingPrompt) return;

      // J / Down: Next task
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedTaskIndex((prev) => {
          if (visibleTasks.length === 0) return 0;
          return (prev + 1) % visibleTasks.length;
        });
      }
      // K / Up: Prev task
      else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedTaskIndex((prev) => {
          if (visibleTasks.length === 0) return 0;
          return (prev - 1 + visibleTasks.length) % visibleTasks.length;
        });
      }
      // Enter: Complete / Open Logger
      else if (e.key === 'Enter' || e.key === ' ') {
        if (visibleTasks.length > 0 && visibleTasks[focusedTaskIndex]) {
          e.preventDefault();
          handleTaskComplete(visibleTasks[focusedTaskIndex]);
        }
      }
      // S: Skip
      else if (e.key === 's' || e.key === 'S') {
        if (visibleTasks.length > 0 && visibleTasks[focusedTaskIndex]) {
          e.preventDefault();
          handleSkip(visibleTasks[focusedTaskIndex]);
        }
      }
      // X: Toggle selection checkbox
      else if (e.key === 'x' || e.key === 'X') {
        if (visibleTasks.length > 0 && visibleTasks[focusedTaskIndex]) {
          e.preventDefault();
          toggleTaskSelected(visibleTasks[focusedTaskIndex].id);
        }
      }
      // L: Open lead detail panel
      else if (e.key === 'l' || e.key === 'L') {
        if (visibleTasks.length > 0 && visibleTasks[focusedTaskIndex]?.lead?.id) {
          e.preventDefault();
          setSelectedLeadId(visibleTasks[focusedTaskIndex].lead.id);
        }
      }
      // ?: Toggle Shortcuts Help
      else if (e.key === '?') {
        e.preventDefault();
        setShowShortcutsHelp((v) => !v);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loggingModalOpen,
    loggingTask,
    visibleTasks,
    focusedTaskIndex,
    selectedLeadId,
    rescheduleTask,
    meetingPrompt,
    showShortcutsHelp,
    // `handleSkip` and `handleTaskComplete` are deliberately absent, and this is the one
    // place in this sweep where suppressing beat "fixing". Neither is memoised — they are
    // recreated on every render — so listing them would tear down and re-register this
    // global keydown listener on every render of the dashboard. `handleTaskComplete` is
    // ~120 lines touching a dozen pieces of state, so wrapping it in useCallback means
    // enumerating those deps and getting a callback whose identity churns anyway.
    //
    // Both only read state that is already listed above (`visibleTasks`, `focusedTaskIndex`),
    // so the closure this effect captures is refreshed whenever the keys actually press
    // against different data.
  ]);

  const sdrUsers = users.filter((u) => u.role === 'sdr' || u.role === 'leadgen');

  return (
    <div className="space-y-6 flex-1 flex flex-col">
      {/* Header */}
      <div className="page-hero flex flex-row items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-extrabold text-2xl text-text-primary tracking-tight">
            {!isManager ? 'My Daily Tasks' : 'Team Tasks Dashboard'}
          </h1>
        </div>
        <div className="flex items-center gap-2 self-auto">
          {isManager && sdrUsers.length > 0 && (
            <div className="flex items-center gap-2 bg-card-bg border border-card-border p-1.5 rounded-xl">
              <span className="text-xs font-bold text-text-secondary pl-2">Rep:</span>
              <select
                value={selectedSdrId}
                onChange={(e) => setSelectedSdrId(e.target.value)}
                className="bg-bg-main border border-card-border rounded-lg text-xs font-semibold px-2 py-1 text-text-primary focus:outline-none focus:border-brand-red cursor-pointer"
              >
                <option value="all">All Reps</option>
                {sdrUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                ))}
              </select>
            </div>
          )}
          <button
            onClick={() => setShowShortcutsHelp(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-card-bg border border-card-border rounded-xl text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="w-3.5 h-3.5 text-text-muted" />
            <span className="hidden sm:inline">Shortcuts</span>
            <kbd className="px-1 py-0.2 bg-card-border/50 text-[10px] font-mono rounded text-text-muted">?</kbd>
          </button>
          <button
            onClick={toggleStats}
            className="flex items-center gap-1 px-3 py-1.5 bg-card-bg border border-card-border rounded-xl text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors"
          >
            {showStats ? '◀ Stats' : 'Stats ▸'}
          </button>
        </div>
      </div>

      {/* Slim stat bar */}
      <div className="glass-card rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm font-medium">
        <span className="text-text-primary font-semibold">
          Today {completedTodayCount + pendingTodayCount} tasks
        </span>
        <span className="text-text-muted">·</span>
        <span className="text-text-primary">{completedTodayCount} done</span>
        <span className="text-text-muted">·</span>
        {overdueTasks.length > 0 ? (
          <span className="text-brand-red font-semibold">{overdueTasks.length} overdue</span>
        ) : (
          <span className="text-emerald-500">No overdue</span>
        )}
        {yesterdayTasks.length > 0 && (
          <>
            <span className="text-text-muted">·</span>
            <span className="text-text-muted">
              Yesterday {yesterdayTasks.filter((t) => t.status === 'completed').length}/{yesterdayTasks.length}
            </span>
          </>
        )}
      </div>

      {/* Main Layout */}
      <div className={`grid gap-6 flex-1 items-start ${showStats ? 'grid-cols-3' : 'grid-cols-1'}`}>
        {/* Task Hub */}
        <div className={`glass-card rounded-2xl overflow-hidden flex flex-col ${showStats ? 'col-span-2' : ''}`}>
          <div className="flex items-center px-5 py-4 border-b border-card-border bg-bg-main/25 gap-2">
            {(['today', 'yesterday', 'overdue'] as const).map((tab) => {
              const count =
                tab === 'today' ? pendingTodayCount
                : tab === 'overdue' ? overdueTasks.length
                : yesterdayTasks.length;
              return (
                <button
                  key={tab}
                  onClick={() => { setActiveTab(tab); setSelectedTaskIds(new Set()); setBulkPanel(null); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all capitalize ${
                    activeTab === tab
                      ? 'bg-brand-red/10 text-brand-red border-brand-red/25'
                      : 'bg-transparent text-text-secondary border-transparent hover:text-text-primary'
                  }`}
                >
                  {tab}
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                      tab === 'overdue' && count > 0
                        ? 'bg-brand-red/10 text-brand-red font-bold'
                        : 'bg-card-border text-text-secondary'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Filters (F4A) */}
          <div className="px-5 py-2.5 border-b border-card-border bg-bg-main/10 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={taskSearch}
              onChange={(e) => setTaskSearch(e.target.value)}
              placeholder="Search task or lead..."
              className="w-52 px-2.5 py-1 text-xs bg-bg-main border border-card-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-red"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-bg-main border border-card-border rounded-lg text-xs font-semibold px-2 py-1 text-text-primary focus:outline-none focus:border-brand-red cursor-pointer"
            >
              <option value="all">All channels</option>
              <option value="phone">Call</option>
              <option value="email">Email</option>
              <option value="linkedin">LinkedIn</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="manual">Manual</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-bg-main border border-card-border rounded-lg text-xs font-semibold px-2 py-1 text-text-primary focus:outline-none focus:border-brand-red cursor-pointer"
            >
              <option value="all">Any status</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="skipped">Skipped</option>
            </select>
            <select
              value={taskPriorityFilter}
              onChange={(e) => setTaskPriorityFilter(e.target.value)}
              className="bg-bg-main border border-card-border rounded-lg text-xs font-semibold px-2 py-1 text-text-primary focus:outline-none focus:border-brand-red cursor-pointer"
            >
              <option value="all">Any priority</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="bg-bg-main border border-card-border rounded-lg text-xs font-semibold px-2 py-1 text-text-primary focus:outline-none focus:border-brand-red cursor-pointer"
            >
              <option value="all">Any stage</option>
              <option value="new">New</option>
              <option value="sequence_active">Sequence Active</option>
              <option value="replied">Replied</option>
              <option value="meeting_booked">Meeting Booked</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
            {clientOptions.length > 1 && (
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className="bg-bg-main border border-card-border rounded-lg text-xs font-semibold px-2 py-1 text-text-primary focus:outline-none focus:border-brand-red cursor-pointer"
              >
                <option value="all">All clients</option>
                {clientOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            {campaignOptions.length > 1 && (
              <select
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
                className="bg-bg-main border border-card-border rounded-lg text-xs font-semibold px-2 py-1 text-text-primary focus:outline-none focus:border-brand-red cursor-pointer"
              >
                <option value="all">All campaigns</option>
                {campaignOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            {activeFilterCount > 0 && (
              <button
                onClick={clearTaskFilters}
                className="text-xs font-mono text-brand-red hover:underline whitespace-nowrap"
              >
                Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
              </button>
            )}
            <span className="ml-auto text-[10px] font-mono text-text-muted">
              {visibleTasks.length} of {tabTasks.length}
            </span>
          </div>

          {/* Bulk selection bar (F4B) */}
          <div className="px-5 py-2 border-b border-card-border flex flex-wrap items-center gap-2 bg-bg-main/25">
            <label className="flex items-center gap-2 text-xs font-semibold text-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                disabled={visibleTasks.length === 0}
                className="w-3.5 h-3.5 accent-brand-red cursor-pointer"
              />
              Select all visible
            </label>
            {selectedTasks.length > 0 && (
              <>
                <span className="text-xs font-bold text-brand-red font-mono">
                  {selectedTasks.length} selected
                </span>
                <button
                  onClick={() => runBulkAction('complete')}
                  disabled={bulkBusy}
                  className="px-2.5 py-1 bg-green-500/10 border border-green-500/20 text-green-600 hover:bg-green-500 hover:text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                >
                  Complete
                </button>
                <button
                  onClick={() => runBulkAction('skip')}
                  disabled={bulkBusy}
                  className="px-2.5 py-1 bg-card-border/30 hover:bg-card-border text-text-secondary rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                >
                  Skip
                </button>
                <button
                  onClick={() => setBulkPanel(bulkPanel === 'reschedule' ? null : 'reschedule')}
                  disabled={bulkBusy}
                  className="px-2.5 py-1 bg-card-border/30 hover:bg-card-border text-text-secondary rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                >
                  Reschedule
                </button>
                {isManager && (
                  <button
                    onClick={() => setBulkPanel(bulkPanel === 'reassign' ? null : 'reassign')}
                    disabled={bulkBusy}
                    className="px-2.5 py-1 bg-card-border/30 hover:bg-card-border text-text-secondary rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                  >
                    Reassign
                  </button>
                )}
                <button
                  onClick={() => setBulkPanel(bulkPanel === 'note' ? null : 'note')}
                  disabled={bulkBusy}
                  className="px-2.5 py-1 bg-card-border/30 hover:bg-card-border text-text-secondary rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                >
                  Add note
                </button>
                <button
                  onClick={() => { setSelectedTaskIds(new Set()); setBulkPanel(null); }}
                  className="text-xs font-mono text-text-muted hover:text-text-primary"
                >
                  Clear
                </button>
              </>
            )}
          </div>

          {bulkPanel && selectedTasks.length > 0 && (
            <div className="px-5 py-2.5 border-b border-card-border bg-bg-main/40 flex flex-wrap items-center gap-2">
              {bulkPanel === 'reschedule' && (
                <>
                  <input
                    type="datetime-local"
                    value={bulkRescheduleDate}
                    onChange={(e) => setBulkRescheduleDate(e.target.value)}
                    className="px-2 py-1 text-xs bg-bg-main border border-card-border rounded-lg text-text-primary focus:outline-none focus:border-brand-red"
                  />
                  <button
                    onClick={() =>
                      runBulkAction('reschedule', { dueDate: new Date(bulkRescheduleDate).toISOString() })
                    }
                    disabled={!bulkRescheduleDate || bulkBusy}
                    className="px-2.5 py-1 bg-brand-red text-white rounded-lg text-xs font-bold disabled:opacity-40"
                  >
                    Move {selectedTasks.length} task{selectedTasks.length === 1 ? '' : 's'}
                  </button>
                </>
              )}
              {bulkPanel === 'reassign' && (
                <>
                  <select
                    value={bulkReassignId}
                    onChange={(e) => setBulkReassignId(e.target.value)}
                    className="bg-bg-main border border-card-border rounded-lg text-xs font-semibold px-2 py-1 text-text-primary focus:outline-none focus:border-brand-red cursor-pointer"
                  >
                    <option value="">Choose rep...</option>
                    {sdrUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => runBulkAction('reassign', { userId: bulkReassignId })}
                    disabled={!bulkReassignId || bulkBusy}
                    className="px-2.5 py-1 bg-brand-red text-white rounded-lg text-xs font-bold disabled:opacity-40"
                  >
                    Reassign {selectedTasks.length}
                  </button>
                </>
              )}
              {bulkPanel === 'note' && (
                <>
                  <input
                    type="text"
                    value={bulkNoteText}
                    onChange={(e) => setBulkNoteText(e.target.value)}
                    placeholder="Note added to each selected lead..."
                    className="flex-1 min-w-[240px] px-2.5 py-1 text-xs bg-bg-main border border-card-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-red"
                  />
                  <button
                    onClick={() => runBulkAction('note', { note: bulkNoteText })}
                    disabled={!bulkNoteText.trim() || bulkBusy}
                    className="px-2.5 py-1 bg-brand-red text-white rounded-lg text-xs font-bold disabled:opacity-40"
                  >
                    Add to {selectedTasks.length}
                  </button>
                </>
              )}
            </div>
          )}

          <div className="divide-y divide-card-border max-h-[600px] overflow-y-auto">
            {visibleTasks.length === 0 && tabTasks.length > 0 && (
              <div className="p-10 text-center text-xs text-text-muted space-y-2">
                <p className="font-semibold text-text-primary">No tasks match the active filters.</p>
                <button onClick={clearTaskFilters} className="text-brand-red font-mono hover:underline">
                  Clear filters
                </button>
              </div>
            )}

            {tabTasks.length === 0 && (
              <div className="p-10 text-center text-xs text-text-muted space-y-2">
                <div className="flex justify-center text-text-muted mb-2">
                  {activeTab === 'overdue' ? <CheckCircle className="w-12 h-12" /> : <PartyPopper className="w-12 h-12" />}
                </div>
                <p className="font-semibold text-text-primary">
                  {activeTab === 'today'
                    ? 'All done for today!'
                    : activeTab === 'overdue'
                    ? 'No overdue tasks!'
                    : 'No tasks from yesterday.'}
                </p>
              </div>
            )}

            {visibleTasks.map((task, idx) => {
              const isHot = task.lead?.priority === 'hot';
              const isFocused = idx === focusedTaskIndex;
              return (
                <div
                  key={task.id}
                  onClick={() => setFocusedTaskIndex(idx)}
                  className={`p-4 transition-all flex flex-row items-center justify-between gap-3 group cursor-pointer ${
                    isFocused
                      ? 'bg-brand-red/[0.04] border-l-2 border-l-brand-red'
                      : 'hover:bg-bg-main/40 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.has(task.id)}
                      onChange={() => toggleTaskSelected(task.id)}
                      aria-label={`Select task ${task.title}`}
                      className="w-3.5 h-3.5 mt-2.5 accent-brand-red cursor-pointer flex-shrink-0"
                    />
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${getChannelColor(task.type)}`}
                    >
                      {getChannelIcon(task.type)}
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => setSelectedLeadId(task.lead?.id)}
                          className="font-display font-bold text-sm text-text-primary hover:text-brand-red hover:underline text-left"
                        >
                          {task.lead?.firstName} {task.lead?.lastName}
                        </button>
                        <span className="text-xs text-text-muted">{task.lead?.company}</span>
                        {isHot && (
                          <span className="text-brand-red text-xs font-bold flex items-center gap-1">
                            <Flame className="w-3.5 h-3.5" /> HOT
                          </span>
                        )}
                        {task.type === 'phone' && task.lead?.tags?.includes('do_not_call') && (
                          <span className="text-brand-red text-xs font-bold flex items-center gap-1">
                            <PhoneOff className="w-3.5 h-3.5" /> DNC
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary truncate flex items-center gap-2">
                        {task.title}
                        {activeTab === 'overdue' && (
                          <span className="text-[10px] font-bold text-brand-red uppercase tracking-wide">
                            • Overdue
                          </span>
                        )}
                        {deferredIds.has(task.id) && (
                          <span className="text-[10px] font-semibold text-text-muted italic">
                            (skipped)
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 self-auto flex-shrink-0">
                    {task.status === 'pending' ? (
                      <>
                        <button
                          onClick={() => handleTaskComplete(task)}
                          className="px-3 py-1.5 bg-green-500/10 border border-green-500/20 text-green-600 hover:bg-green-500 hover:text-white rounded-lg transition-all flex items-center gap-1 text-xs font-bold active:scale-95"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {['phone', 'linkedin', 'whatsapp'].includes(task.type) ? 'Log & Complete' : 'Complete'}
                        </button>
                        <button
                          onClick={() => handleSkip(task)}
                          className="px-2.5 py-1.5 bg-card-border/30 hover:bg-card-border text-text-secondary rounded-lg transition-all text-xs font-semibold active:scale-95"
                        >
                          Skip
                        </button>
                        {/* ··· overflow menu */}
                        <div className="relative">
                          <button
                            onClick={() => setOverflowOpenId(overflowOpenId === task.id ? null : task.id)}
                            className="p-1.5 bg-card-border/30 hover:bg-card-border text-text-secondary rounded-lg transition-all active:scale-95"
                            title="More options"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                          {overflowOpenId === task.id && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setOverflowOpenId(null)} />
                              <div className="absolute right-0 top-full mt-1 w-40 bg-card-bg border border-card-border rounded-xl shadow-lg z-20 py-1 text-xs overflow-hidden">
                                <button
                                  onClick={() => {
                                    setQuickNoteTask(quickNoteTask?.id === task.id ? null : task);
                                    setQuickNoteText('');
                                    setOverflowOpenId(null);
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-bg-main text-text-primary flex items-center gap-2 transition-colors"
                                >
                                  <FileText className="w-3.5 h-3.5 text-amber-500" /> Add Note
                                </button>
                                <button
                                  onClick={() => {
                                    setRescheduleTask(task);
                                    setNewDueDate('');
                                    setOverflowOpenId(null);
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-bg-main text-text-primary flex items-center gap-2 transition-colors"
                                >
                                  <Clock className="w-3.5 h-3.5 text-blue-500" /> Reschedule
                                </button>
                                <button
                                  onClick={() => {
                                    setSelectedLeadId(task.lead?.id);
                                    setOverflowOpenId(null);
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-bg-main text-text-primary flex items-center gap-2 transition-colors"
                                >
                                  <Users className="w-3.5 h-3.5 text-text-muted" /> View Lead
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </>
                    ) : (
                      <span
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border ${
                          task.status === 'completed'
                            ? 'bg-green-500/15 text-green-500 border-green-500/20'
                            : 'bg-card-border text-text-secondary border-transparent'
                        }`}
                      >
                        {task.status.toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Quick Note inline form */}
                  {quickNoteTask?.id === task.id && (
                    <form onSubmit={handleQuickNoteSubmit} className="mt-2 flex gap-2 w-full">
                      <input
                        type="text"
                        value={quickNoteText}
                        onChange={(e) => setQuickNoteText(e.target.value)}
                        placeholder={`Add note for ${task.lead?.firstName}…`}
                        autoFocus
                        className="flex-1 bg-bg-main border border-amber-500/30 rounded-lg px-2.5 py-1.5 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="submit"
                        disabled={savingNote || !quickNoteText.trim()}
                        className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-600 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
                      >
                        {savingNote ? '…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setQuickNoteTask(null); setQuickNoteText(''); }}
                        className="px-2 py-1.5 text-text-muted hover:text-text-primary text-xs transition-colors"
                      >
                        ✕
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right column: stats panel (toggleable) */}
        {showStats && (
          <div className="space-y-6">
            {!isManager && (
              <div className="glass-card rounded-2xl p-5 space-y-4">
                <h2 className="type-section text-text-primary flex items-center gap-2">
                  <Award className="w-5 h-5 text-brand-gold-text" aria-hidden="true" />
                  My Performance
                </h2>
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    { label: 'Calls', count: activities.filter((a) => a.type === 'call_logged').length, color: 'text-emerald-500' },
                    { label: 'Emails', count: activities.filter((a) => a.type === 'email_sent').length, color: 'text-blue-500' },
                    { label: 'LinkedIn', count: activities.filter((a) => a.type === 'linkedin_touch').length, color: 'text-indigo-500' },
                  ].map(({ label, count, color }) => (
                    <div key={label} className="bg-bg-main/60 border border-card-border rounded-xl p-3">
                      <p className={`font-display font-extrabold text-xl ${color}`}>{count}</p>
                      <span className="text-xs font-medium text-text-secondary">{label}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-bold text-text-primary">Pipeline Summary</p>
                  {(() => {
                    const stages = ['new', 'sequence_active', 'replied', 'meeting_booked', 'won', 'lost'] as const;
                    const totalLeads = stages.reduce((s, st) => s + (sdrPipelineCounts[st] ?? 0), 0) || 1;
                    const labels: Record<string, string> = { new: 'New', sequence_active: 'Active', replied: 'Replied', meeting_booked: 'Meeting', won: 'Won', lost: 'Lost' };
                    const colors: Record<string, string> = { new: 'bg-text-muted/50', sequence_active: 'bg-blue-500', replied: 'bg-amber-500', meeting_booked: 'bg-emerald-500', won: 'bg-green-500', lost: 'bg-brand-red' };
                    return stages
                      .filter((st) => (sdrPipelineCounts[st] ?? 0) > 0 || ['new', 'sequence_active', 'replied', 'meeting_booked'].includes(st))
                      .map((stage) => {
                        const count = sdrPipelineCounts[stage] ?? 0;
                        const pct = Math.round((count / totalLeads) * 100);
                        return (
                          <div key={stage} className="flex items-center gap-2">
                            <span className="text-xs w-16 text-text-secondary">{labels[stage]}</span>
                            <div className="flex-1 h-1.5 bg-card-border rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${colors[stage]} transition-all`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-text-secondary w-5 text-right">{count}</span>
                          </div>
                        );
                      });
                  })()}
                </div>
              </div>
            )}

            <div className="glass-card rounded-2xl p-5 space-y-4">
              <h2 className="type-section text-text-primary flex items-center gap-2">
                <BarChart className="w-5 h-5 text-brand-orange-text" aria-hidden="true" />
                Recent Activity Feed
              </h2>
              <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
                {activities.length === 0 ? (
                  <p className="text-xs text-text-muted text-center py-4">No activities logged yet.</p>
                ) : (
                  activities.map((act) => (
                    <div key={act.id} className="flex gap-2.5 text-xs pb-1">
                      <div className="mt-0.5 flex-shrink-0">
                        {act.type === 'meeting_booked' ? <PartyPopper className="w-4 h-4 text-emerald-500" />
                          : act.type === 'email_sent' ? <Mail className="w-4 h-4 text-blue-500" />
                          : act.type === 'call_logged' ? <PhoneCall className="w-4 h-4 text-green-500" />
                          : act.type === 'linkedin_touch' ? <Briefcase className="w-4 h-4 text-indigo-500" />
                          : <Zap className="w-4 h-4 text-amber-500" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-text-primary leading-normal">
                          <span className="font-semibold">{act.user?.firstName}</span>{' '}{act.description || act.type?.replace(/_/g, ' ')}
                        </p>
                        {act.metadata?.outcome && (
                          <p className="text-xs text-text-secondary mt-0.5">Outcome: {act.metadata.outcome}</p>
                        )}
                        <span className="text-xs text-text-secondary block mt-0.5">
                          {formatActivityTimestamp(act.createdAt)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedLeadId && (
        <LeadDetailPanel leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} />
      )}

      {/* Meeting Booked follow-up prompt */}
      {meetingPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMeetingPrompt(null)} />
          <div className="relative glass-card rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4" role="dialog" aria-modal="true">
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-2"><PartyPopper className="w-12 h-12 text-emerald-500" /></div>
              <h2 className="font-display font-bold text-base text-text-primary">Meeting Booked!</h2>
              <p className="text-xs text-text-secondary leading-relaxed">
                Move <span className="font-semibold text-text-primary">{meetingPrompt.lead.firstName} {meetingPrompt.lead.lastName}</span> to{' '}
                <span className="text-emerald-500 font-semibold">Meeting Booked</span> stage?
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setMeetingPrompt(null)}
                className="flex-1 py-2 text-xs font-semibold text-text-muted hover:text-text-primary border border-card-border rounded-lg transition-colors"
              >
                Not yet
              </button>
              <button
                onClick={handleConfirmMeetingBooked}
                className="flex-1 py-2 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg shadow-sm transition-colors"
              >
                Yes, move stage
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Call / Activity Logging Modal */}
      {loggingModalOpen && loggingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setLoggingModalOpen(false)} />
          <form
            data-modal="call-logger"
            onSubmit={handleLoggingSubmit}
            className="glass-card rounded-2xl shadow-xl w-full max-w-md relative z-10 p-5 space-y-4"
          >
            <div>
              <h2 className="font-display font-bold text-base text-text-primary">
                {loggingTask.type === 'phone'
                  ? <span className="flex items-center gap-2"><PhoneCall className="w-5 h-5 text-brand-red" /> Log Call</span>
                  : loggingTask.type === 'linkedin'
                  ? <span className="flex items-center gap-2"><Briefcase className="w-5 h-5 text-brand-red" /> Log LinkedIn Touch</span>
                  : <span className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-brand-red" /> Log WhatsApp Touch</span>}
              </h2>
              <p className="text-xs text-text-secondary mt-0.5">
                <span className="font-semibold">{loggingTask.lead.firstName} {loggingTask.lead.lastName}</span>
                <span className="text-text-muted"> · {loggingTask.lead.company}</span>
              </p>
            </div>

            {/* Phone outcome — 9 options (SKILL.md §21) with hotkeys */}
            {loggingTask.type === 'phone' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-text-secondary block">
                    Call Outcome <span className="text-brand-red">*</span>
                  </label>
                  <span className="text-[10px] font-mono text-text-muted">Hotkeys: [1] - [5]</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2 text-[10px] font-bold text-text-muted uppercase tracking-wider mt-1 flex items-center justify-between">
                    <span>No Contact</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCallOutcome('no_answer')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold text-center border transition-all flex items-center justify-between ${
                      callOutcome === 'no_answer'
                        ? 'bg-brand-red/10 border-brand-red/30 text-brand-red shadow-sm'
                        : 'bg-bg-main border-card-border text-text-secondary hover:border-brand-red/30 hover:text-text-primary'
                    }`}
                  >
                    <span>No Answer</span>
                    <kbd className="text-[9px] font-mono opacity-60 bg-card-border/40 px-1 rounded">[1]</kbd>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCallOutcome('voicemail_left')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold text-center border transition-all flex items-center justify-between ${
                      callOutcome === 'voicemail_left'
                        ? 'bg-brand-red/10 border-brand-red/30 text-brand-red shadow-sm'
                        : 'bg-bg-main border-card-border text-text-secondary hover:border-brand-red/30 hover:text-text-primary'
                    }`}
                  >
                    <span>Voicemail Left</span>
                    <kbd className="text-[9px] font-mono opacity-60 bg-card-border/40 px-1 rounded">[2]</kbd>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCallOutcome('voicemail_not_left')}
                    className={`col-span-2 py-1.5 px-2 rounded-lg text-xs font-semibold text-center border transition-all ${
                      callOutcome === 'voicemail_not_left'
                        ? 'bg-brand-red/10 border-brand-red/30 text-brand-red shadow-sm'
                        : 'bg-bg-main border-card-border text-text-secondary hover:border-brand-red/30 hover:text-text-primary'
                    }`}
                  >
                    Went to Voicemail — No Message
                  </button>

                  <div className="col-span-2 text-[10px] font-bold text-text-muted uppercase tracking-wider mt-1">Connected</div>
                  <button
                    type="button"
                    onClick={() => setCallOutcome('connected_interested')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold text-center border transition-all flex items-center justify-between ${
                      callOutcome === 'connected_interested'
                        ? 'bg-green-500/15 border-green-500/40 text-green-500 shadow-sm'
                        : 'bg-bg-main border-card-border text-text-secondary hover:border-green-500/30 hover:text-text-primary'
                    }`}
                  >
                    <span>Interested</span>
                    <kbd className="text-[9px] font-mono opacity-60 bg-card-border/40 px-1 rounded">[3]</kbd>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCallOutcome('connected_not_interested')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold text-center border transition-all ${
                      callOutcome === 'connected_not_interested'
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-500 shadow-sm'
                        : 'bg-bg-main border-card-border text-text-secondary hover:border-amber-500/30 hover:text-text-primary'
                    }`}
                  >
                    Not Interested
                  </button>
                  <button
                    type="button"
                    onClick={() => setCallOutcome('callback_requested')}
                    className={`col-span-2 py-1.5 px-2 rounded-lg text-xs font-semibold text-center border transition-all flex items-center justify-between ${
                      callOutcome === 'callback_requested'
                        ? 'bg-blue-500/15 border-blue-500/40 text-blue-500 shadow-sm'
                        : 'bg-bg-main border-card-border text-text-secondary hover:border-blue-500/30 hover:text-text-primary'
                    }`}
                  >
                    <span>Call Back Requested</span>
                    <kbd className="text-[9px] font-mono opacity-60 bg-card-border/40 px-1 rounded">[4]</kbd>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCallOutcome('connected_meeting_booked')}
                    className={`col-span-2 py-1.5 px-2 rounded-lg text-xs font-bold text-center border transition-all flex items-center justify-between ${
                      callOutcome === 'connected_meeting_booked'
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400 shadow-sm'
                        : 'bg-bg-main border-card-border text-text-secondary hover:border-emerald-500/30 hover:text-text-primary'
                    }`}
                  >
                    <span>Meeting Booked</span>
                    <kbd className="text-[9px] font-mono opacity-60 bg-card-border/40 px-1 rounded">[5]</kbd>
                  </button>

                  <div className="col-span-2 text-[10px] font-bold text-text-muted uppercase tracking-wider mt-1">Bad Data</div>
                  <button type="button" onClick={() => setCallOutcome('wrong_number')} className={`py-1.5 px-2 rounded-lg text-xs font-semibold text-center border transition-colors ${callOutcome === 'wrong_number' ? 'bg-card-border/40 border-card-border text-text-primary' : 'bg-bg-main border-card-border text-text-secondary hover:border-card-border hover:text-text-primary'}`}>Wrong Number</button>
                  <button type="button" onClick={() => setCallOutcome('do_not_call')} className={`py-1.5 px-2 rounded-lg text-xs font-semibold text-center border transition-colors ${callOutcome === 'do_not_call' ? 'bg-card-border/40 border-card-border text-text-primary' : 'bg-bg-main border-card-border text-text-secondary hover:border-card-border hover:text-text-primary'}`}>Do Not Call</button>
                </div>
                {callOutcome === 'connected_meeting_booked' && (
                  <p className="text-xs text-emerald-500 font-medium">→ You'll be prompted to move this lead to Meeting Booked.</p>
                )}
                {callOutcome === 'callback_requested' && (
                  <p className="text-xs text-brand-orange-text font-medium">→ A follow-up call task will be created for tomorrow.</p>
                )}
                {(callOutcome === 'wrong_number' || callOutcome === 'do_not_call') && (
                  <p className="text-xs text-text-secondary font-medium">→ The lead will be flagged.</p>
                )}
              </div>
            )}

            {/* LinkedIn — 3 options */}
            {loggingTask.type === 'linkedin' && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-text-secondary block">
                  Action Type <span className="text-brand-red">*</span>
                </label>
                <select
                  value={channelAction}
                  onChange={(e) => setChannelAction(e.target.value)}
                  required
                  className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-2 text-xs text-text-primary focus:outline-none focus:border-indigo-500"
                >
                  <option value="">— Select action —</option>
                  <option value="message_sent">Message Sent</option>
                  <option value="connection_request">Connection Request Sent</option>
                  <option value="replied">Replied</option>
                </select>
              </div>
            )}

            {/* WhatsApp — 3 options */}
            {loggingTask.type === 'whatsapp' && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-text-secondary block">
                  Message Type <span className="text-brand-red">*</span>
                </label>
                <select
                  value={channelAction}
                  onChange={(e) => setChannelAction(e.target.value)}
                  required
                  className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-2 text-xs text-text-primary focus:outline-none focus:border-teal-500"
                >
                  <option value="">— Select type —</option>
                  <option value="first_message">Message Sent</option>
                  <option value="replied">Replied</option>
                  <option value="no_response">No Response</option>
                </select>
              </div>
            )}

            {/* LinkedIn / WhatsApp: response toggle + stage advance */}
            {(loggingTask.type === 'linkedin' || loggingTask.type === 'whatsapp') && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => { setResponseReceived((v) => !v); setResponseStage(''); }}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${responseReceived ? 'bg-emerald-500' : 'bg-card-border'}`}
                    aria-pressed={responseReceived}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${responseReceived ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </button>
                  <label
                    className="text-xs text-text-secondary cursor-pointer"
                    onClick={() => { setResponseReceived((v) => !v); setResponseStage(''); }}
                  >
                    Response received from prospect
                  </label>
                </div>
                {responseReceived && (
                  <div className="pl-12">
                    <label className="text-xs font-semibold text-text-secondary block mb-1">Advance lead stage?</label>
                    <select
                      value={responseStage}
                      onChange={(e) => setResponseStage(e.target.value)}
                      className="w-full bg-bg-main border border-emerald-500/30 rounded-lg px-2.5 py-2 text-xs text-text-primary focus:outline-none focus:border-emerald-500"
                    >
                      <option value="">— Keep current stage —</option>
                      <option value="replied">Replied</option>
                      <option value="meeting_booked">Meeting Booked</option>
                      <option value="won">Won</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-text-muted uppercase block">Notes</label>
              <textarea
                placeholder={
                  loggingTask.type === 'phone'
                    ? 'Prospect reaction, objections, next steps...'
                    : loggingTask.type === 'linkedin'
                    ? 'What was communicated, engagement...'
                    : 'Message content, prospect response...'
                }
                value={activityNote}
                onChange={(e) => setActivityNote(e.target.value)}
                className="w-full bg-bg-main border border-card-border rounded-lg p-2.5 text-xs text-text-primary focus:outline-none focus:border-brand-red h-20 placeholder-text-muted resize-none"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setLoggingModalOpen(false); setLoggingTask(null); }}
                className="flex-1 py-2.5 bg-card-border/30 hover:bg-card-border/50 text-text-secondary text-xs font-semibold rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors"
              >
                <Check className="w-4 h-4" aria-hidden="true" />
                <span>Submit &amp; Complete</span>
                <kbd className="text-[9px] font-mono bg-white/20 px-1 py-0.5 rounded ml-1">Ctrl+↵</kbd>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reschedule Modal */}
      {rescheduleTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => { setRescheduleTask(null); setNewDueDate(''); }}
          />
          <form
            onSubmit={handleRescheduleSubmit}
            className="bg-card-bg border border-card-border rounded-2xl shadow-xl w-full max-w-sm relative z-10 p-5 space-y-4"
          >
            <h2 className="font-display font-bold text-base text-text-primary flex items-center gap-2">
              <Calendar className="w-4 h-4 text-brand-orange-text" /> Reschedule Task
            </h2>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-text-muted uppercase block">New Due Date &amp; Time</label>
              <input
                type="datetime-local"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-2 text-xs text-text-primary focus:outline-none focus:border-brand-red"
                required
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setRescheduleTask(null); setNewDueDate(''); }}
                className="flex-1 py-2 bg-card-border/30 hover:bg-card-border/50 text-text-secondary text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg"
              >
                Save Schedule
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Keyboard Shortcuts Cheat Sheet Modal */}
      {showShortcutsHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowShortcutsHelp(false)} />
          <div className="relative glass-card rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 border border-card-border bg-card-bg">
            <div className="flex items-center justify-between pb-3 border-b border-card-border">
              <div className="flex items-center gap-2">
                <Keyboard className="w-5 h-5 text-brand-red" />
                <h3 className="font-display font-bold text-sm text-text-primary">SDR Keyboard Shortcuts</h3>
              </div>
              <button
                onClick={() => setShowShortcutsHelp(false)}
                className="text-xs font-mono text-text-muted hover:text-text-primary"
              >
                ✕ Esc
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="space-y-2">
                <div className="text-[10px] uppercase text-text-muted font-bold">Task Queue Navigation</div>
                <div className="flex items-center justify-between py-1 border-b border-card-border/40">
                  <span className="text-text-secondary">Next / Previous task</span>
                  <span className="flex gap-1"><kbd className="px-1.5 py-0.5 bg-card-border rounded font-mono text-text-primary">J</kbd> / <kbd className="px-1.5 py-0.5 bg-card-border rounded font-mono text-text-primary">K</kbd> or <kbd className="px-1.5 py-0.5 bg-card-border rounded font-mono text-text-primary">↓</kbd> <kbd className="px-1.5 py-0.5 bg-card-border rounded font-mono text-text-primary">↑</kbd></span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-card-border/40">
                  <span className="text-text-secondary">Open task logger / Complete</span>
                  <kbd className="px-1.5 py-0.5 bg-card-border rounded font-mono text-text-primary">Enter</kbd>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-card-border/40">
                  <span className="text-text-secondary">Skip task for today</span>
                  <kbd className="px-1.5 py-0.5 bg-card-border rounded font-mono text-text-primary">S</kbd>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-card-border/40">
                  <span className="text-text-secondary">Select checkbox (bulk mode)</span>
                  <kbd className="px-1.5 py-0.5 bg-card-border rounded font-mono text-text-primary">X</kbd>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-text-secondary">Open Lead Detail slideover</span>
                  <kbd className="px-1.5 py-0.5 bg-card-border rounded font-mono text-text-primary">L</kbd>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="text-[10px] uppercase text-text-muted font-bold">Call Logger Modal</div>
                <div className="flex items-center justify-between py-1 border-b border-card-border/40">
                  <span className="text-text-secondary">Select outcome 1–5</span>
                  <span className="flex gap-1"><kbd className="px-1.5 py-0.5 bg-card-border rounded font-mono text-text-primary">1</kbd>–<kbd className="px-1.5 py-0.5 bg-card-border rounded font-mono text-text-primary">5</kbd></span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-text-secondary">Submit &amp; Advance</span>
                  <kbd className="px-1.5 py-0.5 bg-card-border rounded font-mono text-text-primary">Ctrl + Enter</kbd>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowShortcutsHelp(false)}
              className="w-full py-2 bg-brand-red text-white text-xs font-bold rounded-xl mt-2"
            >
              Got it!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
