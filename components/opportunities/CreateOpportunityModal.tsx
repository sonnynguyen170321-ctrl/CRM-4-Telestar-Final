'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';

export default function CreateOpportunityModal({
  open,
  onClose,
  onCreated,
  clients,
  campaigns,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  clients: Map<string, string>;
  campaigns: Map<string, string>;
}) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [clientId, setClientId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [probability, setProbability] = useState('10');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [clientOwnerName, setClientOwnerName] = useState('');
  const [clientOwnerEmail, setClientOwnerEmail] = useState('');
  const [qualificationSummary, setQualificationSummary] = useState('');
  const [nextStep, setNextStep] = useState('');

  if (!open) return null;

  async function handleSubmit() {
    if (!title.trim() || !company.trim() || !clientId || !campaignId) {
      showToast('Title, company, client, and campaign are required', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          campaignId,
          title: title.trim(),
          company: company.trim(),
          contactName: contactName || undefined,
          contactEmail: contactEmail || undefined,
          value: value ? Number(value) : undefined,
          currency,
          probability: Number(probability),
          expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate).toISOString() : null,
          clientOwnerName: clientOwnerName || undefined,
          clientOwnerEmail: clientOwnerEmail || undefined,
          qualificationSummary: qualificationSummary || undefined,
          nextStep: nextStep || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? 'Failed to create opportunity', 'error');
        return;
      }

      showToast('Opportunity created', 'success');
      setTitle('');
      setCompany('');
      setValue('');
      setExpectedCloseDate('');
      setContactName('');
      setContactEmail('');
      setClientOwnerName('');
      setClientOwnerEmail('');
      setQualificationSummary('');
      setNextStep('');
      setClientId('');
      setCampaignId('');
      onCreated();
      onClose();
    } catch {
      showToast('Failed to create opportunity', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-card-border bg-card-bg p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Create Opportunity</h2>
          <button onClick={onClose} className="text-muted hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Title *</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Acme Corp - Q3 rollout"
                className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Company *</label>
              <input
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder="Company name"
                className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Client *</label>
              <select
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
              >
                <option value="">Select client</option>
                {[...clients.entries()].map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Campaign *</label>
              <select
                value={campaignId}
                onChange={e => setCampaignId(e.target.value)}
                className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
              >
                <option value="">Select campaign</option>
                {[...campaigns.entries()].map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Value</label>
              <input
                type="number"
                min={0}
                step="any"
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="0.00"
                className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Currency</label>
              <input
                value={currency}
                maxLength={3}
                onChange={e => setCurrency(e.target.value.toUpperCase())}
                className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Probability %</label>
              <input
                type="number"
                min={0}
                max={100}
                value={probability}
                onChange={e => setProbability(e.target.value)}
                className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Expected Close Date</label>
            <input
              type="date"
              value={expectedCloseDate}
              onChange={e => setExpectedCloseDate(e.target.value)}
              className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Contact Name</label>
              <input
                value={contactName}
                onChange={e => setContactName(e.target.value)}
                className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Contact Email</label>
              <input
                type="email"
                value={contactEmail}
                onChange={e => setContactEmail(e.target.value)}
                className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Client Owner Name</label>
              <input
                value={clientOwnerName}
                onChange={e => setClientOwnerName(e.target.value)}
                className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Client Owner Email</label>
              <input
                type="email"
                value={clientOwnerEmail}
                onChange={e => setClientOwnerEmail(e.target.value)}
                className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Qualification Summary</label>
            <textarea
              value={qualificationSummary}
              onChange={e => setQualificationSummary(e.target.value)}
              rows={2}
              className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Next Step</label>
            <input
              value={nextStep}
              onChange={e => setNextStep(e.target.value)}
              className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-card-border px-4 py-2 text-sm text-muted hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Opportunity'}
          </button>
        </div>
      </div>
    </div>
  );
}
