'use client';

import React, { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

interface MeetingOutcomeModalProps {
  meetingId: string;
  meetingTitle: string;
  onClose: () => void;
  onOutcomeLogged?: () => void;
}

const STATUS_OPTIONS = [
  { value: 'completed', label: 'Completed', color: 'emerald' },
  { value: 'no_show', label: 'No Show', color: 'red' },
  { value: 'cancelled', label: 'Cancelled', color: 'gray' },
  { value: 'rescheduled', label: 'Rescheduled', color: 'purple' },
] as const;

const OUTCOME_OPTIONS = [
  { value: 'qualified_opportunity', label: 'Qualified Opportunity' },
  { value: 'completed_not_qualified', label: 'Completed — Not Qualified' },
  { value: 'no_show', label: 'No Show' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'no_decision', label: 'No Decision' },
  { value: 'other', label: 'Other' },
];

export default function MeetingOutcomeModal({
  meetingId,
  meetingTitle,
  onClose,
  onOutcomeLogged,
}: MeetingOutcomeModalProps) {
  const { showToast } = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('completed');
  const [outcome, setOutcome] = useState<string>('qualified_opportunity');
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [painPoints, setPainPoints] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [createOpportunity, setCreateOpportunity] = useState(true);
  const [opportunityValue, setOpportunityValue] = useState('');
  const [opportunityCurrency, setOpportunityCurrency] = useState('USD');
  const [opportunityClientOwnerName, setOpportunityClientOwnerName] = useState('');
  const [opportunityClientOwnerEmail, setOpportunityClientOwnerEmail] = useState('');
  const [qualificationSummary, setQualificationSummary] = useState('');

  const willCreateOpportunity =
    createOpportunity && status === 'completed' && outcome === 'qualified_opportunity';

  async function handleSubmit() {
    if (!status || !outcome) {
      showToast('Please select a status and outcome', 'error');
      return;
    }

    if (willCreateOpportunity) {
      if (!qualificationSummary.trim()) {
        showToast('Qualification summary is required when creating an opportunity', 'error');
        return;
      }
      if (!nextStep.trim()) {
        showToast('Next step is required when creating an opportunity', 'error');
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          outcome,
          outcomeNotes: outcomeNotes || undefined,
          painPoints: painPoints || undefined,
          nextStep: nextStep || undefined,
          createOpportunity: willCreateOpportunity,
          opportunityValue: opportunityValue ? Number(opportunityValue) : undefined,
          opportunityCurrency: opportunityCurrency || undefined,
          opportunityClientOwnerName: opportunityClientOwnerName || undefined,
          opportunityClientOwnerEmail: opportunityClientOwnerEmail || undefined,
          qualificationSummary: willCreateOpportunity ? qualificationSummary : undefined,
        }),
      });

      if (!res.ok) {
        const msg = await readApiError(res, 'Failed to log meeting outcome');
        showToast(msg, 'error');
        return;
      }

      const data = await res.json();

      if (data.opportunity?.id) {
        showToast(
          'Outcome logged — Opportunity created! Redirecting…',
          'success'
        );
        // Brief delay so user sees the toast before redirect
        setTimeout(() => router.push(`/opportunities`), 1200);
      } else {
        showToast('Meeting outcome logged', 'success');
      }

      onOutcomeLogged?.();
      onClose();
    } catch {
      showToast('Failed to log outcome', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card-bg border border-card-border rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-card-border">
          <div>
            <h2 className="text-lg font-semibold text-white">Log Meeting Outcome</h2>
            <p className="text-sm text-muted mt-0.5">{meetingTitle}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-muted mb-2">Meeting Status *</label>
            <div className="grid grid-cols-2 gap-2">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setStatus(opt.value);
                    // Auto-set matching outcome
                    if (opt.value === 'no_show') setOutcome('no_show');
                    else if (opt.value === 'cancelled') setOutcome('cancelled');
                    else if (opt.value === 'rescheduled') setOutcome('rescheduled');
                    else setOutcome('qualified_opportunity');
                    setCreateOpportunity(opt.value === 'completed');
                  }}
                  className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                    status === opt.value
                      ? opt.color === 'emerald' ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : opt.color === 'red' ? 'bg-red-500/15 border-red-500/40 text-red-400'
                      : opt.color === 'purple' ? 'bg-purple-500/15 border-purple-500/40 text-purple-400'
                      : 'bg-gray-500/15 border-gray-500/40 text-gray-400'
                      : 'bg-surface border-card-border text-muted hover:text-white hover:border-card-border-hover'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Outcome */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Outcome *</label>
            <select
              value={outcome}
              onChange={e => setOutcome(e.target.value)}
              className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-brand-red/50 focus:border-brand-red/50 outline-none"
            >
              {OUTCOME_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Opportunity creation — only for completed + qualified */}
          {status === 'completed' && outcome === 'qualified_opportunity' && (
            <div className="space-y-4 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createOpportunity}
                  onChange={e => setCreateOpportunity(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500"
                />
                <span className="text-sm font-medium text-emerald-400">Create opportunity</span>
              </label>

              {willCreateOpportunity && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1.5">
                        Value <span className="text-muted/60">(optional)</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={opportunityValue}
                        onChange={e => setOpportunityValue(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1.5">Currency</label>
                      <input
                        type="text"
                        maxLength={3}
                        value={opportunityCurrency}
                        onChange={e => setOpportunityCurrency(e.target.value.toUpperCase())}
                        className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">
                      Qualification Summary <span className="text-emerald-400">*</span>
                    </label>
                    <textarea
                      value={qualificationSummary}
                      onChange={e => setQualificationSummary(e.target.value)}
                      rows={2}
                      placeholder="Why is this a qualified opportunity? Budget, authority, need, timeline..."
                      className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1.5">
                        Client Owner Name <span className="text-muted/60">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={opportunityClientOwnerName}
                        onChange={e => setOpportunityClientOwnerName(e.target.value)}
                        placeholder="e.g. Sarah Johnson"
                        className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1.5">
                        Client Owner Email <span className="text-muted/60">(optional)</span>
                      </label>
                      <input
                        type="email"
                        value={opportunityClientOwnerEmail}
                        onChange={e => setOpportunityClientOwnerEmail(e.target.value)}
                        placeholder="owner@client.com"
                        className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Outcome Notes */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">
              Outcome Notes <span className="text-muted/60">(optional)</span>
            </label>
            <textarea
              value={outcomeNotes}
              onChange={e => setOutcomeNotes(e.target.value)}
              rows={3}
              placeholder="Summary of the meeting outcome..."
              className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-brand-red/50 focus:border-brand-red/50 outline-none resize-none"
            />
          </div>

          {/* Pain Points — only for completed */}
          {status === 'completed' && (
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">
                Pain Points <span className="text-muted/60">(optional)</span>
              </label>
              <textarea
                value={painPoints}
                onChange={e => setPainPoints(e.target.value)}
                rows={2}
                placeholder="Key challenges discussed..."
                className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-brand-red/50 focus:border-brand-red/50 outline-none resize-none"
              />
            </div>
          )}

          {/* Next Step */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">
              Next Step <span className="text-muted/60">(optional)</span>
            </label>
            <textarea
              value={nextStep}
              onChange={e => setNextStep(e.target.value)}
              rows={2}
              placeholder="Follow-up action items..."
              className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-brand-red/50 focus:border-brand-red/50 outline-none resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-5 border-t border-card-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 bg-brand-red hover:bg-brand-red/90 text-white shadow-md shadow-brand-red/20"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Log Outcome
          </button>
        </div>
      </div>
    </div>
  );
}
