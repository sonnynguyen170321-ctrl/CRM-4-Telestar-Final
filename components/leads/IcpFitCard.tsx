'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, CircleHelp, Loader2, UserCheck, X } from 'lucide-react';

import { readApiError } from '@/lib/api/client';
import { effectiveQualification, type Qualification } from '@/lib/leads/effectiveQualification';
import { explainIcp, type ExplainableAssessment } from '@/lib/leads/explainIcp';
import { reasonLabel, reasonsFor } from '@/lib/leads/qualificationReasons';

import { QUALIFICATION_BAR, QUALIFICATION_CHIP, QUALIFICATION_LABEL } from './qualificationStyle';

/**
 * ICP fit in the lead drawer (owner request, 2026-10-06): what the score decided and why, in
 * words, and the rep's own verdict after reviewing the lead — which wins everywhere the CRM reads
 * qualification (lib/leads/effectiveQualification.ts). The review form opens in place; nothing
 * here is a modal.
 */

export type IcpFitLead = {
  id: string;
  icpFitScore?: number | null;
  icpQualification?: Qualification | null;
  icpScoredAt?: string | null;
  qualificationOverride?: Qualification | null;
  campaign?: { id: string } | null;
  icpAssessments?: Array<
    ExplainableAssessment & {
      id: string;
      confidenceScore: number;
      dataQualityScore: number;
      createdAt: string;
      icpVersion?: { versionNumber: number; icpProfile?: { name: string } | null } | null;
    }
  >;
  qualificationReviews?: Array<{
    id: string;
    verdict: Qualification | null;
    reasonCode: string;
    note: string | null;
    reviewedByName: string | null;
    createdAt: string;
  }>;
};

type Toast = (message: string, kind: 'success' | 'error') => void;

const VERDICTS: readonly Qualification[] = ['qualified', 'needs_review', 'unqualified'];

const STATUS: Record<'pass' | 'fail' | 'unknown', { icon: React.ReactNode; spoken: string }> = {
  pass: { icon: <Check className="w-3.5 h-3.5 text-green-700 dark:text-green-400" aria-hidden="true" />, spoken: 'Matches:' },
  fail: { icon: <X className="w-3.5 h-3.5 text-brand-red" aria-hidden="true" />, spoken: 'Does not match:' },
  unknown: { icon: <CircleHelp className="w-3.5 h-3.5 text-text-secondary" aria-hidden="true" />, spoken: 'Unknown:' },
};

const date = (iso: string) => new Date(iso).toLocaleDateString();

const textButton =
  'text-[11px] font-semibold rounded focus-ring hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed';

export function IcpFitCard({
  lead,
  isManager,
  onRefresh,
  showToast,
}: {
  lead: IcpFitLead;
  isManager: boolean;
  onRefresh: () => Promise<void>;
  showToast: Toast;
}) {
  const latest = lead.icpAssessments?.[0];
  const effective = effectiveQualification(lead);
  const explanation = latest ? explainIcp(latest) : null;
  const lastReview = lead.qualificationReviews?.[0];
  const [reviewing, setReviewing] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);
  const wasReviewing = useRef(false);

  // Focus goes back to the button that opened the form, whichever way it closed.
  useEffect(() => {
    if (wasReviewing.current && !reviewing) openButton.current?.focus();
    wasReviewing.current = reviewing;
  }, [reviewing]);

  async function rescoreCampaign() {
    if (!lead.campaign?.id) return;
    setRescoring(true);
    try {
      const res = await fetch('/api/leads/rescore-icp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: lead.campaign.id, onlyUnscored: false, limit: 500 }),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Rescore failed'), 'error');
        return;
      }
      const r = await res.json();
      showToast(`Rescored ${r.scored} lead(s) on this campaign${r.notScored ? `, ${r.notScored} not scored` : ''}`, r.scored > 0 ? 'success' : 'error');
      await onRefresh();
    } catch {
      showToast('Rescore failed — check your connection and try again', 'error');
    } finally {
      setRescoring(false);
    }
  }

  return (
    <div className="bg-card-bg border border-card-border rounded-xl p-4 space-y-3 shadow-xs" data-testid="icp-fit-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">ICP Fit</h3>
        {effective.value ? (
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${QUALIFICATION_CHIP[effective.value]}`}>
            {effective.source === 'human' && <UserCheck className="w-3 h-3" aria-hidden="true" />}
            {effective.source === 'computed' && lead.icpFitScore != null ? `${lead.icpFitScore}/100 · ` : ''}
            {QUALIFICATION_LABEL[effective.value]}
            {effective.source === 'human' && <span className="sr-only"> (set by a person after review)</span>}
          </span>
        ) : (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-card-border/30 text-text-secondary border-card-border">
            Not scored
          </span>
        )}
      </div>

      {effective.source === 'human' && lastReview?.verdict && (
        <div className="rounded-lg bg-bg-main border border-card-border px-3 py-2 space-y-0.5 break-words">
          <p className="text-[12px] text-text-primary">
            <span className="font-semibold">{QUALIFICATION_LABEL[lastReview.verdict]}</span> after review
            {lastReview.reviewedByName ? ` by ${lastReview.reviewedByName}` : ''} · {date(lastReview.createdAt)}
          </p>
          <p className="text-[12px] text-text-secondary">{reasonLabel(lastReview.reasonCode)}</p>
          {lastReview.note && <p className="text-[12px] text-text-secondary italic">“{lastReview.note}”</p>}
          {effective.disagrees && effective.computed && (
            <p className="text-[12px] text-text-secondary pt-0.5">
              Score now says {QUALIFICATION_LABEL[effective.computed]}
              {lead.icpFitScore != null ? ` (${lead.icpFitScore}/100)` : ''}.
            </p>
          )}
        </div>
      )}

      {lead.icpQualification && latest ? (
        <>
          <div className="h-2 bg-bg-main border border-card-border rounded-full overflow-hidden" aria-hidden="true">
            <div className={`h-full rounded-full transition-[width] ${QUALIFICATION_BAR[lead.icpQualification]}`} style={{ width: `${lead.icpFitScore ?? 0}%` }} />
          </div>
          {explanation && (
            <div className="space-y-2">
              <p className="text-[12px] leading-snug text-text-primary">{explanation.headline}</p>
              {explanation.checks.length > 0 && (
                <ul className="space-y-1.5" aria-label="What the score checked">
                  {explanation.checks.map((check) => (
                    <li key={`${check.status}:${check.label}`} className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0">{STATUS[check.status].icon}</span>
                      <span className="text-[12px] leading-snug">
                        <span className="sr-only">{STATUS[check.status].spoken} </span>
                        <span className="text-text-primary">{check.label}</span>
                        {check.detail && <span className="block text-text-secondary">{check.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="text-[11px] text-text-secondary">
            {latest.icpVersion?.icpProfile?.name ? `${latest.icpVersion.icpProfile.name} v${latest.icpVersion.versionNumber}` : 'Campaign ICP'}
            {lead.icpScoredAt ? ` · scored ${date(lead.icpScoredAt)}` : ''} · confidence {latest.confidenceScore}
          </p>
        </>
      ) : (
        <p className="text-[12px] text-text-secondary leading-normal">
          {lead.campaign?.id
            ? 'No ICP is published for this campaign, so there is nothing to score against. A manager can configure one under ICP & Scoring.'
            : 'This lead has no campaign, so there is no ICP to score it against.'}{' '}
          You can still record your own verdict.
        </p>
      )}

      {reviewing ? (
        <IcpReviewForm
          leadId={lead.id}
          current={lead.qualificationOverride ?? null}
          onCancel={() => setReviewing(false)}
          onSaved={async () => {
            setReviewing(false);
            await onRefresh();
          }}
          showToast={showToast}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            ref={openButton}
            type="button"
            onClick={() => setReviewing(true)}
            className={`${textButton} text-brand-red`}
            data-testid="icp-review-open"
          >
            {effective.source === 'human' ? 'Change my verdict' : 'Record my verdict'}
          </button>
          {isManager && lead.campaign?.id && (
            <button
              type="button"
              onClick={rescoreCampaign}
              disabled={rescoring}
              className={`${textButton} inline-flex items-center gap-1 text-text-secondary hover:text-text-primary`}
            >
              {rescoring && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
              Rescore this campaign
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function IcpReviewForm({
  leadId,
  current,
  onCancel,
  onSaved,
  showToast,
}: {
  leadId: string;
  current: Qualification | null;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  showToast: Toast;
}) {
  // No verdict picked for a first review: a preselected "Qualified" nudges the rep toward it.
  const [verdict, setVerdict] = useState<Qualification | null>(current);
  const [reasonCode, setReasonCode] = useState('');
  const [reasonReset, setReasonReset] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const firstRadio = useRef<HTMLInputElement>(null);
  const reasons = verdict ? reasonsFor(verdict) : [];
  const noteRequired = reasonCode === 'other';
  const canSave = Boolean(verdict && reasonCode) && (!noteRequired || note.trim().length > 0) && !saving;
  const group = `icp-verdict-${leadId}`;

  useEffect(() => {
    firstRadio.current?.focus();
  }, []);

  async function send(method: 'POST' | 'DELETE') {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/qualification`, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'POST' ? JSON.stringify({ verdict, reasonCode, note: note.trim() || undefined }) : undefined,
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Could not save your verdict'), 'error');
        return;
      }
      showToast(method === 'POST' && verdict ? `Marked ${QUALIFICATION_LABEL[verdict]}` : 'Verdict cleared — the score applies again', 'success');
      await onSaved();
    } catch {
      showToast('Could not save your verdict — check your connection and try again', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="rounded-lg border border-card-border bg-bg-main p-3 space-y-3"
      data-testid="icp-review-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void send('POST');
      }}
    >
      <fieldset>
        <legend className="text-[12px] font-semibold text-text-primary mb-1.5">Your verdict</legend>
        <div className="grid grid-cols-3 gap-1">
          {VERDICTS.map((v, i) => (
            <label
              key={v}
              className={`relative flex items-center justify-center px-2 py-1.5 rounded-md border text-[12px] font-semibold cursor-pointer transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-red/50 ${
                verdict === v ? QUALIFICATION_CHIP[v] : 'border-card-border text-text-secondary hover:bg-card-border/30'
              }`}
            >
              <input
                ref={i === 0 ? firstRadio : undefined}
                type="radio"
                name={group}
                value={v}
                checked={verdict === v}
                onChange={() => {
                  setVerdict(v);
                  const keep = reasonCode && reasonsFor(v).some((r) => r.code === reasonCode);
                  setReasonReset(Boolean(reasonCode) && !keep);
                  if (!keep) setReasonCode('');
                }}
                className="sr-only"
              />
              {QUALIFICATION_LABEL[v]}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`icp-reason-${leadId}`} className="block text-[12px] font-semibold text-text-primary mb-1">
          Why
        </label>
        <select
          id={`icp-reason-${leadId}`}
          value={reasonCode}
          onChange={(e) => {
            setReasonCode(e.target.value);
            setReasonReset(false);
          }}
          disabled={!verdict}
          required
          aria-describedby={reasonReset ? `icp-reason-reset-${leadId}` : undefined}
          className="w-full px-2.5 py-1.5 bg-card-bg border border-card-border rounded-md text-[12px] text-text-primary focus-ring focus:border-brand-red disabled:opacity-50"
        >
          <option value="">{verdict ? 'Choose a reason…' : 'Pick a verdict first'}</option>
          {reasons.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </select>
        {reasonReset && (
          <p id={`icp-reason-reset-${leadId}`} className="mt-1 text-[11px] text-text-secondary" role="status">
            That reason does not fit this verdict — choose another.
          </p>
        )}
      </div>
      <div>
        <label htmlFor={`icp-note-${leadId}`} className="block text-[12px] font-semibold text-text-primary mb-1">
          Note {noteRequired ? '(required)' : '(optional)'}
        </label>
        <textarea
          id={`icp-note-${leadId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="What you checked — e.g. confirmed on LinkedIn they run sales for APAC"
          className="w-full px-2.5 py-1.5 bg-card-bg border border-card-border rounded-md text-[12px] text-text-primary placeholder-text-secondary focus-ring focus:border-brand-red resize-none"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!canSave}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white text-[12px] font-semibold rounded-md transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="icp-review-save"
        >
          {saving && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
          Save verdict
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 text-[12px] font-semibold text-text-secondary hover:text-text-primary rounded-md focus-ring disabled:opacity-50"
        >
          Cancel
        </button>
        {current && (
          <button type="button" onClick={() => void send('DELETE')} disabled={saving} className={`${textButton} ml-auto text-text-secondary hover:text-brand-red`}>
            Clear my verdict
          </button>
        )}
      </div>
      <p className="text-[11px] text-text-secondary leading-snug">
        Your verdict is what lists, filters and counts use. The score stays visible, and a rescore never overwrites it.
      </p>
    </form>
  );
}
