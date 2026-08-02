'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, FileBarChart, Sparkles, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { ClientReportSnapshot, ReportAudience, ReportPeriodType, SdrDisplayMode } from '@/lib/client-reports/types';

interface ClientItem {
  id: string;
  name: string;
}

interface CampaignItem {
  id: string;
  name: string;
  clientId: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateClientReportModal({ isOpen, onClose }: Props) {
  const router = useRouter();
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(false);

  // Form State
  const [clientId, setClientId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [title, setTitle] = useState('');
  const [periodType, setPeriodType] = useState<ReportPeriodType>('weekly');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [audience, setAudience] = useState<ReportAudience>('client');
  const [sdrDisplayMode, setSdrDisplayMode] = useState<SdrDisplayMode>('first_last_initial');

  // Preview & Submit State
  const [previewing, setPreviewing] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState<ClientReportSnapshot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize default date range (past 7 days)
  useEffect(() => {
    if (isOpen) {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 7);

      setPeriodStart(start.toISOString().split('T')[0]);
      setPeriodEnd(end.toISOString().split('T')[0]);
      setPreviewSnapshot(null);
      setError(null);

      // Fetch clients
      setLoadingInitial(true);
      fetch('/api/clients')
        .then((res) => res.json())
        .then((data) => {
          if (data.clients) setClients(data.clients);
        })
        .catch(() => {})
        .finally(() => setLoadingInitial(false));

      // Fetch campaigns
      fetch('/api/campaigns')
        .then((res) => res.json())
        .then((data) => {
          if (data.campaigns) setCampaigns(data.campaigns);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  // Auto-generate title on change
  useEffect(() => {
    if (clientId) {
      const client = clients.find((c) => c.id === clientId);
      const campaign = campaigns.find((c) => c.id === campaignId);
      const clientName = client ? client.name : 'Client';
      const campName = campaign ? ` - ${campaign.name}` : '';
      const periodLabel = periodType === 'weekly' ? 'Weekly' : periodType === 'monthly' ? 'Monthly' : 'Custom';
      setTitle(`${clientName}${campName} (${periodLabel} Performance Report)`);
    }
  }, [clientId, campaignId, periodType, clients, campaigns]);

  if (!isOpen) return null;

  const filteredCampaigns = campaigns.filter((c) => !clientId || c.clientId === clientId);

  const handlePreview = async () => {
    if (!clientId) {
      setError('Please select a client');
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const res = await fetch('/api/client-reports/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          campaignId: campaignId || undefined,
          periodStart: new Date(periodStart).toISOString(),
          periodEnd: new Date(periodEnd).toISOString(),
          periodType,
          audience,
          sdrDisplayMode,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate preview');
      setPreviewSnapshot(data.snapshot);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPreviewing(false);
    }
  };

  const handleCreate = async () => {
    if (!clientId) {
      setError('Please select a client');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/client-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          campaignId: campaignId || undefined,
          title,
          periodType,
          periodStart: new Date(periodStart).toISOString(),
          periodEnd: new Date(periodEnd).toISOString(),
          audience,
          sdrDisplayMode,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create report');

      onClose();
      router.push(`/client-reports/${data.report.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-card-bg border border-card-border rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-card-border flex items-center justify-between bg-card-border/40/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-brand-red/10 text-brand-red">
              <FileBarChart className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-primary">Generate Campaign Report</h3>
              <p className="text-xs text-muted-foreground">
                Aggregate omnichannel metrics, meetings, opportunities & insights
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-text-primary hover:bg-card-border/40 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Form Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Client Select */}
            <div>
              <label className="text-xs font-medium text-text-primary block mb-1">
                Client <span className="text-red-500">*</span>
              </label>
              <select
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  setCampaignId('');
                }}
                className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:ring-1 focus:ring-brand-red focus:outline-none"
              >
                <option value="">Select a client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Campaign Select */}
            <div>
              <label className="text-xs font-medium text-text-primary block mb-1">
                Campaign <span className="text-muted-foreground">(Optional)</span>
              </label>
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                disabled={!clientId}
                className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary disabled:opacity-50 focus:ring-1 focus:ring-brand-red focus:outline-none"
              >
                <option value="">All Campaigns for Client</option>
                {filteredCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Period Type */}
            <div>
              <label className="text-xs font-medium text-text-primary block mb-1">Period Cadence</label>
              <select
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value as ReportPeriodType)}
                className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:ring-1 focus:ring-brand-red focus:outline-none"
              >
                <option value="weekly">Weekly Report</option>
                <option value="monthly">Monthly Report</option>
                <option value="custom">Custom Date Range</option>
              </select>
            </div>

            {/* Audience Mode */}
            <div>
              <label className="text-xs font-medium text-text-primary block mb-1">Audience Scope</label>
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value as ReportAudience)}
                className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:ring-1 focus:ring-brand-red focus:outline-none"
              >
                <option value="client">Client-Facing (Sanitized)</option>
                <option value="internal">Internal Team Review</option>
              </select>
            </div>

            {/* Date Pickers */}
            <div>
              <label className="text-xs font-medium text-text-primary block mb-1">Period Start</label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:ring-1 focus:ring-brand-red focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-primary block mb-1">Period End</label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:ring-1 focus:ring-brand-red focus:outline-none"
              />
            </div>
          </div>

          {/* Title input */}
          <div>
            <label className="text-xs font-medium text-text-primary block mb-1">Report Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Acme Corp - Weekly Campaign Performance"
              className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:ring-1 focus:ring-brand-red focus:outline-none"
            />
          </div>

          {/* Live Preview Card */}
          {previewSnapshot && (
            <div className="p-4 bg-card-border/40/40 border border-card-border rounded-xl space-y-3 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Live Data Snapshot Preview
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {previewSnapshot.meta.clientName} &bull; {previewSnapshot.kpis.totalLeadsAssigned} leads assigned
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div className="p-2 bg-card-bg border border-card-border/70 rounded-lg">
                  <div className="text-[10px] text-muted-foreground uppercase font-medium">Contacted</div>
                  <div className="text-base font-bold text-text-primary">{previewSnapshot.kpis.leadsTouched}</div>
                </div>
                <div className="p-2 bg-card-bg border border-card-border/70 rounded-lg">
                  <div className="text-[10px] text-muted-foreground uppercase font-medium">Replies</div>
                  <div className="text-base font-bold text-text-primary">{previewSnapshot.kpis.replies}</div>
                </div>
                <div className="p-2 bg-card-bg border border-card-border/70 rounded-lg">
                  <div className="text-[10px] text-muted-foreground uppercase font-medium">Booked Mtgs</div>
                  <div className="text-base font-bold text-text-primary">{previewSnapshot.kpis.meetingsBooked}</div>
                </div>
                <div className="p-2 bg-card-bg border border-card-border/70 rounded-lg">
                  <div className="text-[10px] text-muted-foreground uppercase font-medium">Accepted Ops</div>
                  <div className="text-base font-bold text-text-primary">{previewSnapshot.kpis.clientAcceptedOpportunities}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-card-border bg-card-border/40/20 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handlePreview}
            disabled={previewing || !clientId}
            className="px-3.5 py-2 bg-card-border/40 hover:bg-card-border/40/80 disabled:opacity-50 text-text-primary rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-brand-red" />
            {previewing ? 'Aggregating...' : 'Preview Live Metrics'}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 border border-card-border text-text-primary hover:bg-card-border/40 rounded-lg text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={submitting || !clientId}
              className="px-4 py-2 bg-brand-red hover:bg-brand-red/90 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5"
            >
              {submitting ? 'Generating Report...' : 'Create Report Draft'}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
