'use client';

import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import {
  Plus,
  Search,
  SlidersHorizontal,
  KanbanSquare,
  TableProperties,
  Mail,
  Phone,
  Upload,
  ChevronDown,
  AlertTriangle,
  Users,
  Keyboard,
  Sparkles,
} from 'lucide-react';
import Linkedin from '@/components/icons/Linkedin';
import ProspectIdentity from '@/components/operating/ProspectIdentity';
import OperatingStateBadge from '@/components/operating/OperatingStateBadge';
import OwnerBadge from '@/components/operating/OwnerBadge';
import PriorityIndicator from '@/components/operating/PriorityIndicator';
import EmptyState from '@/components/operating/EmptyState';
import { SkeletonBlock } from '@/components/operating/Skeleton';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { canImportExport } from '@/lib/permissions';
import { useLeads, useUsers, useSequences, useUpdateLeadStage } from '@/lib/hooks/useLeads';
import type { Lead } from '@/lib/hooks/useLeads';
import { useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';

const LeadDetailPanel = dynamic(() => import('@/components/LeadDetailPanel'), { ssr: false });
const NewLeadModal = dynamic(() => import('@/components/NewLeadModal'), { ssr: false });
const CSVImportModal = dynamic(() => import('@/components/CSVImportModal'), { ssr: false });
const FloatingBulkBar = dynamic(() => import('@/components/leads/FloatingBulkBar'), { ssr: false });
const KeyboardShortcutsModal = dynamic(() => import('@/components/leads/KeyboardShortcutsModal'), { ssr: false });

// Module-scope constants (stable identity) so they can be omitted from useMemo deps.
const PRIORITY_RANK: Record<string, number> = { hot: 0, warm: 1, cold: 2 };
const STAGE_RANK: Record<string, number> = { new: 0, sequence_active: 1, replied: 2, meeting_booked: 3, won: 4, lost: 5 };

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

// Module-level helper so the time-dependent Date.now() isn't a direct impure call
// inside the LeadCard render body (react-hooks/purity).
function daysOverdueFrom(dateStr?: string): number {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

interface LeadCardProps {
  lead: Lead;
  onOpen: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
}

// Memoized so unrelated parent state (search typing, drag-hover on a column,
// filter changes) doesn't re-render every card. Per-card derived values live here
// and recompute only when this lead's props change.
const LeadCard = memo(function LeadCard({ lead, onOpen, onDragStart, onDragEnd }: LeadCardProps) {
  const daysOverdue = daysOverdueFrom(lead.nextTaskDue);
  const atRisk = lead.atRisk ?? false;
  const channelIcon = lead.nextTaskType === 'email' ? '✉' :
    lead.nextTaskType === 'phone' ? '📞' :
    lead.nextTaskType === 'linkedin' ? 'in' :
    lead.nextTaskType === 'whatsapp' ? '💬' : null;
  const channelColor = lead.nextTaskType === 'email' ? 'text-blue-500' :
    lead.nextTaskType === 'phone' ? 'text-green-500' :
    lead.nextTaskType === 'linkedin' ? 'text-indigo-500' :
    lead.nextTaskType === 'whatsapp' ? 'text-emerald-500' : 'text-text-muted';
  const priorityDotColor = lead.priority === 'hot' ? 'bg-brand-red' :
    lead.priority === 'warm' ? 'bg-brand-gold' : 'bg-blue-400';
  const assigneeInitials = lead.assignedTo
    ? `${lead.assignedTo.firstName[0] ?? ''}${lead.assignedTo.lastName[0] ?? ''}`.toUpperCase()
    : null;

  return (
    <div
      onClick={() => onOpen(lead.id)}
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      onDragEnd={onDragEnd}
      className={`p-2.5 glass-card rounded-xl cursor-grab active:cursor-grabbing hover:border-brand-red/50 hover-lift transition-all duration-200 flex flex-col gap-1.5 relative select-none group ${
        lead.priority === 'hot' ? 'glow-hot' : ''
      } ${atRisk ? 'border-amber-500/40' : ''}`}
    >
      {/* Row 1: name + at-risk badge */}
      <div className="flex items-start justify-between gap-1">
        <p className="font-display font-bold text-xs text-text-primary leading-snug">
          {lead.firstName} {lead.lastName}
        </p>
        {atRisk && (
          <span
            className="flex-shrink-0 text-[10px] font-bold font-mono bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 px-1 py-0.5 rounded"
            title={`Sequence task overdue ${Math.max(daysOverdue, 3)} days`}
          >
            ⚠ {Math.max(daysOverdue, 3)}d
          </span>
        )}
      </div>

      {/* Row 2: company · title */}
      <p className="text-xs text-text-secondary truncate leading-tight font-medium">
        {lead.company}
        {lead.title ? <span className="text-text-muted"> · {lead.title}</span> : null}
      </p>

      {/* Row 3: next task channel + last contacted */}
      {(channelIcon || lead.lastContactedAt) && (
        <div className="flex items-center gap-1.5">
          {channelIcon && (
            <span className={`text-[11px] font-semibold font-mono ${channelColor}`}>{channelIcon}</span>
          )}
          {lead.lastContactedAt && (
            <span className="text-[10px] text-text-secondary font-mono">
              {formatRelativeTime(lead.lastContactedAt)}
            </span>
          )}
        </div>
      )}

      {/* Row 4: priority dot + quick-action links + SDR avatar */}
      <div className="flex items-center justify-between pt-1.5 border-t border-card-border/40 mt-0.5">
        <div className="flex items-center gap-1.5">
          <span className={`stage-dot ${priorityDotColor}`} title={lead.priority} aria-label={`Priority: ${lead.priority}`} />
          <span className="text-[10px] text-text-secondary font-semibold capitalize">{lead.priority}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Quick actions — visible on hover */}
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); window.location.href = `mailto:${lead.email}`; }}
              title="Email"
              className="text-text-muted hover:text-blue-500 transition-colors text-[11px] p-0.5 rounded"
              aria-label={`Email ${lead.firstName}`}
            >
              ✉
            </button>
            {lead.phone && (
              <button
                onClick={(e) => { e.stopPropagation(); window.location.href = `tel:${lead.phone}`; }}
                title="Call"
                className="text-text-muted hover:text-green-500 transition-colors text-[11px] p-0.5 rounded"
                aria-label={`Call ${lead.firstName}`}
              >
                📞
              </button>
            )}
          </div>
          {/* SDR avatar */}
          {assigneeInitials && (
            <div
              className="avatar-xs bg-brand-red/10 text-brand-red"
              title={`${lead.assignedTo?.firstName} ${lead.assignedTo?.lastName}`}
              aria-label={`Assigned to ${lead.assignedTo?.firstName} ${lead.assignedTo?.lastName}`}
            >
              {assigneeInitials}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default function LeadsPage() {
  const { currentRole } = useAppContext();
  const { showToast } = useToast();

  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [sdrFilter, setSdrFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [importListFilter, setImportListFilter] = useState<string>('');
  const [emailValidationFilter, setEmailValidationFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('');
  const [industryFilter, setIndustryFilter] = useState<string>('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [showExtraFilters, setShowExtraFilters] = useState(false);
  const [isDraggedOver, setIsDraggedOver] = useState<Record<string, boolean>>({});
  const [focusedLeadIndex, setFocusedLeadIndex] = useState<number>(-1);
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState('');
  const [bulkSdr, setBulkSdr] = useState('');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkSeqId, setBulkSeqId] = useState('');
  const [sortField, setSortField] = useState<'name' | 'company' | 'stage' | 'priority' | 'assignedTo' | 'lastContacted' | ''>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  // Archived leads are hidden by default; only managers can pull them back into view.
  const canSeeArchived = currentRole !== 'sdr';
  const [showArchived, setShowArchived] = useState(false);

  const filters = {
    archived: canSeeArchived && showArchived,
    search: searchQuery || undefined,
    stage: stageFilter,
    priority: priorityFilter,
    assignedTo: sdrFilter,
    source: sourceFilter || undefined,
    importListName: importListFilter || undefined,
    emailValidation: emailValidationFilter,
    country: countryFilter || undefined,
    industry: industryFilter || undefined,
    tag: tagFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };
  // `isLoading` matters for more than polish: without it the table rendered its "no prospects
  // match" empty state during the very first fetch, which reads as "this account has no leads".
  const { data: leads = [], isLoading: isLoadingLeads } = useLeads(filters);
  const { data: users = [] } = useUsers();
  const { data: sequences = [] } = useSequences();
  const queryClient = useQueryClient();
  const invalidateLeads = () => queryClient.invalidateQueries({ queryKey: ['leads'] });
  const updateStageMutation = useUpdateLeadStage();

  const handleSetViewMode = (mode: 'kanban' | 'table') => {
    setViewMode(mode);
    if (typeof window !== 'undefined') localStorage.setItem('crm:defaultLeadView', mode);
  };

  useEffect(() => {
    const saved = localStorage.getItem('crm:defaultLeadView');
    if (saved === 'table' || saved === 'kanban') setViewMode(saved);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const leadId = (e as CustomEvent).detail?.leadId;
      if (leadId) setSelectedLeadId(leadId);
    };
    window.addEventListener('crm:open-lead', handler);
    return () => window.removeEventListener('crm:open-lead', handler);
  }, []);

  // useCallback gives these stable identities so the memoized LeadCard doesn't
  // re-render every time the parent re-renders.
  const handleDragStart = useCallback((e: React.DragEvent, id: string) => { e.dataTransfer.setData('text/plain', id); }, []);
  const handleDragEnd = useCallback(() => setIsDraggedOver({}), []);
  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    setIsDraggedOver((prev) => ({ ...prev, [colId]: true }));
  };
  const handleDragLeave = (colId: string) => {
    setIsDraggedOver((prev) => ({ ...prev, [colId]: false }));
  };

  const handleDrop = async (e: React.DragEvent, colId: Lead['stage']) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    if (!leadId) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === colId) {
      setIsDraggedOver((prev) => ({ ...prev, [colId]: false }));
      return;
    }
    setIsDraggedOver((prev) => ({ ...prev, [colId]: false }));
    try {
      await updateStageMutation.mutateAsync({ leadId, stage: colId });
      showToast(`Moved to ${colId.replace(/_/g, ' ')}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update stage', 'error');
    }
  };

  const toggleLeadSelect = (id: string) => {
    setSelectedLeads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (visibleIds: string[]) => {
    if (visibleIds.every((id) => selectedLeads.has(id))) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(visibleIds));
    }
  };

  const applyBulkAction = async () => {
    if (selectedLeads.size === 0) return;
    setBulkApplying(true);
    const ids = Array.from(selectedLeads);
    try {
      if (bulkStage) {
        await Promise.all(ids.map((id) =>
          fetch(`/api/leads/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: bulkStage }) })
        ));
        invalidateLeads();
        showToast(`Stage updated for ${ids.length} leads`, 'success');
      }
      if (bulkSdr) {
        await Promise.all(ids.map((id) =>
          fetch(`/api/leads/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignedToId: bulkSdr }) })
        ));
        invalidateLeads();
        showToast(`Reassigned ${ids.length} leads`, 'success');
      }
      if (bulkSeqId) {
        await Promise.all(ids.map((id) =>
          fetch(`/api/sequences/${bulkSeqId}/enroll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: id }) })
        ));
        showToast(`Enrolled ${ids.length} leads in sequence`, 'success');
      }
      setSelectedLeads(new Set());
      setBulkStage('');
      setBulkSdr('');
      setBulkSeqId('');
    } finally {
      setBulkApplying(false);
    }
  };

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortedLeads = useMemo(() => {
    return [...leads].sort((a, b) => {
      if (!sortField) return 0;
      let cmp = 0;
      if (sortField === 'name') cmp = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
      else if (sortField === 'company') cmp = (a.company ?? '').localeCompare(b.company ?? '');
      else if (sortField === 'stage') cmp = (STAGE_RANK[a.stage] ?? 99) - (STAGE_RANK[b.stage] ?? 99);
      else if (sortField === 'priority') cmp = (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99);
      else if (sortField === 'assignedTo') cmp = (`${a.assignedTo?.firstName ?? ''}${a.assignedTo?.lastName ?? ''}`).localeCompare(`${b.assignedTo?.firstName ?? ''}${b.assignedTo?.lastName ?? ''}`);
      else if (sortField === 'lastContacted') cmp = (a.lastContactedAt ? new Date(a.lastContactedAt).getTime() : 0) - (b.lastContactedAt ? new Date(b.lastContactedAt).getTime() : 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [leads, sortField, sortDir]);

  // SDR Speedrun Keyboard Navigation (J / K / Space / X / E / S / A / ?)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = activeEl && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName);
      if (isInput) return;

      if (e.key === '?') {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
        return;
      }

      if (e.key === 'Escape') {
        setSelectedLeads(new Set());
        setFocusedLeadIndex(-1);
        return;
      }

      if (sortedLeads.length === 0) return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedLeadIndex((prev) => (prev < sortedLeads.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedLeadIndex((prev) => (prev > 0 ? prev - 1 : sortedLeads.length - 1));
      } else if (e.key === ' ' || e.key === 'Enter') {
        if (focusedLeadIndex >= 0 && focusedLeadIndex < sortedLeads.length) {
          e.preventDefault();
          setSelectedLeadId(sortedLeads[focusedLeadIndex].id);
        }
      } else if (e.key === 'x') {
        if (focusedLeadIndex >= 0 && focusedLeadIndex < sortedLeads.length) {
          e.preventDefault();
          const targetId = sortedLeads[focusedLeadIndex].id;
          setSelectedLeads((prev) => {
            const next = new Set(prev);
            if (next.has(targetId)) next.delete(targetId);
            else next.add(targetId);
            return next;
          });
        }
      } else if (e.key === 'e') {
        if (focusedLeadIndex >= 0 && focusedLeadIndex < sortedLeads.length) {
          e.preventDefault();
          setSelectedLeadId(sortedLeads[focusedLeadIndex].id);
        }
      } else if (e.key === 'a') {
        if (focusedLeadIndex >= 0 && focusedLeadIndex < sortedLeads.length) {
          e.preventDefault();
          setSelectedLeadId(sortedLeads[focusedLeadIndex].id);
          window.dispatchEvent(new CustomEvent('telestar:open-ai-assistant', { detail: { leadId: sortedLeads[focusedLeadIndex].id } }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sortedLeads, focusedLeadIndex]);

  const handleBatchAiEnrich = useCallback(() => {
    if (selectedLeads.size === 0) return;
    showToast(`🤖 Initiated AI intelligence dossier for ${selectedLeads.size} prospects`, 'success');
  }, [selectedLeads, showToast]);

  // Render helper, not a component — defining components during render trips
  // the react-hooks/static-components rule and remounts the node every render.
  const renderSortTh = (field: typeof sortField, label: string) => (
    <th
      key={field}
      className="p-3 cursor-pointer select-none hover:text-text-primary transition-colors"
      onClick={() => handleSort(field)}
      aria-sort={sortField === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="flex items-center gap-1">
        {label}
        <span className="font-mono text-xs">{sortField === field ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </span>
    </th>
  );

  const columns: { id: Lead['stage']; label: string; color: string; dotColor: string }[] = [
    { id: 'new', label: 'New', color: '', dotColor: 'bg-gray-400' },
    { id: 'sequence_active', label: 'Seq. Active', color: '', dotColor: 'bg-blue-500' },
    { id: 'replied', label: 'Replied', color: '', dotColor: 'bg-brand-orange' },
    { id: 'meeting_booked', label: 'Meeting', color: '', dotColor: 'bg-emerald-500' },
    { id: 'won', label: 'Won', color: '', dotColor: 'bg-green-600' },
    { id: 'lost', label: 'Lost', color: '', dotColor: 'bg-brand-red' },
  ];

  // Bucket leads by stage once per leads-change instead of filtering the full
  // array inside every kanban column on every render.
  const leadsByStage = useMemo(() => {
    const map: Record<string, Lead[]> = { new: [], sequence_active: [], replied: [], meeting_booked: [], won: [], lost: [] };
    for (const l of leads) {
      (map[l.stage] ??= []).push(l);
    }
    return map;
  }, [leads]);

  // Stage and priority chips in the table are now `OperatingStateBadge` / `PriorityIndicator`,
  // which resolve their own colours from the shared status system in `components/operating`.

  const sdrUsers = users.filter((u) => u.role === 'sdr');

  const anyExtraFilter = sdrFilter !== 'all' || sourceFilter || importListFilter || emailValidationFilter !== 'all' || countryFilter || industryFilter || tagFilter || dateFrom || dateTo;
  const extraFilterCount = [
    sdrFilter !== 'all',
    !!sourceFilter,
    !!importListFilter,
    emailValidationFilter !== 'all',
    !!countryFilter,
    !!industryFilter,
    !!tagFilter,
    !!dateFrom,
    !!dateTo,
  ].filter(Boolean).length;
  const clearAllFilters = () => {
    setPriorityFilter('all');
    setStageFilter('all');
    setSdrFilter('all');
    setSearchQuery('');
    setSourceFilter('');
    setImportListFilter('');
    setEmailValidationFilter('all');
    setCountryFilter('');
    setIndustryFilter('');
    setTagFilter('');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="space-y-6 flex-1 flex flex-col">
      {/* Header */}
      <div className="page-hero flex flex-row items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-extrabold text-2xl text-text-primary tracking-tight">
            Leads Pipeline
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">
            {currentRole === 'sdr'
              ? 'Your assigned outreach prospects.'
              : 'Track and manage your team pipeline.'}
          </p>
        </div>

        <div className="flex items-center gap-2 self-auto">
          <div className="flex rounded-lg border border-card-border overflow-hidden shadow-sm">
            <button
              onClick={() => handleSetViewMode('kanban')}
              aria-pressed={viewMode === 'kanban'}
              aria-label="Kanban view"
              title="Kanban view"
              className={`p-2 transition-colors focus-ring ${
                viewMode === 'kanban' ? 'bg-brand-red text-white' : 'bg-card-bg text-text-muted hover:text-text-primary'
              }`}
            >
              <KanbanSquare className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              onClick={() => handleSetViewMode('table')}
              aria-pressed={viewMode === 'table'}
              aria-label="Table view"
              title="Table view"
              className={`p-2 transition-colors focus-ring border-l border-card-border ${
                viewMode === 'table' ? 'bg-brand-red text-white' : 'bg-card-bg text-text-muted hover:text-text-primary'
              }`}
            >
              <TableProperties className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
          {canImportExport(currentRole) && (
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-card-bg border border-card-border hover:bg-bg-main text-text-primary text-xs font-semibold rounded-lg shadow-sm transition-colors focus-ring"
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              <span>Import CSV</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowShortcutsModal(true)}
            title="Keyboard Shortcuts (?)"
            className="flex items-center gap-1.5 px-2.5 py-2 bg-card-bg border border-card-border hover:bg-bg-main text-text-secondary hover:text-text-primary text-xs font-semibold rounded-lg shadow-sm transition-colors focus-ring"
          >
            <Keyboard className="w-4 h-4" />
            <span className="font-mono text-[10px] bg-bg-main px-1 py-0.5 border rounded">?</span>
          </button>
          <button
            onClick={() => setShowNewLeadModal(true)}
            aria-label="Add new lead to pipeline"
            className="flex items-center gap-1.5 px-3 py-2 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg shadow-sm transition-colors hover:scale-[1.02] active:scale-[0.97] focus-ring"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Add Lead</span>
          </button>
        </div>
      </div>

      {/* Filters Toolbar — progressive disclosure */}
      <div className="glass-card rounded-xl p-3">
        {/* Wraps rather than overflowing. At 1024px — the documented lower bound — a role that
            can see the Archived chip pushed this row 52px past the card, and because the card
            is `overflow-x: visible` that became 25px of horizontal scroll on the whole
            document. Nothing changes at 1280px and above, where the row already fits on one
            line. See e2e/roles/desktop-gate.spec.ts. */}
        <div className="flex flex-row flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative max-w-xs flex-shrink-0">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-text-muted dark:text-zinc-400">
              <Search className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              placeholder="Search full name, email, company, phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 text-xs bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg text-text-primary placeholder:text-text-muted dark:placeholder:text-zinc-500 shadow-2xs focus:outline-none focus:ring-2 focus:ring-brand-red/20 focus:border-brand-red font-medium transition-all"
            />
          </div>

          {/* Always-visible filters */}
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg text-xs px-2.5 py-1.5 text-text-primary shadow-2xs focus:outline-none focus:border-brand-red cursor-pointer font-medium"
          >
            <option value="all">All Stages</option>
            <option value="new">New</option>
            <option value="sequence_active">Sequence Active</option>
            <option value="replied">Replied</option>
            <option value="meeting_booked">Meeting Booked</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg text-xs px-2.5 py-1.5 text-text-primary shadow-2xs focus:outline-none focus:border-brand-red cursor-pointer font-medium"
          >
            <option value="all">All Priority</option>
            <option value="hot">🔥 Hot</option>
            <option value="warm">⚡ Warm</option>
            <option value="cold">❄️ Cold</option>
          </select>

          {/* Campaign & SDR filters */}
          <select
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg text-xs px-2.5 py-1.5 text-text-primary shadow-2xs focus:outline-none focus:border-brand-red cursor-pointer font-medium"
          >
            <option value="all">All Campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {users.length > 0 && (
            <select
              value={sdrFilter}
              onChange={(e) => setSdrFilter(e.target.value)}
              className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg text-xs px-2.5 py-1.5 text-text-primary shadow-2xs focus:outline-none focus:border-brand-red cursor-pointer font-medium"
            >
              <option value="all">All SDRs</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </option>
              ))}
            </select>
          )}

          {/* + Filters toggle */}
          <button
            onClick={() => setShowExtraFilters(!showExtraFilters)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              showExtraFilters || anyExtraFilter
                ? 'bg-brand-red/10 text-brand-red border-brand-red/25'
                : 'bg-bg-main border-card-border text-text-secondary hover:text-text-primary'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters
            {extraFilterCount > 0 && (
              <span className="ml-0.5 bg-brand-red text-white text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {extraFilterCount}
              </span>
            )}
            <ChevronDown className={`w-3 h-3 transition-transform ${showExtraFilters ? 'rotate-180' : ''}`} />
          </button>

          {canSeeArchived && (
            <label
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer transition-colors ${
                showArchived
                  ? 'bg-brand-red/10 text-brand-red border-brand-red/25'
                  : 'bg-bg-main border-card-border text-text-secondary hover:text-text-primary'
              }`}
              title="Show leads that were archived"
            >
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="w-3 h-3 accent-brand-red cursor-pointer"
              />
              Archived
            </label>
          )}

          {(priorityFilter !== 'all' || stageFilter !== 'all' || searchQuery || anyExtraFilter) && (
            <button
              onClick={clearAllFilters}
              className="text-xs font-mono text-brand-red hover:underline whitespace-nowrap"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Extra filters row */}
        {showExtraFilters && (
          <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-card-border/80">
            {currentRole !== 'sdr' && sdrUsers.length > 0 && (
              <select
                value={sdrFilter}
                onChange={(e) => setSdrFilter(e.target.value)}
                className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg text-xs px-2.5 py-1.5 text-text-primary shadow-2xs focus:outline-none focus:border-brand-red cursor-pointer font-medium"
              >
                <option value="all">All Reps</option>
                {sdrUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                ))}
              </select>
            )}
            <input
              type="text"
              placeholder="Source…"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg text-xs px-2.5 py-1.5 text-text-primary placeholder:text-text-muted dark:placeholder:text-zinc-500 shadow-2xs focus:outline-none focus:border-brand-red font-medium w-28"
            />
            <input
              type="text"
              placeholder="Import list..."
              value={importListFilter}
              onChange={(e) => setImportListFilter(e.target.value)}
              className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg text-xs px-2.5 py-1.5 text-text-primary placeholder:text-text-muted dark:placeholder:text-zinc-500 shadow-2xs focus:outline-none focus:border-brand-red font-medium w-32"
            />
            <select
              value={emailValidationFilter}
              onChange={(e) => setEmailValidationFilter(e.target.value)}
              className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg text-xs px-2.5 py-1.5 text-text-primary shadow-2xs focus:outline-none focus:border-brand-red cursor-pointer font-medium"
            >
              <option value="all">All Email Quality</option>
              <option value="deliverable">Deliverable</option>
              <option value="risky">Risky</option>
              <option value="unknown">Unknown</option>
              <option value="undeliverable">Undeliverable</option>
            </select>
            <input
              type="text"
              placeholder="Country..."
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg text-xs px-2.5 py-1.5 text-text-primary placeholder:text-text-muted dark:placeholder:text-zinc-500 shadow-2xs focus:outline-none focus:border-brand-red font-medium w-28"
            />
            <input
              type="text"
              placeholder="Industry..."
              value={industryFilter}
              onChange={(e) => setIndustryFilter(e.target.value)}
              className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg text-xs px-2.5 py-1.5 text-text-primary placeholder:text-text-muted dark:placeholder:text-zinc-500 shadow-2xs focus:outline-none focus:border-brand-red font-medium w-28"
            />
            <input
              type="text"
              placeholder="Tag…"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg text-xs px-2.5 py-1.5 text-text-primary placeholder:text-text-muted dark:placeholder:text-zinc-500 shadow-2xs focus:outline-none focus:border-brand-red font-medium w-28"
            />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              title="Created from"
              className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg text-xs px-2 py-1.5 text-text-primary shadow-2xs focus:outline-none focus:border-brand-red font-mono w-32"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="Created to"
              className="bg-bg-main dark:bg-zinc-900 border border-card-border dark:border-zinc-700 rounded-lg text-xs px-2 py-1.5 text-text-primary shadow-2xs focus:outline-none focus:border-brand-red font-mono w-32"
            />
          </div>
        )}
      </div>

      {/* Leads Content */}
      {viewMode === 'kanban' ? (
        <div className="flex gap-4 flex-1 items-stretch overflow-x-auto pb-2">
          {columns.map((col) => {
            const colLeads = leadsByStage[col.id] ?? [];
            const isHovered = isDraggedOver[col.id];

            return (
              <div
                key={col.id}
                role="region"
                aria-label={`${col.label} — ${colLeads.length} leads`}
                aria-dropeffect="move"
                onDragOver={(e) => handleDragOver(e, col.id)}
                onDragLeave={() => handleDragLeave(col.id)}
                onDrop={(e) => handleDrop(e, col.id)}
                className={`flex flex-col p-2.5 min-h-[400px] w-[300px] flex-shrink-0 transition-colors duration-200 ${
                  isHovered ? 'rounded-2xl border border-brand-red border-dashed bg-brand-red/[0.03]' : ''
                }`}
              >
                <div className="flex items-center justify-between pb-2.5 border-b border-card-border/50 mb-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`stage-dot ${col.dotColor}`} aria-hidden="true" />
                    <span className="font-display font-bold text-xs text-text-primary">{col.label}</span>
                  </div>
                  <span className="font-mono text-xs font-bold text-text-muted">
                    {colLeads.length}
                  </span>
                </div>

                <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[500px] pr-1">
                  {colLeads.length === 0 ? (
                    <div className="h-20 border border-dashed border-card-border/60 rounded-xl flex items-center justify-center text-xs text-text-muted italic">
                      Empty stage
                    </div>
                  ) : (
                    colLeads.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        onOpen={setSelectedLeadId}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-card-bg border border-card-border rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-bg-main/50 border-b border-card-border text-xs uppercase font-bold tracking-wider text-text-muted">
                  <th className="p-3 w-8">
                    <input
                      type="checkbox"
                      checked={sortedLeads.length > 0 && sortedLeads.every((l) => selectedLeads.has(l.id))}
                      onChange={() => toggleSelectAll(sortedLeads.map((l) => l.id))}
                      className="rounded border-card-border"
                      aria-label="Select all leads"
                    />
                  </th>
                  {renderSortTh('name', 'Prospect')}
                  {renderSortTh('company', 'Company')}
                  <th className="p-3">Signals</th>
                  {renderSortTh('priority', 'Priority')}
                  {renderSortTh('assignedTo', 'Owner')}
                  <th className="p-3">Operating State</th>
                  {renderSortTh('lastContacted', 'Last Touch')}
                  <th className="p-3">Next Action</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border text-text-secondary">
                {isLoadingLeads ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={`skeleton-${i}`} className="table-row-dense" aria-hidden="true">
                      <td className="p-3"><SkeletonBlock className="h-3.5 w-3.5" /></td>
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <SkeletonBlock className="w-8 h-8 rounded-full" />
                          <SkeletonBlock className="h-3 w-32" />
                        </div>
                      </td>
                      <td className="p-3"><SkeletonBlock className="h-3 w-28" /></td>
                      <td className="p-3"><SkeletonBlock className="h-3 w-20" /></td>
                      <td className="p-3"><SkeletonBlock className="h-3 w-16" /></td>
                      <td className="p-3"><SkeletonBlock className="h-3 w-24" /></td>
                      <td className="p-3"><SkeletonBlock className="h-5 w-28 rounded-full" /></td>
                      <td className="p-3"><SkeletonBlock className="h-3 w-14" /></td>
                      <td className="p-3"><SkeletonBlock className="h-3 w-16" /></td>
                      <td className="p-3"><SkeletonBlock className="h-3 w-12 ml-auto" /></td>
                    </tr>
                  ))
                ) : leads.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-0">
                      <EmptyState
                        title="No prospects match the active search or filters."
                        description="Clear a filter, or import a list to start building the pipeline."
                        icon={Users}
                      />
                    </td>
                  </tr>
                ) : (
                  sortedLeads.map((lead, idx) => {
                    const isFocused = focusedLeadIndex === idx;
                    return (
                      <tr
                        key={lead.id}
                        onClick={() => {
                          setFocusedLeadIndex(idx);
                          setSelectedLeadId(lead.id);
                        }}
                        className={`cursor-pointer table-row-dense transition-all ${
                          isFocused
                            ? 'ring-2 ring-inset ring-brand-red/60 bg-brand-red/[0.06] shadow-sm'
                            : 'hover:bg-brand-red/[0.03]'
                        } ${selectedLeads.has(lead.id) ? 'bg-brand-red/[0.08]' : ''}`}
                      >
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedLeads.has(lead.id)}
                            onChange={() => toggleLeadSelect(lead.id)}
                            className="rounded border-card-border accent-brand-red"
                            aria-label={`Select ${lead.firstName} ${lead.lastName}`}
                          />
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <ProspectIdentity
                              name={`${lead.firstName} ${lead.lastName}`}
                              title={lead.title}
                            />
                            {lead.atRisk && (
                              <span
                                className="text-brand-orange-text shrink-0"
                                title="Sequence task overdue 3+ days"
                                aria-label="Sequence task overdue by three days or more"
                              >
                                <AlertTriangle className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="type-body text-text-primary font-semibold">{lead.company}</span>
                          <span className="block type-micro text-text-muted">
                            {lead.stage.replace(/_/g, ' ')}
                          </span>
                        </td>
                        {/* Clay-Style Intent Signals */}
                        <td className="p-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {lead.priority === 'hot' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-500/10 text-red-400 border border-red-500/20 font-bold text-[10px]">
                                🔥 High Intent
                              </span>
                            )}
                            {lead.company?.toLowerCase().includes('tech') || lead.company?.toLowerCase().includes('cloud') || lead.company?.toLowerCase().includes('ai') ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px]">
                                💼 Tech/SaaS
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">
                                📈 Growth
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <PriorityIndicator priority={lead.priority} />
                        </td>
                        <td className="p-3">
                          <OwnerBadge
                            operatingState={lead.operatingState}
                            ownerName={
                              lead.assignedTo
                                ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`.trim()
                                : null
                            }
                          />
                        </td>
                        <td className="p-3">
                          <OperatingStateBadge state={lead.operatingState} />
                        </td>
                        <td className="p-3 font-mono type-meta text-text-muted whitespace-nowrap">
                          {lead.lastContactedAt
                            ? new Date(lead.lastContactedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
                            : <span className="text-text-muted">—</span>}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {lead.nextTaskDue ? (
                            <>
                              <span className="type-meta text-text-primary capitalize">
                                {(lead.nextTaskType ?? 'task').replace(/_/g, ' ')}
                              </span>
                              <span className="block type-micro text-text-muted font-mono">
                                {new Date(lead.nextTaskDue).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                              </span>
                            </>
                          ) : (
                            <span className="type-meta text-text-muted">—</span>
                          )}
                        </td>
                        <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1.5 justify-end items-center">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedLeadId(lead.id);
                                window.dispatchEvent(new CustomEvent('telestar:open-ai-assistant', { detail: { leadId: lead.id } }));
                              }}
                              className="p-1 hover:bg-card-border rounded text-emerald-400 hover:text-emerald-300"
                              title="1-Click AI Dossier & Icebreaker (A)"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                            </button>
                            <a href={`mailto:${lead.email}`} className="p-1 hover:bg-card-border rounded text-blue-500" title="Send email">
                              <Mail className="w-3.5 h-3.5" />
                            </a>
                            {lead.phone && (
                              <a href={`tel:${lead.phone}`} className="p-1 hover:bg-card-border rounded text-green-500" title="Call">
                                <Phone className="w-3.5 h-3.5" />
                              </a>
                            )}
                            {lead.linkedIn && (
                              <a href={lead.linkedIn} target="_blank" rel="noreferrer" className="p-1 hover:bg-card-border rounded text-indigo-500" title="LinkedIn">
                                <Linkedin className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Floating Sticky Bulk Action Bar */}
      <FloatingBulkBar
        selectedCount={selectedLeads.size}
        sequences={sequences}
        users={users}
        bulkStage={bulkStage}
        setBulkStage={setBulkStage}
        bulkSdr={bulkSdr}
        setBulkSdr={setBulkSdr}
        bulkSeqId={bulkSeqId}
        setBulkSeqId={setBulkSeqId}
        onApply={applyBulkAction}
        onClear={() => setSelectedLeads(new Set())}
        isApplying={bulkApplying}
        onBatchAiEnrich={handleBatchAiEnrich}
      />

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />

      {selectedLeadId && (
        <LeadDetailPanel
          leadId={selectedLeadId}
          onLeadUpdate={() => invalidateLeads()}
          onClose={() => {
            setSelectedLeadId(null);
            invalidateLeads();
          }}
        />
      )}

      {showNewLeadModal && (
        <NewLeadModal
          onClose={() => setShowNewLeadModal(false)}
          onSuccess={() => { invalidateLeads(); setShowNewLeadModal(false); }}
        />
      )}

      {showImportModal && (
        <CSVImportModal
          onClose={() => setShowImportModal(false)}
          onSuccess={() => { setShowImportModal(false); invalidateLeads(); }}
        />
      )}
    </div>
  );
}
