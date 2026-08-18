'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  Award,
  Activity,
  Users,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Sparkles,
  History,
  Lock,
  Unlock,
  Loader2,
} from 'lucide-react';
import type { ContactIntelligence, ContactEvidence } from '@prisma/client';
import type { ContactIntelligenceExplainability } from '@/lib/contact-intelligence/explainability';
import ContactIntelligenceBadge from './ContactIntelligenceBadge';

interface ContactIntelligenceDrawerProps {
  contactId: string | null;
  contactName?: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function ContactIntelligenceDrawer({
  contactId,
  contactName = 'Contact',
  isOpen,
  onClose,
}: ContactIntelligenceDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intelligence, setIntelligence] = useState<ContactIntelligence | null>(null);
  const [explainability, setExplainability] = useState<ContactIntelligenceExplainability | null>(null);
  const [evidenceLedger, setEvidenceLedger] = useState<ContactEvidence[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'evidence' | 'scores'>('overview');

  useEffect(() => {
    if (!isOpen || !contactId) return;

    let mounted = true;
    setLoading(true);
    setError(null);

    fetch(`/api/contacts/${contactId}/intelligence`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load intelligence (status ${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (mounted) {
          setIntelligence(data.intelligence);
          setExplainability(data.explainability);
          setEvidenceLedger(data.evidence || []);
        }
      })
      .catch((err) => {
        if (mounted) setError(err.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [isOpen, contactId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end transition-opacity animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-zinc-950 border-l border-zinc-800 h-full shadow-2xl flex flex-col transform transition-transform duration-300 ease-out">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                Commercial Intelligence Asset
                <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                  v{intelligence?.scoringVersion || '1.0'}
                </span>
              </h2>
              <p className="text-xs text-zinc-400">{contactName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 border-b border-zinc-800 flex gap-6 text-xs font-medium text-zinc-400 bg-zinc-900/30">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'overview'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent hover:text-zinc-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Assessment & Explainability
          </button>
          <button
            onClick={() => setActiveTab('scores')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'scores'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent hover:text-zinc-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            5-Dimension Breakdown
          </button>
          <button
            onClick={() => setActiveTab('evidence')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'evidence'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent hover:text-zinc-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Evidence Ledger ({evidenceLedger.length})
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="py-20 flex flex-col items-center justify-center text-zinc-400 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
              <p className="text-xs">Computing real-time commercial intelligence profile...</p>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-rose-400" />
              <p>{error}</p>
            </div>
          )}

          {!loading && !error && intelligence && (
            <>
              {/* Asset Badges & Status Card */}
              <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ContactIntelligenceBadge
                      qualityClass={intelligence.qualityClass}
                      score={intelligence.intrinsicQualityScore}
                      size="md"
                    />
                    <ContactIntelligenceBadge
                      reuseStatus={intelligence.reuseStatus}
                      size="md"
                    />
                  </div>
                  <span className="text-xs text-zinc-500">
                    State: <strong className="text-zinc-300 capitalize">{intelligence.lifecycleState.replace(/_/g, ' ')}</strong>
                  </span>
                </div>

                {intelligence.intelligenceSummary && (
                  <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800/60">
                    {intelligence.intelligenceSummary}
                  </p>
                )}
              </div>

              {/* TAB 1: OVERVIEW & EXPLAINABILITY */}
              {activeTab === 'overview' && explainability && (
                <div className="space-y-5">
                  {/* Overall Assessment */}
                  <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-950/20 to-zinc-900 border border-emerald-500/20 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
                      <Award className="w-4 h-4" />
                      Executive Summary
                    </div>
                    <p className="text-sm text-zinc-200 leading-relaxed font-medium">
                      {explainability.overallAssessment}
                    </p>
                  </div>

                  {/* Recommended Action */}
                  <div className="p-4 rounded-xl bg-blue-950/20 border border-blue-500/20 space-y-2">
                    <div className="flex items-center gap-2 text-blue-400 text-xs font-semibold uppercase tracking-wider">
                      <Lightbulb className="w-4 h-4" />
                      Recommended Campaign Strategy
                    </div>
                    <p className="text-xs text-blue-200 leading-relaxed">
                      {explainability.recommendedAction}
                    </p>
                  </div>

                  {/* Strengths & Risks Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Strengths */}
                    <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3">
                      <h4 className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Key Asset Strengths
                      </h4>
                      {explainability.keyStrengths.length === 0 ? (
                        <p className="text-xs text-zinc-500 italic">No major strengths recorded yet.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {explainability.keyStrengths.map((str, idx) => (
                            <li key={idx} className="text-xs text-zinc-300 flex items-start gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />
                              <span>{str}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Risk & Caution Factors */}
                    <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3">
                      <h4 className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Gaps & Caution Factors
                      </h4>
                      {explainability.riskFactors.length === 0 ? (
                        <p className="text-xs text-zinc-500 italic">Zero friction or risk flags observed.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {explainability.riskFactors.map((risk, idx) => (
                            <li key={idx} className="text-xs text-zinc-300 flex items-start gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                              <span>{risk}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {/* Reuse Governance Info */}
                  <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                        {intelligence.reuseStatus === 'ready' ? (
                          <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Lock className="w-3.5 h-3.5 text-amber-400" />
                        )}
                        Reuse & Safety Clearance
                      </span>
                      <span className="text-[11px] text-zinc-500 font-mono">
                        {intelligence.campaignCount} prior campaign{intelligence.campaignCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-400 space-y-1">
                      {(explainability.reuseReasons || []).map((reason: string, idx: number) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <span className="w-1 h-1 rounded-full bg-zinc-600" />
                          <span>{reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: 5-DIMENSION SCORES */}
              {activeTab === 'scores' && (
                <div className="space-y-4">
                  {/* Intrinsic Quality */}
                  <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-emerald-400" />
                        Intrinsic Persona Quality
                      </span>
                      <span className="font-mono font-bold text-emerald-400">
                        {intelligence.intrinsicQualityScore}/100
                      </span>
                    </div>
                    <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${intelligence.intrinsicQualityScore}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Evaluates title seniority, role relevance, domain quality, and multi-channel completeness.
                    </p>
                  </div>

                  {/* Data Confidence */}
                  <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-blue-400" />
                        Data Verification Confidence
                      </span>
                      <span className="font-mono font-bold text-blue-400">
                        {intelligence.dataConfidenceScore}/100
                      </span>
                    </div>
                    <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                        style={{ width: `${intelligence.dataConfidenceScore}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Evaluates deliverability validations, human QA confirmation, and secondary contact verification.
                    </p>
                  </div>

                  {/* Engagement Score */}
                  <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                        <Activity className="w-4 h-4 text-purple-400" />
                        Historical Engagement Level
                      </span>
                      <span className="font-mono font-bold text-purple-400">
                        {intelligence.engagementScore}/100
                      </span>
                    </div>
                    <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full transition-all duration-500"
                        style={{ width: `${intelligence.engagementScore}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-zinc-500 pt-1">
                      <span>{intelligence.touchCount} Touches</span>
                      <span>{intelligence.replyCount} Replies</span>
                      <span>{intelligence.positiveReplyCount} Positive</span>
                      <span>{intelligence.meetingBookedCount} Booked</span>
                    </div>
                  </div>

                  {/* Relationship Score */}
                  <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-amber-400" />
                        Commercial Relationship Equity
                      </span>
                      <span className="font-mono font-bold text-amber-400">
                        {intelligence.relationshipScore}/100
                      </span>
                    </div>
                    <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full transition-all duration-500"
                        style={{ width: `${intelligence.relationshipScore}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-zinc-500 pt-1">
                      <span>{intelligence.meetingCompletedCount} Completed Mtgs</span>
                      <span>{intelligence.acceptedOpportunityCount} Accepted Opps</span>
                      <span>{intelligence.wonOpportunityCount} Deals Won</span>
                    </div>
                  </div>

                  {/* Freshness Score */}
                  <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-emerald-400" />
                        Data & Signal Recency (Freshness)
                      </span>
                      <span className="font-mono font-bold text-emerald-400">
                        {intelligence.freshnessScore}/100
                      </span>
                    </div>
                    <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${intelligence.freshnessScore}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Decays smoothly as data ages without fresh interaction or verification confirmation.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 3: EVIDENCE LEDGER */}
              {activeTab === 'evidence' && (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-400">
                      Immutable evidence ledger entries ({evidenceLedger.length})
                    </span>
                    <span className="text-[11px] text-zinc-500">Chronological (Newest first)</span>
                  </div>

                  {evidenceLedger.length === 0 ? (
                    <div className="p-8 text-center text-xs text-zinc-500 bg-zinc-900/40 rounded-xl border border-zinc-800">
                      No explicit evidence records logged yet. Evidence is recorded automatically as outreach, replies, meetings, and QA events occur.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {evidenceLedger.map((ev) => (
                        <div
                          key={ev.id}
                          className="p-3 rounded-lg bg-zinc-900/70 border border-zinc-800 space-y-1.5 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-zinc-200 font-mono">
                                {ev.evidenceType}
                              </span>
                              {ev.humanConfirmed && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                                  Human Confirmed
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-zinc-500">
                              {new Date(ev.observedAt).toLocaleString()}
                            </span>
                          </div>

                          {ev.summary && (
                            <p className="text-zinc-300 text-xs">{ev.summary}</p>
                          )}

                          <div className="flex items-center gap-4 text-[11px] text-zinc-500 pt-1">
                            <span>Source: <strong className="text-zinc-400">{ev.sourceType}</strong></span>
                            <span>Confidence: <strong className="text-zinc-400">{ev.confidence}%</strong></span>
                            <span>Scope: <strong className="text-zinc-400">{ev.reuseScope}</strong></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
