'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  Lock,
  Unlock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import type { InternalInventoryMatchResult, MatchedContactCandidate } from '@/lib/contact-intelligence/matching';
import ContactIntelligenceBadge from '@/components/intelligence/ContactIntelligenceBadge';

interface InternalInventoryMatcherModalProps {
  campaignId: string;
  campaignName: string;
  isOpen: boolean;
  onClose: () => void;
  onAssigned?: (count: number) => void;
}

export default function InternalInventoryMatcherModal({
  campaignId,
  campaignName,
  isOpen,
  onClose,
  onAssigned,
}: InternalInventoryMatcherModalProps) {
  const [data, setData] = useState<InternalInventoryMatchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<{ assignedCount: number; skippedCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !campaignId) return;
    setLoading(true);
    setError(null);
    setAssignResult(null);

    fetch(`/api/campaigns/${campaignId}/requirements/preview-internal-match`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to match internal inventory');
        }
        return res.json();
      })
      .then((resData: InternalInventoryMatchResult) => {
        setData(resData);
        // Pre-select all eligible candidates
        const eligible = new Set(
          resData.candidates.filter((c) => c.isEligible).map((c) => c.contactId)
        );
        setSelectedIds(eligible);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [isOpen, campaignId]);

  if (!isOpen) return null;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAssign = async () => {
    if (selectedIds.size === 0) return;
    setAssigning(true);
    setError(null);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/assign-internal-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactIds: Array.from(selectedIds),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to assign contacts');
      }

      const result = await res.json();
      setAssignResult(result);
      if (onAssigned) onAssigned(result.assignedCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assignment failed');
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="bg-zinc-950 border border-zinc-800 w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                Internal Inventory Matcher & Reuse Engine
              </h3>
              <p className="text-xs text-zinc-400">
                Target Campaign: <span className="text-purple-300 font-semibold">{campaignName}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {loading && (
            <div className="py-16 text-center space-y-3">
              <Loader2 className="w-8 h-8 text-purple-400 animate-spin mx-auto" />
              <p className="text-xs text-zinc-400">Evaluating 10-step collision & safety rules across internal inventory…</p>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center gap-3 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {assignResult && (
            <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                Successfully Assigned {assignResult.assignedCount} Internal Contacts to {campaignName}!
              </div>
              {assignResult.skippedCount > 0 && (
                <p className="text-xs text-zinc-400">
                  {assignResult.skippedCount} contacts were skipped due to real-time safety collision checks.
                </p>
              )}
            </div>
          )}

          {!loading && data && !assignResult && (
            <>
              {/* Match Gap & Inventory Diagnostics */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800">
                  <span className="text-[10px] uppercase font-bold text-zinc-400">Total Matched</span>
                  <div className="text-lg font-bold text-zinc-100 mt-0.5">{data.totalMatched}</div>
                  <span className="text-[11px] text-zinc-500">In database</span>
                </div>

                <div className="p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                  <span className="text-[10px] uppercase font-bold text-emerald-400">Safety Eligible</span>
                  <div className="text-lg font-bold text-emerald-300 mt-0.5">{data.eligibleCount}</div>
                  <span className="text-[11px] text-emerald-500/80">
                    {data.provenCount} Proven · {data.promisingCount} Promising
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20">
                  <span className="text-[10px] uppercase font-bold text-amber-400">Cooldown / Locked</span>
                  <div className="text-lg font-bold text-amber-300 mt-0.5">
                    {data.cooldownCount + data.lockedCount}
                  </div>
                  <span className="text-[11px] text-amber-500/80">Protected assets</span>
                </div>

                <div className="p-3.5 rounded-xl bg-purple-500/5 border border-purple-500/20">
                  <span className="text-[10px] uppercase font-bold text-purple-400">External Gap</span>
                  <div className="text-lg font-bold text-purple-300 mt-0.5">
                    {data.gapCount}
                  </div>
                  <span className="text-[11px] text-purple-400/80">Needs external sourcing</span>
                </div>
              </div>

              {/* Candidates Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                    Candidate Asset Inventory ({data.candidates.length})
                  </h4>
                  <span className="text-xs text-zinc-400">
                    {selectedIds.size} selected for 1-click assignment
                  </span>
                </div>

                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/30 divide-y divide-zinc-800/80">
                  {data.candidates.length === 0 ? (
                    <div className="p-8 text-center text-xs text-zinc-500 italic">
                      No internal contacts matched this campaign&apos;s target criteria.
                    </div>
                  ) : (
                    data.candidates.map((candidate: MatchedContactCandidate) => {
                      const isSelected = selectedIds.has(candidate.contactId);
                      return (
                        <div
                          key={candidate.contactId}
                          onClick={() => candidate.isEligible && toggleSelect(candidate.contactId)}
                          className={`p-3.5 flex items-center justify-between gap-4 transition-colors ${
                            candidate.isEligible
                              ? isSelected
                                ? 'bg-purple-500/10 hover:bg-purple-500/15 cursor-pointer'
                                : 'hover:bg-zinc-900/60 cursor-pointer'
                              : 'opacity-50 bg-zinc-950/40 cursor-not-allowed'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!candidate.isEligible}
                              onChange={() => {}}
                              className="rounded border-zinc-700 text-purple-600 focus:ring-0 focus:ring-offset-0 bg-zinc-800 cursor-pointer disabled:opacity-40"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-zinc-200 truncate">
                                  {candidate.fullName}
                                </span>
                                <ContactIntelligenceBadge
                                  qualityClass={candidate.qualityClass}
                                  reuseStatus={candidate.reuseStatus}
                                  score={candidate.intrinsicQualityScore}
                                />
                              </div>
                              <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                                {candidate.title ? `${candidate.title} at ` : ''}
                                <span className="text-zinc-300 font-medium">{candidate.company || 'Unknown'}</span>
                                {candidate.country ? ` · ${candidate.country}` : ''}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 text-right flex-shrink-0">
                            {candidate.isEligible ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                <Unlock className="w-3 h-3" />
                                Ready
                              </span>
                            ) : (
                              <div className="flex flex-col items-end">
                                <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 font-medium bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                                  <Lock className="w-3 h-3" />
                                  Protected
                                </span>
                                <span className="text-[10px] text-zinc-500 mt-0.5 max-w-[150px] truncate">
                                  {candidate.reasons[0] || 'Ineligible'}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {assignResult ? 'Close' : 'Cancel'}
          </button>

          {!assignResult && (
            <button
              onClick={handleAssign}
              disabled={assigning || selectedIds.size === 0}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-purple-600/20"
            >
              {assigning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Assigning…
                </>
              ) : (
                <>
                  <span>Assign {selectedIds.size} Selected Contacts</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
