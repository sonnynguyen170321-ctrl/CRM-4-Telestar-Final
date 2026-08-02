'use client';

import React, { useState } from 'react';
import { Download, FileSpreadsheet, AlertCircle, Mail } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

const STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'imported', label: 'Imported' },
  { value: 'qa_pending', label: 'QA Pending' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'assigned_to_campaign', label: 'Assigned' },
  { value: 'disqualified', label: 'Disqualified' },
  { value: 'archived', label: 'Archived' },
];

const QUAL_OPTS = [
  { value: '', label: 'All qualifications' },
  { value: 'unreviewed', label: 'Unreviewed' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'needs_research', label: 'Needs Research' },
  { value: 'disqualified', label: 'Disqualified' },
  { value: 'duplicate', label: 'Duplicate' },
];

export default function ExportTab() {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [qualification, setQualification] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [exporting, setExporting] = useState(false);

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    if (qualification) params.set('qualification', qualification);
    if (sourceType) params.set('sourceType', sourceType);
    return `/api/leadgen-pool/export?${params.toString()}`;
  };

  const download = async (target: string) => {
    setExporting(true);
    try {
      const res = await fetch(target);
      if (!res.ok) throw new Error(await readApiError(res, 'Export failed'));
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="?([^";]+)"?/);
      const filename = match ? match[1] : `leadgen-pool-${Date.now()}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('CSV downloaded', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-card-bg border border-card-border rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="font-display font-bold text-sm text-text-primary">Internal Database Export</h3>
            <p className="text-[10px] text-text-muted uppercase">CSV · up to 10,000 records</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <label className="text-[10px] uppercase text-text-muted">Search filter</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="name, email, company, title, source…"
              className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-emerald-500/40"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-text-muted">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:outline-none">
              {STATUS_OPTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-text-muted">Qualification</label>
            <select value={qualification} onChange={(e) => setQualification(e.target.value)} className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:outline-none">
              {QUAL_OPTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-text-muted">Source type</label>
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:outline-none">
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
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-text-muted">Sheet</label>
            <select value="pool" disabled className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-xs text-text-muted opacity-60">
              <option value="pool">Pool records</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={() => download(buildUrl())}
            disabled={exporting}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {exporting ? 'Preparing…' : 'Download CSV'}
          </button>
          <span className="text-[10px] text-text-muted font-mono">Fields: contact, company, title, email, phone, linkedIn, source, scores, status</span>
        </div>
      </div>

      <div className="bg-card-bg border border-card-border rounded-2xl p-5 flex items-start gap-3">
        <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <p className="text-xs font-semibold text-text-primary">Reuse exports for list-building</p>
          <p className="text-xs text-text-secondary leading-relaxed">
            Exported CSVs can be re-imported via the Import Center later. Qualified records carry{' '}
            <Mail className="inline w-3 h-3 text-emerald-400" /> email validation + deliverability scores when present.
          </p>
        </div>
      </div>
    </div>
  );
}
