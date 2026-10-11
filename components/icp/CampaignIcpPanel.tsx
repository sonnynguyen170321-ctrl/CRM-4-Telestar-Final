'use client';

import { ArrowLeft, Check, Copy, Loader2, Plus, Target } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { RescorePreview } from '@/components/automation/RescorePreview';
import { ActionButton, IcpEditorCard } from '@/components/icp/IcpEditorCard';
import { Field, inputClass } from '@/components/icp/IcpRuleEditor';
import {
  icpApi,
  newestPublished,
  ownerLabel,
  readJson,
  type IcpProfile,
  type IcpTemplate,
  type PublishOutcome,
} from '@/components/icp/icpClient';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';

type CampaignFacts = {
  id: string;
  name: string;
  icpProfileId: string | null;
  client: { name: string };
  _count: { leads: number };
};

const STAFF_ROLES = new Set(['team_lead', 'floor_manager', 'director', 'leadgen_manager']);

/**
 * A campaign's own ICP: which one it scores against, switching it, adjusting the rules for this
 * campaign, and what a change does to its leads before it is applied.
 *
 * The rules a rep may change are the rules of a CUSTOM ICP. A shared library ICP is read-only here
 * (managers edit it from Automation, and every campaign on it follows); to change it for one
 * campaign, copy it into a custom ICP. A custom ICP a rep publishes goes to review first, and the
 * campaign keeps scoring against its current ICP until it is approved.
 */
export function CampaignIcpPanel({ campaignId, backHref }: { campaignId: string; backHref: string }) {
  const { showToast } = useToast();
  const { currentRole, currentUserId } = useAppContext();
  const isStaff = STAFF_ROLES.has(currentRole);
  const [campaign, setCampaign] = useState<CampaignFacts | null>(null);
  const [profiles, setProfiles] = useState<IcpProfile[]>([]);
  const [templates, setTemplates] = useState<IcpTemplate[]>([]);
  const [editId, setEditId] = useState('');
  const [view, setView] = useState<'rules' | 'points'>('rules');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [switchTo, setSwitchTo] = useState('');
  const [newTemplate, setNewTemplate] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [rescoreOffered, setRescoreOffered] = useState(false);

  const load = useCallback(
    async (preferEdit?: string) => {
      try {
        const [campaignData, library] = await Promise.all([
          fetch(`/api/icp/campaigns/${campaignId}`).then((r) => readJson<{ campaign: CampaignFacts }>(r)),
          icpApi.list(),
        ]);
        setCampaign(campaignData.campaign);
        setProfiles(library.profiles);
        setTemplates(library.templates);
        setEditId((current) => {
          const wanted = preferEdit || current;
          if (library.profiles.some((p) => p.id === wanted)) return wanted;
          return campaignData.campaign.icpProfileId ?? library.profiles[0]?.id ?? '';
        });
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not load this campaign\'s ICP', 'error');
      } finally {
        setLoading(false);
      }
    },
    [campaignId, showToast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const current = profiles.find((p) => p.id === campaign?.icpProfileId) ?? null;
  const currentPublished = current ? newestPublished(current) : null;
  const editing = profiles.find((p) => p.id === editId) ?? null;

  /** What this person may attach: published, and a library ICP, their own, or (team lead and up) anyone's. */
  const attachable = useMemo(
    () =>
      profiles.filter(
        (p) => newestPublished(p) && (p.kind === 'library' || p.ownerUserId === currentUserId || isStaff),
      ),
    [profiles, currentUserId, isStaff],
  );

  const act = async (name: string, action: () => Promise<void>, success?: string) => {
    setBusy(name);
    try {
      await action();
      if (success) showToast(success, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Request failed', 'error');
    } finally {
      setBusy('');
    }
  };

  const attach = (profile: IcpProfile) => {
    const version = newestPublished(profile);
    if (!version) return;
    void act(
      'attach',
      async () => {
        await icpApi.assign(campaignId, version.id);
        setNotice(null);
        setRescoreOffered(true);
        await load();
      },
      `${profile.name} now scores this campaign. Existing leads keep their verdict until you rescore.`,
    );
  };

  const fork = () =>
    void act(
      'fork',
      async () => {
        const created = await icpApi.createCustom({
          campaignId,
          ...(editing && !newTemplate ? { sourceProfileId: editing.id } : {}),
          ...(newTemplate ? { templateId: newTemplate } : {}),
        });
        setNewTemplate('');
        await load(created.profile.id);
      },
      'Custom ICP created as a draft. Adjust the rules, then publish it for this campaign.',
    );

  const onOutcome = (outcome: PublishOutcome) => {
    if (outcome.outcome === 'submitted') {
      setNotice('Submitted. Your team lead or a manager reviews it; the campaign keeps its current ICP until then.');
      return;
    }
    setNotice(null);
    if (outcome.campaigns.some((c) => c.id === campaignId)) setRescoreOffered(true);
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </p>
    );
  }
  if (!campaign) return <p className="text-sm text-text-secondary">This campaign was not found.</p>;

  const scoredBy = currentPublished
    ? `${current?.name} · v${currentPublished.versionNumber}`
    : null;

  return (
    <div className="space-y-6">
      <Link href={backHref} className="inline-flex items-center gap-2 text-xs font-semibold text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
      </Link>

      <section className="rounded-2xl border border-card-border bg-card-bg p-6">
        <h1 className="type-section flex items-center gap-2 text-text-primary">
          <Target className="h-5 w-5 text-brand-red" aria-hidden="true" />
          ICP &amp; scoring · {campaign.name}
        </h1>
        <p className="mt-1 text-xs text-text-secondary">{campaign.client.name} · {campaign._count.leads} leads</p>

        <div className="mt-5 rounded-xl border border-card-border bg-bg-main p-4">
          {scoredBy && current ? (
            <>
              <p className="text-sm font-semibold text-text-primary">{scoredBy}</p>
              <p className="mt-1 text-xs text-text-secondary">
                {ownerLabel(current)} · status {currentPublished?.status} · shared by {current._count.campaigns} campaign
                {current._count.campaigns === 1 ? '' : 's'}
              </p>
            </>
          ) : current ? (
            <p className="text-sm font-semibold text-amber-700" role="status">
              {current.name} has no live version yet, so this campaign&apos;s leads are not scored.
              {current.versions.some((v) => v.status === 'pending_review')
                ? ' It is waiting for review.'
                : ' Publish it (or submit it for review) below.'}
            </p>
          ) : (
            <p className="text-sm font-semibold text-amber-700" role="status">
              This campaign has no ICP, so its leads are not scored. Choose one below.
            </p>
          )}
        </div>

        {notice && (
          <p className="mt-4 border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-xs text-text-secondary" role="status">{notice}</p>
        )}

        <div className="mt-5 grid grid-cols-[1fr_auto] items-end gap-4">
          <Field label="Score this campaign with">
            <select className={inputClass} value={switchTo} onChange={(e) => setSwitchTo(e.target.value)}>
              <option value="">Choose an ICP…</option>
              {attachable
                .filter((p) => p.id !== campaign.icpProfileId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.kind === 'library' ? 'shared' : ownerLabel(p)}
                  </option>
                ))}
            </select>
          </Field>
          <ActionButton
            label="Switch ICP"
            icon={Check}
            busy={busy === 'attach'}
            disabled={Boolean(busy) || !switchTo}
            onClick={() => {
              const target = profiles.find((p) => p.id === switchTo);
              if (target) attach(target);
              setSwitchTo('');
            }}
            primary
          />
        </div>
        <p className="mt-2 text-xs text-text-secondary">
          A custom ICP that is still in review cannot be chosen until it is approved.
        </p>
      </section>

      {rescoreOffered &&
        (isStaff ? (
          <RescorePreview showToast={showToast} campaignId={campaignId} campaignName={campaign.name} />
        ) : (
          <p className="rounded-xl border border-card-border bg-card-bg p-4 text-xs text-text-secondary" role="status">
            Existing leads keep their old verdict until the campaign is rescored. Ask your team lead to rescore it.
          </p>
        ))}

      <section className="rounded-2xl border border-card-border bg-card-bg p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="type-section text-text-primary">Rules for this campaign</h2>
            <p className="mt-1 max-w-[68ch] text-sm text-text-secondary">
              The preview scores this campaign&apos;s leads that you can see with your unsaved rules. Nothing is written until you save.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-card-border bg-bg-main p-1" aria-label="Rule view">
            {(['rules', 'points'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={view === item}
                onClick={() => setView(item)}
                className={`min-h-11 cursor-pointer rounded-md px-4 text-xs font-semibold ${view === item ? 'bg-brand-red text-white' : 'text-text-secondary hover:bg-card-bg'}`}
              >
                {item === 'rules' ? 'ICP rules' : 'Scoring points'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-[1fr_1fr_auto] items-end gap-4">
          <Field label="Editing">
            <select className={inputClass} value={editId} onChange={(e) => setEditId(e.target.value)}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.kind === 'library' ? 'shared' : ownerLabel(p)}
                  {p.id === campaign.icpProfileId ? ' (this campaign)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start a custom ICP from">
            <select className={inputClass} value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)}>
              <option value="">A copy of the ICP on the left</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>Template: {t.name}</option>
              ))}
            </select>
          </Field>
          <ActionButton
            label={editing?.kind === 'library' || newTemplate ? 'Make custom ICP' : 'Copy to new custom ICP'}
            icon={editing?.kind === 'library' || newTemplate ? Copy : Plus}
            busy={busy === 'fork'}
            disabled={Boolean(busy)}
            onClick={fork}
          />
        </div>

        {editing && (
          <IcpEditorCard
            key={editing.id}
            profile={editing}
            campaignId={campaignId}
            view={view}
            onChanged={() => load(editing.id)}
            onOutcome={onOutcome}
            extraActions={
              editing.id !== campaign.icpProfileId && newestPublished(editing) && attachable.some((p) => p.id === editing.id) ? (
                <ActionButton label="Use for this campaign" icon={Check} busy={busy === 'attach'} disabled={Boolean(busy)} onClick={() => attach(editing)} primary />
              ) : null
            }
          />
        )}
      </section>

      {isStaff && (
        <p className="text-xs text-text-secondary">
          Reviewing a rep&apos;s ICP? Open <Link className="font-semibold text-brand-red" href="/automation?tab=scoring">ICP &amp; Scoring → ICP reviews</Link>.
        </p>
      )}
    </div>
  );
}
