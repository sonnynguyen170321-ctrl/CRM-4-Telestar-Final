'use client';

import React from 'react';
import { Loader2, AlertTriangle, Info, Lock, Mail } from 'lucide-react';

export type RemovalMode = 'keep_existing_work' | 'transfer_work' | 'pause_tasks';

export interface SuggestedTarget {
  id: string;
  name: string;
  role: string;
  requiresCampaignAdd: boolean;
}

export interface UserImpact {
  userId: string;
  campaignId: string | null;
  openLeads: number;
  totalLeads: number;
  openTasks: number;
  lockedTasks: number;
  scheduledMeetings: number;
  openOpportunities: number;
  campaignMemberships: number;
  activeEmailAccounts: number;
  leadPoolItems: number;
  totalOpen: number;
  canRemoveSafely: boolean;
  recommendedAction: 'safe_remove' | 'transfer_work' | 'pause_tasks' | 'blocked';
  suggestedTargets: SuggestedTarget[];
}

export interface ImpactChoice {
  mode: RemovalMode | null;
  transferToUserId: string;
  reason: string;
}

interface Props {
  impact: UserImpact | null;
  isLoading: boolean;
  subjectName: string;
  /** "campaign" tunes the copy for member removal; "user" for deactivation. */
  context: 'campaign' | 'user';
  choice: ImpactChoice;
  onChoiceChange: (next: ImpactChoice) => void;
}

/**
 * Shows what a person still owns, and forces a decision about it.
 *
 * This is the component the "no silent removal" guarantee rests on: the parent
 * dialog keeps its confirm button disabled until `isChoiceComplete` returns true
 * for the choice this panel produces.
 */
export default function ImpactPanel({
  impact,
  isLoading,
  subjectName,
  context,
  choice,
  onChoiceChange,
}: Props) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-text-muted text-xs font-mono py-4">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking what {subjectName} owns…
      </div>
    );
  }

  if (!impact) {
    return (
      <p className="text-xs text-brand-red">
        Could not load the impact check. Refusing to continue without it.
      </p>
    );
  }

  const set = (patch: Partial<ImpactChoice>) => onChoiceChange({ ...choice, ...patch });

  const scopeLabel =
    context === 'campaign' ? 'in this campaign' : 'across all campaigns';

  if (impact.totalOpen === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 p-3 bg-bg-main/50 border border-card-border rounded-xl">
          <Info className="w-4 h-4 text-text-muted shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-text-secondary leading-normal">
            <span className="font-semibold text-text-primary">{subjectName}</span> owns no open work{' '}
            {scopeLabel}. Nothing will be orphaned.
          </p>
        </div>
        {impact.activeEmailAccounts > 0 && context === 'user' && (
          <MailboxWarning count={impact.activeEmailAccounts} />
        )}
      </div>
    );
  }

  const counts: Array<[number, string]> = [
    [impact.openLeads, 'open lead'],
    [impact.openTasks, 'open task'],
    [impact.scheduledMeetings, 'scheduled meeting'],
    [impact.openOpportunities, 'open opportunity'],
  ];

  return (
    <div className="space-y-3.5">
      <div className="p-3 bg-brand-red/5 border border-brand-red/20 rounded-xl space-y-2">
        <div className="flex items-center gap-1.5 text-brand-red font-semibold text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{subjectName} still owns live work {scopeLabel}</span>
        </div>
        <ul className="space-y-1 pl-5.5">
          {counts
            .filter(([n]) => n > 0)
            .map(([n, label]) => (
              <li key={label} className="text-xs text-text-secondary">
                <span className="font-mono font-semibold text-text-primary">{n}</span>{' '}
                {label}
                {n === 1 ? '' : label.endsWith('y') ? 'ies' : 's'}
              </li>
            ))}
        </ul>
      </div>

      {impact.lockedTasks > 0 && (
        <div className="flex items-start gap-2 p-2.5 bg-bg-main/50 border border-card-border rounded-xl">
          <Lock className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-text-secondary leading-normal">
            <span className="font-mono font-semibold text-text-primary">{impact.lockedTasks}</span>{' '}
            task{impact.lockedTasks === 1 ? ' is' : 's are'} mid-send and will stay with{' '}
            {subjectName}. Re-run in a few minutes to move {impact.lockedTasks === 1 ? 'it' : 'them'}.
          </p>
        </div>
      )}

      {impact.activeEmailAccounts > 0 && context === 'user' && (
        <MailboxWarning count={impact.activeEmailAccounts} />
      )}

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-text-primary mb-1.5">
          What happens to this work?
        </legend>

        <ModeOption
          value="transfer_work"
          checked={choice.mode === 'transfer_work'}
          onSelect={() => set({ mode: 'transfer_work' })}
          disabled={impact.suggestedTargets.length === 0}
          label="Transfer to another user"
          hint={
            impact.suggestedTargets.length === 0
              ? 'No eligible active user in your scope — activate or create one first.'
              : 'Leads, open tasks, upcoming meetings and open opportunities move across.'
          }
          recommended={impact.recommendedAction === 'transfer_work'}
        />

        {choice.mode === 'transfer_work' && (
          <div className="pl-6 space-y-1.5">
            <select
              value={choice.transferToUserId}
              onChange={(e) => set({ transferToUserId: e.target.value })}
              className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red text-xs"
            >
              <option value="">Select a user…</option>
              {impact.suggestedTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.role.replace('_', ' ')})
                  {t.requiresCampaignAdd ? ' — will be added to the campaign' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-muted leading-normal">
              Historical attribution stays put: who created an opportunity and who logged a
              meeting outcome do not change.
            </p>
          </div>
        )}

        <ModeOption
          value="pause_tasks"
          checked={choice.mode === 'pause_tasks'}
          onSelect={() => set({ mode: 'pause_tasks' })}
          label="Pause the work"
          hint="Open tasks are skipped and their sequences paused, so nothing regenerates or sends."
          recommended={impact.recommendedAction === 'pause_tasks'}
        />

        <ModeOption
          value="keep_existing_work"
          checked={choice.mode === 'keep_existing_work'}
          onSelect={() => set({ mode: 'keep_existing_work' })}
          label={
            context === 'campaign'
              ? 'Remove from future assignment only'
              : 'Leave the work where it is'
          }
          hint={
            context === 'campaign'
              ? `${subjectName} keeps what they already hold but gets no new work from this campaign.`
              : 'Nothing moves. The work stays owned by a deactivated user.'
          }
        />
      </fieldset>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-text-primary">
          Reason <span className="text-brand-red">*</span>
        </span>
        <textarea
          value={choice.reason}
          onChange={(e) => set({ reason: e.target.value })}
          rows={2}
          placeholder="e.g. Left the company — book moved to Minh"
          className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red text-xs resize-none"
        />
        <span className="text-xs text-text-muted">Recorded in the admin audit log.</span>
      </label>

      {impact.leadPoolItems > 0 && (
        <p className="text-xs text-text-muted leading-normal">
          Note: {impact.leadPoolItems} leadgen pool row(s) also reference this user. Those are not
          moved by this action.
        </p>
      )}
    </div>
  );
}

function MailboxWarning({ count }: { count: number }) {
  return (
    <div className="flex items-start gap-2 p-2.5 bg-bg-main/50 border border-card-border rounded-xl">
      <Mail className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-xs text-text-secondary leading-normal">
        <span className="font-mono font-semibold text-text-primary">{count}</span> connected mailbox
        {count === 1 ? '' : 'es'} can still send. Deactivating the user does not stop delivery on its
        own — sending will be paused as part of this action.
      </p>
    </div>
  );
}

function ModeOption({
  value,
  checked,
  onSelect,
  label,
  hint,
  disabled = false,
  recommended = false,
}: {
  value: RemovalMode;
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
  disabled?: boolean;
  recommended?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-2 p-2.5 rounded-xl border transition-colors ${
        disabled
          ? 'border-card-border opacity-50 cursor-not-allowed'
          : checked
            ? 'border-brand-red/40 bg-brand-red/5 cursor-pointer'
            : 'border-card-border hover:border-brand-orange/40 cursor-pointer'
      }`}
    >
      <input
        type="radio"
        name="removal-mode"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 accent-brand-red"
      />
      <span className="space-y-0.5">
        <span className="block text-xs font-semibold text-text-primary">
          {label}
          {recommended && (
            <span className="ml-1.5 text-xs font-normal text-brand-orange-text">Recommended</span>
          )}
        </span>
        <span className="block text-xs text-text-muted leading-normal">{hint}</span>
      </span>
    </label>
  );
}

/** Whether the operator has supplied everything the server will require. */
export function isChoiceComplete(impact: UserImpact | null, choice: ImpactChoice): boolean {
  if (!impact) return false;
  if (impact.totalOpen === 0) return true;
  if (!choice.mode) return false;
  if (choice.reason.trim().length < 3) return false;
  if (choice.mode === 'transfer_work' && !choice.transferToUserId) return false;
  return true;
}

export const emptyChoice: ImpactChoice = { mode: null, transferToUserId: '', reason: '' };
