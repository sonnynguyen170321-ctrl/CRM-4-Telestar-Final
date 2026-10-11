'use client';

import { AlertCircle, Check, Clock, Copy, Loader2, Save, Send, Undo2 } from 'lucide-react';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';

import { IcpRuleEditor } from '@/components/icp/IcpRuleEditor';
import {
  currentVersionOf,
  icpApi,
  ownerLabel,
  type IcpProfile,
  type PublishOutcome,
} from '@/components/icp/icpClient';
import { confirmSimplification, useIcpDraft } from '@/components/icp/useIcpDraft';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';

/**
 * One ICP's current version with everything you can do to it: edit the rules, save, publish or
 * submit for review, withdraw a submission, and start an edit of a published version.
 *
 * What each button does is decided by the server and arrives on the profile (`canEdit`,
 * `publishMode`): a rep's Publish says "Submit for review" and only submits; a team lead's or
 * manager's own ICP publishes. This component never guesses from the role. It is shared by
 * Automation (ICP & Scoring) and the campaign's own ICP page.
 */
export function IcpEditorCard({
  profile,
  campaignId,
  view,
  onChanged,
  onOutcome,
  extraActions,
}: {
  profile: IcpProfile;
  campaignId?: string;
  view: 'rules' | 'points';
  /** Reload the profiles after any change the server accepted. */
  onChanged: () => Promise<void> | void;
  /** A publish or submit went through (the campaign page offers the rescore next). */
  onOutcome?: (outcome: PublishOutcome) => void;
  extraActions?: React.ReactNode;
}) {
  const { showToast } = useToast();
  const { currentUserId } = useAppContext();
  const version = currentVersionOf(profile);
  const draft = useIcpDraft(version);
  const [busy, setBusy] = useState('');
  const { rules, setRules, dirty, recovered, advanced, problem, needsSave } = draft;

  if (!version || !rules) return null;
  const editable = version.status === 'draft' && profile.canEdit;
  const isOwner = profile.ownerUserId === currentUserId;
  const pending = version.status === 'pending_review';

  const act = async (name: string, action: () => Promise<void>, success: string) => {
    setBusy(name);
    try {
      await action();
      showToast(success, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Request failed', 'error');
    } finally {
      setBusy('');
    }
  };

  const startEdit = () => {
    if (!confirmSimplification(advanced)) return;
    void act(
      'clone',
      async () => {
        await icpApi.startEdit(version.id, advanced.length > 0);
        draft.clearRecovery();
        await onChanged();
      },
      'Editable draft created',
    );
  };

  const save = () => {
    if (!confirmSimplification(advanced)) return;
    void act(
      'save',
      async () => {
        await icpApi.saveDraft(version.id, version.updatedAt, rules, advanced.length > 0);
        draft.clearRecovery();
        draft.reset();
        await onChanged();
      },
      'ICP draft saved',
    );
  };

  const publish = () =>
    void act(
      'publish',
      async () => {
        const outcome = await icpApi.publish(version.id, version.updatedAt);
        await onChanged();
        onOutcome?.(outcome);
      },
      profile.publishMode === 'submit' ? 'Submitted for review. It scores nothing until it is approved.' : 'ICP version published',
    );

  const withdraw = () =>
    void act(
      'withdraw',
      async () => {
        await icpApi.withdraw(version.id);
        await onChanged();
      },
      'Taken back out of review: it is a draft again',
    );

  const publishLabel = profile.publishMode === 'submit' ? 'Submit for review' : 'Publish';
  const state = pending
    ? 'In review: read only'
    : editable
      ? 'Draft: editable'
      : version.status === 'draft'
        ? 'Draft: read only for you'
        : 'Published: read only';

  return (
    <div className="mt-6 border-t border-card-border pt-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="type-card text-text-primary">
            {profile.name} · v{version.versionNumber}
          </h3>
          <p className="mt-1 text-xs text-text-secondary">
            {state} · {ownerLabel(profile)}
            {profile._count.campaigns > 0 && ` · used by ${profile._count.campaigns} campaign${profile._count.campaigns === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {editable && (
            <>
              <ActionButton label="Save draft" icon={Save} busy={busy === 'save'} disabled={Boolean(busy) || !needsSave || Boolean(problem)} onClick={save} />
              {profile.publishMode && (
                <ActionButton
                  label={publishLabel}
                  icon={profile.publishMode === 'submit' ? Send : Check}
                  busy={busy === 'publish'}
                  disabled={Boolean(busy) || needsSave}
                  onClick={publish}
                  primary
                />
              )}
            </>
          )}
          {pending && isOwner && (
            <ActionButton label="Withdraw" icon={Undo2} busy={busy === 'withdraw'} disabled={Boolean(busy)} onClick={withdraw} />
          )}
          {version.status === 'published' && profile.canEdit && (
            <ActionButton label="Edit" icon={Copy} busy={busy === 'clone'} disabled={Boolean(busy)} onClick={startEdit} primary />
          )}
          {extraActions}
        </div>
      </div>

      {pending && (
        <p className="mt-4 flex items-center gap-2 border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-xs text-text-secondary" role="status">
          <Clock className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          Waiting for review by a team lead or manager. Nothing scores against this version until it is approved; the
          campaign keeps its current ICP meanwhile.
        </p>
      )}
      {version.status === 'draft' && version.reviewNote && (
        <p className="mt-4 flex items-center gap-2 border-l-2 border-red-500 bg-red-500/5 px-4 py-3 text-xs text-text-secondary" role="status">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
          Sent back by the reviewer: {version.reviewNote}
        </p>
      )}
      {version.status === 'published' && profile.canEdit && (
        <p className="mt-4 flex items-center gap-2 border-l-2 border-blue-500 bg-blue-500/5 px-4 py-3 text-xs text-text-secondary">
          <AlertCircle className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
          {'Published versions are read-only so past scores keep the rules they were made with. Edit makes a new draft from this one; publish it to replace this version.'}
        </p>
      )}
      {version.status === 'published' && !profile.canEdit && profile.kind === 'library' && (
        <p className="mt-4 flex items-center gap-2 border-l-2 border-blue-500 bg-blue-500/5 px-4 py-3 text-xs text-text-secondary">
          <AlertCircle className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
          This is a shared ICP, managed by directors and managers. To change the rules for one campaign, copy it into a
          custom ICP.
        </p>
      )}

      {advanced.length > 0 && (
        <details className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-text-secondary">
          <summary className="cursor-pointer font-semibold text-text-primary">
            Advanced criteria from an older template are active
          </summary>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            {advanced.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
          <p className="mt-3">
            {editable
              ? 'Saving will remove or fold these rules into the simple fields. Review the list: the resulting ICP may be broader.'
              : 'Creating a draft requires confirmation because some rules will be removed or broadened.'}
          </p>
        </details>
      )}

      {recovered && (
        <p className="mt-4 text-xs font-semibold text-blue-700" role="status">
          Unsaved draft recovered from this browser session.
        </p>
      )}
      {dirty && (
        <p className="mt-4 text-xs font-semibold text-amber-700" role="status">
          Unsaved changes. Save the draft before {profile.publishMode === 'submit' ? 'submitting' : 'publishing'} or leaving this profile.
        </p>
      )}

      <IcpRuleEditor
        rules={rules}
        editable={editable}
        versionId={version.id}
        campaignId={campaignId}
        view={view}
        onChange={setRules}
        onEdit={startEdit}
        problem={problem}
      />
    </div>
  );
}

export function ActionButton({
  label,
  icon: Icon,
  busy,
  disabled,
  onClick,
  primary = false,
}: {
  label: string;
  icon: LucideIcon;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-4 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${primary ? 'bg-brand-red text-white hover:bg-brand-red-hover' : 'border border-card-border text-text-primary hover:bg-bg-main'}`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
      {label}
    </button>
  );
}
