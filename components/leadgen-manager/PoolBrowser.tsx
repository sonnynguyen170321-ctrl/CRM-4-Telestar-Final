'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Search,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Route,
  ArrowRightLeft,
  UserRound,
  Flag,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

type PoolItem = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  company: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedIn: string | null;
  website: string | null;
  country: string | null;
  industry: string | null;
  status: string;
  qualification: string;
  sourceType: string;
  sourceName: string | null;
  icpFitScore: number | null;
  dataQualityScore: number | null;
  emailValidation: string | null;
  emailScore: number | null;
  tags: string[];
  createdAt: string;
  duplicateOfId: string | null;
  assignedCampaignId: string | null;
  assignedSdrId: string | null;
  convertedLeadId: string | null;
  duplicateOf?: { id: string; firstName: string | null; lastName: string | null; company: string; email: string | null } | null;
  qualifiedBy?: { id: string; firstName: string | null; lastName: string | null } | null;
  assignedCampaign?: { id: string; name: string } | null;
  assignedSdr?: { id: string; firstName: string | null; lastName: string | null } | null;
  convertedLead?: { id: string; firstName: string | null; lastName: string | null; stage: string } | null;
};

type ListResponse = {
  items: PoolItem[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
};

type TeamUser = { id: string; firstName: string; lastName: string; email: string; role: string };
type Campaign = { id: string; name: string };

const QUALIFICATIONS = [
  { value: 'unreviewed', label: 'Unreviewed', color: 'text-slate-400 bg-slate-400/10 border-slate-400/20' },
  { value: 'qualified', label: 'Qualified', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  { value: 'needs_research', label: 'Needs Research', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  { value: 'disqualified', label: 'Disqualified', color: 'text-brand-red bg-brand-red/10 border-brand-red/20' },
  { value: 'invalid_contact', label: 'Invalid Contact', color: 'text-brand-red bg-brand-red/10 border-brand-red/20' },
  { value: 'invalid_company', label: 'Invalid Company', color: 'text-brand-red bg-brand-red/10 border-brand-red/20' },
  { value: 'out_of_icp', label: 'Out of ICP', color: 'text-brand-red bg-brand-red/10 border-brand-red/20' },
  { value: 'duplicate', label: 'Duplicate', color: 'text-slate-500 bg-slate-500/10 border-slate-500/20' },
];

const STATUSES = [
  { value: 'imported', label: 'Imported' },
  { value: 'qa_pending', label: 'QA Pending' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'assigned_to_campaign', label: 'Assigned' },
  { value: 'disqualified', label: 'Disqualified' },
  { value: 'archived', label: 'Archived' },
];

function qualMeta(value: string) {
  return QUALIFICATIONS.find((q) => q.value === value) ?? { value, label: value, color: 'text-text-muted bg-background border-card-border' };
}

function nameOf(item: { firstName?: string | null; lastName?: string | null; fullName?: string | null }) {
  return [item.firstName, item.lastName].filter(Boolean).join(' ') || item.fullName || '—';
}

function scoreBadge(value: number | null) {
  if (value == null) return null;
  const color = value >= 70 ? 'text-emerald-400' : value >= 40 ? 'text-amber-400' : 'text-brand-red';
  return <span className={`text-[10px] font-mono font-bold ${color}`}>{value}</span>;
}

export default function PoolBrowser({ mode }: { mode: 'pool' | 'qualify' | 'routing' }) {
  const { showToast } = useToast();

  const [items, setItems] = useState<PoolItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [qualFilter, setQualFilter] = useState('');
  const [sourceType, setSourceType] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [disqualifyReason, setDisqualifyReason] = useState('');
  const [qaNotes, setQaNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [assignCampaignId, setAssignCampaignId] = useState('');
  const [assignSdrIds, setAssignSdrIds] = useState<string[]>([]);
  const [method, setMethod] = useState<'single' | 'round_robin'>('single');

  const defaultQual = mode === 'qualify' ? 'unreviewed' : mode === 'routing' ? 'qualified' : '';
  const defaultStatus = mode === 'routing' ? 'qualified' : '';

  useEffect(() => {
    setQualFilter(defaultQual);
    setStatusFilter(defaultStatus);
  }, [mode, defaultQual, defaultStatus]);

  const loadRef = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '50' });
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (qualFilter) params.set('qualification', qualFilter);
      if (sourceType) params.set('sourceType', sourceType);
      const res = await fetch(`/api/leadgen-pool?${params.toString()}`);
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to load pool'));
      const data: ListResponse = await res.json();
      setItems(data.items);
      setTotal(data.total);
      setPages(data.pages);
      setSelected(new Set());
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load pool', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, qualFilter, sourceType, showToast]);

  useEffect(() => {
    const t = setTimeout(() => loadRef(), 250);
    return () => clearTimeout(t);
  }, [loadRef]);

  const loadMeta = useCallback(async () => {
    const [cRes, uRes] = await Promise.all([
      fetch('/api/campaigns').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/users').then((r) => (r.ok ? r.json() : [])),
    ]);
    setCampaigns(cRes);
    setTeam(uRes.filter((u: TeamUser) => u.role === 'sdr' || u.role === 'leadgen' || u.role === 'leadgen_manager'));
  }, []);

  useEffect(() => {
    if (mode === 'routing') loadMeta();
  }, [mode, loadMeta]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))));
  };

  const allSelected = items.length > 0 && selected.size === items.length;
  const selectedItems = items.filter((i) => selected.has(i.id));

  const runAction = async (path: string, body: unknown, okMsg: string) => {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Action failed'));
      const data = await res.json();
      showToast(`${okMsg} (${data.count ?? ''})`.trim(), 'success');
      setSelected(new Set());
      loadRef();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const bulkQualify = (qualification: string) => {
    if (selected.size === 0) {
      showToast('Select at least one record', 'error');
      return;
    }
    runAction('/api/leadgen-pool/qualify', {
      ids: [...selected],
      qualification,
      reason: qualification === 'disqualified' ? disqualifyReason || undefined : undefined,
      qaNotes: qaNotes || undefined,
    }, `Marked ${qualification.replace('_', ' ')}`);
  };

  const archiveSelected = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      for (const id of selected) {
        await fetch(`/api/leadgen-pool/${id}`, { method: 'DELETE' });
      }
      showToast(`Archived ${selected.size} record(s)`, 'success');
      loadRef();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Archive failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doAssign = () => {
    if (selected.size === 0) return;
    if (!assignCampaignId && assignSdrIds.length === 0) {
      showToast('Choose a campaign or at least one SDR', 'error');
      return;
    }
    runAction('/api/leadgen-pool/assign', {
      ids: [...selected],
      campaignId: assignCampaignId || undefined,
      sdrIds: assignSdrIds.length ? assignSdrIds : undefined,
      method,
    }, 'Assigned').then(() => {
      setShowAssign(false);
      setAssignCampaignId('');
      setAssignSdrIds([]);
    });
  };

  const doConvert = () => {
    if (selected.size === 0) return;
    if (!assignCampaignId) {
      showToast('Choose a campaign', 'error');
      return;
    }
    if (assignSdrIds.length === 0) {
      showToast('Choose at least one SDR to receive leads', 'error');
      return;
    }
    runAction('/api/leadgen-pool/convert', {
      ids: [...selected],
      campaignId: assignCampaignId,
      sdrIds: assignSdrIds,
      method,
    }, 'Converted').then(() => {
      setShowConvert(false);
      setAssignCampaignId('');
      setAssignSdrIds([]);
    });
  };

  const toggleSdr = (id: string) => {
    setAssignSdrIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const sdrOptions = team.filter((u) => u.role === 'sdr' || u.role === 'leadgen');

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-card-bg border border-card-border rounded-2xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search name, email, company, title, source…"
            className="w-full bg-background border border-card-border rounded-lg pl-9 pr-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-purple-500/40"
          />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="bg-background border border-card-border rounded-lg px-2 py-2 text-xs text-text-secondary focus:outline-none">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select value={qualFilter} onChange={(e) => { setQualFilter(e.target.value); setPage(1); }} className="bg-background border border-card-border rounded-lg px-2 py-2 text-xs text-text-secondary focus:outline-none">
          <option value="">All qualifications</option>
          {QUALIFICATIONS.map((q) => (
            <option key={q.value} value={q.value}>{q.label}</option>
          ))}
        </select>
        <select value={sourceType} onChange={(e) => { setSourceType(e.target.value); setPage(1); }} className="bg-background border border-card-border rounded-lg px-2 py-2 text-xs text-text-secondary focus:outline-none">
          <option value="">All sources</option>
          <option value="manual">Manual</option>
          <option value="csv_import">CSV Import</option>
          <option value="bulk_import">Bulk Import</option>
          <option value="web">Web</option>
          <option value="referral">Referral</option>
          <option value="event">Event</option>
          <option value="outbound">Outbound</option>
          <option value="other">Other</option>
        </select>
        {mode === 'pool' && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/35 text-purple-300 text-xs font-bold rounded-lg transition-all active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Record
          </button>
        )}
        <button onClick={() => { setPage(1); loadRef(); }} className="flex items-center gap-1.5 px-3 py-2 bg-background border border-card-border text-text-secondary hover:text-text-primary text-xs font-bold rounded-lg transition-all">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="bg-purple-500/10 border border-purple-500/25 rounded-2xl p-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono text-purple-300 mr-1">{selected.size} selected</span>

          {(mode === 'pool' || mode === 'qualify') && (
            <>
              <button onClick={() => bulkQualify('qualified')} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 text-xs font-bold rounded-lg">
                <CheckCircle2 className="w-3.5 h-3.5" /> Qualify
              </button>
              <button onClick={() => bulkQualify('needs_research')} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-400 text-xs font-bold rounded-lg">
                <HelpCircle className="w-3.5 h-3.5" /> Needs Research
              </button>
              <button onClick={() => bulkQualify('disqualified')} className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-red/15 hover:bg-brand-red/25 border border-brand-red/30 text-brand-red text-xs font-bold rounded-lg">
                <XCircle className="w-3.5 h-3.5" /> Disqualify
              </button>
              <input
                value={disqualifyReason}
                onChange={(e) => setDisqualifyReason(e.target.value)}
                placeholder="Disqualification reason"
                className="bg-background border border-card-border rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-red/40 min-w-[180px]"
              />
            </>
          )}

          {(mode === 'pool' || mode === 'routing') && (
            <button onClick={() => setShowAssign(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-400 text-xs font-bold rounded-lg">
              <Route className="w-3.5 h-3.5" /> Assign to Campaign / SDR
            </button>
          )}

          {(mode === 'pool' || mode === 'routing') && (
            <button onClick={() => setShowConvert(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg">
              <ArrowRightLeft className="w-3.5 h-3.5" /> Convert to Leads
            </button>
          )}

          {mode === 'pool' && (
            <button onClick={archiveSelected} className="flex items-center gap-1.5 px-3 py-1.5 bg-background border border-card-border text-text-secondary hover:text-brand-red text-xs font-bold rounded-lg ml-auto">
              <Trash2 className="w-3.5 h-3.5" /> Archive
            </button>
          )}

          {mode === 'qualify' && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px] text-text-muted uppercase">QA notes</span>
              <input
                value={qaNotes}
                onChange={(e) => setQaNotes(e.target.value)}
                placeholder="e.g. verified title + company size"
                className="bg-background border border-card-border rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-purple-500/40 min-w-[220px]"
              />
            </div>
          )}

          {busy && <RefreshCw className="w-3.5 h-3.5 text-purple-300 animate-spin" />}
        </div>
      )}

      {/* Manual create form */}
      {showCreate && <CreateForm onDone={(ok) => { setShowCreate(false); if (ok) loadRef(); }} />}

      {/* Requirements (routing mode) */}
      {mode === 'routing' && <RequirementsPanel campaigns={campaigns} />}

      {/* Table */}
      <div className="bg-card-bg border border-card-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-card-border bg-background/60">
                <th className="w-8 px-3 py-2.5">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-purple-500" />
                </th>
                <th className="px-3 py-2.5 text-[10px] uppercase text-text-muted">Contact</th>
                <th className="px-3 py-2.5 text-[10px] uppercase text-text-muted">Company</th>
                <th className="px-3 py-2.5 text-[10px] uppercase text-text-muted">Title</th>
                <th className="px-3 py-2.5 text-[10px] uppercase text-text-muted">Email</th>
                <th className="px-3 py-2.5 text-[10px] uppercase text-text-muted">Qualification</th>
                <th className="px-3 py-2.5 text-[10px] uppercase text-text-muted">Status</th>
                <th className="px-3 py-2.5 text-[10px] uppercase text-text-muted">Source</th>
                <th className="px-3 py-2.5 text-[10px] uppercase text-text-muted">Scores</th>
                <th className="px-3 py-2.5 text-[10px] uppercase text-text-muted">Route</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-3 py-12 text-center">
                    <div className="inline-block w-6 h-6 border-2 border-purple-500/30 border-t-purple-400 rounded-full animate-spin" />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-12 text-center text-xs text-text-muted italic">
                    No records match the current filters.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const q = qualMeta(item.qualification);
                  return (
                    <tr key={item.id} className={`border-b border-card-border/60 hover:bg-background/40 ${selected.has(item.id) ? 'bg-purple-500/5' : ''}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} className="accent-purple-500" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs font-semibold text-text-primary">{nameOf(item)}</div>
                        {item.duplicateOfId && item.duplicateOf && (
                          <div className="text-[10px] text-slate-500 font-mono truncate max-w-[160px]">
                            dup of {nameOf(item.duplicateOf)}
                          </div>
                        )}
                        {item.qualifiedBy && (
                          <div className="text-[10px] text-text-muted font-mono">by {[item.qualifiedBy.firstName, item.qualifiedBy.lastName].filter(Boolean).join(' ')}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs text-text-secondary">{item.company}</div>
                        {item.country && <div className="text-[10px] text-text-muted font-mono">{item.country}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-text-secondary">{item.title || <span className="text-text-muted">—</span>}</td>
                      <td className="px-3 py-2.5">
                        {item.email ? (
                          <div>
                            <a href={`mailto:${item.email}`} className="text-xs text-blue-400 hover:underline font-mono">{item.email}</a>
                            {item.emailValidation && (
                              <div className={`text-[10px] font-mono ${item.emailValidation === 'invalid' ? 'text-brand-red' : 'text-emerald-400'}`}>
                                {item.emailValidation}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                        {item.linkedIn && (
                          <a href={item.linkedIn} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400/70 hover:text-blue-300 font-mono inline-flex items-center gap-1">
                            in <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded border ${q.color}`}>{q.label}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[10px] text-text-muted uppercase">{item.status.replaceAll('_', ' ')}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[10px] font-mono text-text-muted">{item.sourceName || item.sourceType}</span>
                      </td>
                      <td className="px-3 py-2.5 space-x-1.5">
                        {scoreBadge(item.icpFitScore)}
                        {item.dataQualityScore != null && <span className="text-[10px] font-mono text-text-muted">DQ {item.dataQualityScore}</span>}
                        {item.emailScore != null && <span className="text-[10px] font-mono text-text-muted">ES {item.emailScore}</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="space-y-0.5 text-[10px] font-mono text-text-muted">
                          {item.assignedCampaign && <div>→ {item.assignedCampaign.name}</div>}
                          {item.assignedSdr && (
                            <div className="inline-flex items-center gap-1 text-amber-300">
                              <UserRound className="w-2.5 h-2.5" />
                              {[item.assignedSdr.firstName, item.assignedSdr.lastName].filter(Boolean).join(' ')}
                            </div>
                          )}
                          {item.convertedLead && (
                            <div className="text-emerald-400">→ Lead · {item.convertedLead.stage}</div>
                          )}
                          {!item.assignedCampaign && !item.assignedSdr && <span>—</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-card-border bg-background/60">
          <span className="text-[10px] font-mono text-text-muted">{total} records · page {page}/{pages || 1}</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-background border border-card-border text-text-secondary disabled:opacity-40 hover:text-text-primary text-xs rounded-lg"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-background border border-card-border text-text-secondary disabled:opacity-40 hover:text-text-primary text-xs rounded-lg"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Assign / Convert panels */}
      {(showAssign || showConvert) && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card-bg border border-card-border rounded-2xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-sm text-text-primary">
                {showConvert ? 'Convert to Leads' : 'Assign'}
              </h3>
              <button onClick={() => { setShowAssign(false); setShowConvert(false); }} className="text-text-muted hover:text-text-primary text-lg leading-none">×</button>
            </div>
            <p className="text-xs text-text-secondary">
              {selected.size} selected · {showConvert ? 'Creates Accounts/Contacts/Leads and routes to an SDR.' : 'Tags pool records for a campaign and/or SDR.'}
            </p>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase text-text-muted">Campaign</label>
              <select value={assignCampaignId} onChange={(e) => setAssignCampaignId(e.target.value)} className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-purple-500/40">
                <option value="">{showConvert ? 'Select campaign (required)' : 'No campaign'}</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase text-text-muted">
                SDRs {showConvert ? '(required)' : '(optional)'}
              </label>
              <div className="max-h-40 overflow-y-auto border border-card-border rounded-lg bg-background divide-y divide-card-border/60">
                {sdrOptions.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[10px] text-text-muted italic">No SDRs available</div>
                ) : (
                  sdrOptions.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-background/60">
                      <input type="checkbox" checked={assignSdrIds.includes(u.id)} onChange={() => toggleSdr(u.id)} className="accent-purple-500" />
                      <span className="text-xs text-text-secondary">{u.firstName} {u.lastName}</span>
                      <span className="ml-auto text-[10px] text-text-muted uppercase">{u.role.replace('_', ' ')}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {sdrOptions.length > 1 && (
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                  <input type="radio" name="method" checked={method === 'single'} onChange={() => setMethod('single')} className="accent-purple-500" />
                  Single
                </label>
                <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                  <input type="radio" name="method" checked={method === 'round_robin'} onChange={() => setMethod('round_robin')} className="accent-purple-500" />
                  Round robin
                </label>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={() => { setShowAssign(false); setShowConvert(false); }} className="px-4 py-2 bg-background border border-card-border text-text-secondary hover:text-text-primary text-xs font-bold rounded-lg">
                Cancel
              </button>
              <button
                onClick={showConvert ? doConvert : doAssign}
                disabled={busy || selected.size === 0}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg disabled:opacity-50"
              >
                {busy ? 'Working…' : showConvert ? 'Convert & Assign' : 'Apply Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateForm({ onDone }: { onDone: (ok: boolean) => void }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    company: '',
    title: '',
    phone: '',
    linkedIn: '',
    website: '',
    country: '',
    industry: '',
  });
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const submit = async () => {
    if (!form.company.trim()) {
      showToast('Company is required', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/leadgen-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          email: form.email.trim() || undefined,
          firstName: form.firstName.trim() || undefined,
          lastName: form.lastName.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to add record'));
      showToast('Record added to internal database', 'success');
      onDone(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add record', 'error');
    } finally {
      setBusy(false);
    }
  };

  const fields: Array<[keyof typeof form, string, boolean]> = [
    ['firstName', 'First name', false],
    ['lastName', 'Last name', false],
    ['email', 'Email', false],
    ['company', 'Company *', true],
    ['title', 'Title', false],
    ['phone', 'Phone', false],
    ['linkedIn', 'LinkedIn URL', false],
    ['website', 'Website', false],
    ['country', 'Country', false],
    ['industry', 'Industry', false],
  ];

  return (
    <div className="bg-card-bg border border-card-border rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-bold text-sm text-text-primary">Manual Record</h3>
        <button onClick={() => onDone(false)} className="text-text-muted hover:text-text-primary text-lg leading-none">×</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([key, label, required]) => (
          <div key={key} className="space-y-1">
            <label className="text-[10px] uppercase text-text-muted">{label}</label>
            <input
              value={form[key]}
              onChange={set(key)}
              placeholder={label.replace(' *', '')}
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-purple-500/40"
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={() => onDone(false)} className="px-4 py-2 bg-background border border-card-border text-text-secondary hover:text-text-primary text-xs font-bold rounded-lg">
          Cancel
        </button>
        <button onClick={submit} disabled={busy} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg disabled:opacity-50">
          {busy ? 'Adding…' : 'Add Record'}
        </button>
      </div>
    </div>
  );
}

function RequirementsPanel({ campaigns }: { campaigns: Campaign[] }) {
  const { showToast } = useToast();
  const [reqs, setReqs] = useState<Array<{
    id: string;
    campaignId: string;
    requiredCount: number;
    delivered: number;
    progress: number;
    status: string;
    notes: string | null;
    dueDate: string | null;
    campaign: { id: string; name: string; client: { name: string } | null };
  }>>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ campaignId: '', requiredCount: '50', dueDate: '', notes: '' });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/leadgen-pool/requirements');
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to load requirements'));
      setReqs(await res.json());
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load requirements', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!form.campaignId || !form.requiredCount) {
      showToast('Campaign and required count are needed', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/leadgen-pool/requirements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: form.campaignId,
          requiredCount: Number(form.requiredCount),
          notes: form.notes || null,
          dueDate: form.dueDate || null,
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to create requirement'));
      showToast('Requirement created', 'success');
      setForm({ campaignId: '', requiredCount: '50', dueDate: '', notes: '' });
      setShowForm(false);
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create requirement', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/leadgen-pool/requirements/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to delete requirement'));
      showToast('Requirement removed', 'success');
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete requirement', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-card-bg border border-card-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flag className="w-4 h-4 text-purple-400" />
          <h3 className="font-display font-extrabold text-sm text-text-primary">Campaign Lead Requirements</h3>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="px-3 py-1.5 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/35 text-purple-300 text-xs font-bold rounded-lg">
          {showForm ? 'Close' : '+ New Requirement'}
        </button>
      </div>

      {showForm && (
        <div className="grid grid-cols-2 gap-3 p-3 border border-card-border rounded-xl bg-background/40">
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-text-muted">Campaign</label>
            <select value={form.campaignId} onChange={(e) => setForm((p) => ({ ...p, campaignId: e.target.value }))} className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:outline-none">
              <option value="">Select campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-text-muted">Required count</label>
            <input
              type="number"
              min={1}
              value={form.requiredCount}
              onChange={(e) => setForm((p) => ({ ...p, requiredCount: e.target.value }))}
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-text-muted">Due date</label>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-text-muted">Notes</label>
            <input
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Optional"
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none"
            />
          </div>
          <div className="col-span-2 flex justify-end">
            <button onClick={create} disabled={busy} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg disabled:opacity-50">
              {busy ? 'Saving…' : 'Create Requirement'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {reqs.length === 0 ? (
          <p className="text-xs text-text-muted italic">No requirements set. Create one to track campaign delivery.</p>
        ) : (
          reqs.map((r) => {
            const pct = r.requiredCount > 0 ? Math.min(100, Math.round((r.delivered / r.requiredCount) * 100)) : 0;
            return (
              <div key={r.id} className="flex items-center gap-4 border border-card-border rounded-xl p-3 bg-background/30">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-primary truncate">{r.campaign.name}</span>
                    {r.campaign.client?.name && <span className="text-[10px] text-text-muted font-mono">{r.campaign.client.name}</span>}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${r.status === 'fulfilled' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : r.status === 'paused' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-purple-500/10 text-purple-300 border-purple-500/20'}`}>
                      {r.status.replace('_', ' ')}
                    </span>
                  </div>
                  {r.notes && <p className="text-[10px] text-text-muted truncate mt-0.5">{r.notes}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1.5 bg-background border border-card-border rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-purple-500 to-purple-300" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] font-mono text-text-muted whitespace-nowrap">{r.delivered}/{r.requiredCount}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {r.dueDate && <span className="text-[10px] font-mono text-text-muted">due {new Date(r.dueDate).toLocaleDateString()}</span>}
                  <button onClick={() => remove(r.id)} className="text-text-muted hover:text-brand-red transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
