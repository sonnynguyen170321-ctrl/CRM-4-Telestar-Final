'use client';

import {
  CheckCircle2,
  CircleDot,
  Flame,
  Loader2,
  MessageSquareReply,
  Plus,
  RefreshCw,
  Target,
  Check,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RescorePreview } from '@/components/automation/RescorePreview';
import { ActionButton, IcpEditorCard } from '@/components/icp/IcpEditorCard';
import { IcpReviewQueue } from '@/components/icp/IcpReviewQueue';
import { Field, inputClass } from '@/components/icp/IcpRuleEditor';
import {
  currentVersionOf,
  icpApi,
  newestPublished,
  ownerLabel,
  readJson,
  type IcpProfile,
  type IcpTemplate,
} from '@/components/icp/icpClient';
import { useToast } from '@/context/ToastContext';

type Campaign = {
  id: string;
  name: string;
  icpVersionId: string | null;
  icpProfileId?: string | null;
  icpProfile?: { id: string; name: string; kind?: string } | null;
  client: { name: string };
  icpVersion: {
    id: string;
    versionNumber: number;
    status: string;
    icpProfile: { name: string };
  } | null;
};
type Summary = {
  updatedCount: number;
  distribution: { hot: number; warm: number; cold: number };
};

type Section = 'icp' | 'points' | 'reviews' | 'rescore' | 'engagement';
const SECTION_LABEL: Record<Section, string> = {
  icp: 'ICP rules',
  points: 'Scoring points',
  reviews: 'ICP reviews',
  rescore: 'Campaigns & re-score',
  engagement: 'Engagement',
};

type KindFilter = 'all' | 'library' | 'custom';

export function IcpScoringPanel() {
  const { showToast } = useToast();
  const [section, setSection] = useState<Section>('icp');
  const [profiles, setProfiles] = useState<IcpProfile[]>([]);
  const [templates, setTemplates] = useState<IcpTemplate[]>([]);
  const [canManageLibrary, setCanManageLibrary] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [profileId, setProfileId] = useState('');
  const [filter, setFilter] = useState<KindFilter>('all');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createKind, setCreateKind] = useState<'library' | 'custom'>('library');
  const [draftName, setDraftName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [createCampaignId, setCreateCampaignId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);

  const load = useCallback(async (preferred?: string) => {
    setLoading(true);
    try {
      const [library, campaignData, reviews] = await Promise.all([
        icpApi.list(),
        fetch('/api/icp/campaigns').then((r) => readJson<{ campaigns: Campaign[] }>(r)),
        fetch('/api/icp/reviews?countOnly=1')
          .then((r) => readJson<{ count: number }>(r))
          .catch(() => ({ count: 0 })),
      ]);
      setProfiles(library.profiles);
      setTemplates(library.templates);
      setCanManageLibrary(library.canManageLibrary);
      setCampaigns(campaignData.campaigns);
      setReviewCount(reviews.count);
      setProfileId((current) => {
        const candidate = preferred || current;
        return library.profiles.some((item) => item.id === candidate)
          ? candidate
          : (library.profiles[0]?.id ?? '');
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load ICPs', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleProfiles = useMemo(
    () => profiles.filter((item) => filter === 'all' || item.kind === filter),
    [profiles, filter],
  );
  const profile = profiles.find((item) => item.id === profileId) ?? null;
  const version = profile ? currentVersionOf(profile) : null;

  const published = useMemo(
    () =>
      profiles.flatMap((item) =>
        item.versions
          .filter((candidate) => candidate.status === 'published')
          .map((candidate) => ({
            id: candidate.id,
            profileId: item.id,
            versionNumber: candidate.versionNumber,
            label: `${item.name} · v${candidate.versionNumber}${item.kind === 'custom' ? ' (custom)' : ''}`,
          })),
      ),
    [profiles],
  );

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

  const create = () =>
    act(
      'create',
      async () => {
        const kind = canManageLibrary ? createKind : 'custom';
        if (kind === 'library' && draftName.trim().length < 2) throw new Error('Enter an ICP name');
        if (kind === 'custom' && !createCampaignId && !canManageLibrary) throw new Error('Choose the campaign this ICP is for');
        const result =
          kind === 'library'
            ? await icpApi.createLibrary({ name: draftName.trim(), templateId: templateId || undefined })
            : await icpApi.createCustom({
                campaignId: createCampaignId || undefined,
                templateId: templateId || undefined,
                name: draftName.trim() || undefined,
              });
        setDraftName('');
        setTemplateId('');
        setShowCreate(false);
        setFilter('all');
        await load(result.profile.id);
      },
      'ICP draft created',
    );

  const makeDefault = () =>
    profile &&
    act(
      'default',
      async () => {
        await fetch(`/api/icp/profiles/${profile.id}/default`, { method: 'POST' }).then(readJson);
        await load(profileId);
      },
      `${profile.name} is now the default: it pre-ranks pool records that belong to no campaign`,
    );

  const assign = (campaignId: string, icpVersionId: string | null) =>
    act(
      `campaign:${campaignId}`,
      async () => {
        await icpApi.assign(campaignId, icpVersionId);
        const campaignData = await fetch('/api/icp/campaigns').then((response) =>
          readJson<{ campaigns: Campaign[] }>(response),
        );
        setCampaigns(campaignData.campaigns);
      },
      icpVersionId === null
        ? 'Campaign ICP cleared: the campaign is not scored. Existing verdicts clear on the next rescore'
        : 'Campaign ICP updated; rescore the campaign to apply it to existing leads',
    );

  const recalculate = () =>
    act(
      'recalculate',
      async () => {
        const result = await fetch('/api/leads/recalculate-scores', {
          method: 'POST',
        }).then((r) => readJson<Summary>(r));
        setSummary(result);
      },
      'Engagement priorities recalculated',
    );

  const view = section === 'points' ? 'points' : 'rules';

  return (
    <div className="space-y-6">
      <section className="glass-card rounded-2xl border border-card-border p-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="type-section flex items-center gap-2 text-text-primary">
              <Target className="h-5 w-5 text-brand-red" aria-hidden="true" />
              ICP &amp; Scoring
            </h2>
            <p className="mt-2 max-w-[68ch] text-sm leading-6 text-text-secondary">
              ICP Match belongs to each campaign. Engagement belongs to the
              person. The CRM never blends them into one score.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-card-border bg-bg-main p-1" aria-label="Scoring settings">
            {(['icp', 'points', 'reviews', 'rescore', 'engagement'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={section === item}
                onClick={() => setSection(item)}
                className={`min-h-11 cursor-pointer rounded-md px-4 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red ${
                  section === item
                    ? 'bg-brand-red text-white'
                    : 'text-text-secondary hover:bg-card-bg hover:text-text-primary'
                }`}
              >
                {SECTION_LABEL[item]}
                {item === 'reviews' && reviewCount > 0 && (
                  <span className="ml-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">{reviewCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      {section === 'engagement' ? (
        <Engagement summary={summary} busy={busy === 'recalculate'} onRun={recalculate} />
      ) : section === 'reviews' ? (
        <IcpReviewQueue onDecided={() => load(profileId)} />
      ) : section === 'rescore' ? (
        <>
          <CampaignTable campaigns={campaigns} versions={published} busy={busy} onAssign={assign} />
          <RescorePreview showToast={showToast} />
        </>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-4" aria-label="Two independent signals">
            <Signal title="ICP Match" text="Fit · Review · No fit, evaluated separately for each campaign." tone="border-emerald-500/30 bg-emerald-500/5" />
            <Signal title="Engagement" text="Hot · Warm · Cold, based only on meeting, reply, and opens." tone="border-blue-500/30 bg-blue-500/5" />
          </section>

          <section className="rounded-2xl border border-card-border bg-card-bg p-6">
            <div className="flex items-start justify-between gap-5">
              <div>
                <h2 className="type-section text-text-primary">ICP library</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  Published versions are immutable; edits always happen in a new draft.
                  {!canManageLibrary && ' Shared ICPs are managed by directors and managers; you can make a custom ICP for a campaign.'}
                </p>
              </div>
              <button type="button" onClick={() => setShowCreate((value) => !value)} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-brand-red px-4 text-xs font-bold text-white hover:bg-brand-red-hover disabled:cursor-not-allowed disabled:opacity-50">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New ICP
              </button>
            </div>

            {showCreate && (
              <div className="mt-5 grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-4 border-y border-card-border py-5">
                {canManageLibrary && (
                  <Field label="Kind">
                    <select className={inputClass} value={createKind} onChange={(e) => setCreateKind(e.target.value as 'library' | 'custom')}>
                      <option value="library">Shared library ICP</option>
                      <option value="custom">Custom ICP (mine)</option>
                    </select>
                  </Field>
                )}
                {(createKind === 'custom' || !canManageLibrary) && (
                  <Field label={canManageLibrary ? 'For campaign (optional)' : 'For campaign'}>
                    <select className={inputClass} value={createCampaignId} onChange={(e) => setCreateCampaignId(e.target.value)}>
                      <option value="">{canManageLibrary ? 'No campaign' : 'Choose a campaign'}</option>
                      {campaigns.map((campaign) => (
                        <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="ICP name">
                  <input className={inputClass} value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="SEA logistics decision makers" />
                </Field>
                <Field label="Start from">
                  <select className={inputClass} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                    <option value="">Empty ICP</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                </Field>
                <ActionButton label="Create draft" icon={Plus} busy={busy === 'create'} disabled={Boolean(busy)} onClick={create} primary />
              </div>
            )}

            {loading ? (
              <p className="mt-8 flex items-center gap-2 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading ICPs…
              </p>
            ) : profiles.length === 0 ? (
              <div className="mt-8 border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3">
                <p className="text-sm font-semibold text-text-primary">No ICP configured</p>
                <p className="mt-1 text-xs text-text-secondary">Create one before running Research or campaign scoring.</p>
              </div>
            ) : (
              <div className="mt-6">
                <div className="flex items-end gap-4">
                  <label className="block max-w-md flex-1 space-y-2 text-xs font-semibold text-text-secondary">
                    Active profile
                    <select className={inputClass} value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                      {visibleProfiles.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}{item.isDefault ? ' · Default' : ''}{item.kind === 'custom' ? ` · ${ownerLabel(item)}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="inline-flex rounded-lg border border-card-border bg-bg-main p-1" role="group" aria-label="Filter ICPs">
                    {(['all', 'library', 'custom'] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        aria-pressed={filter === item}
                        onClick={() => {
                          setFilter(item);
                          const first = profiles.find((p) => item === 'all' || p.kind === item);
                          if (first && !(profile && (item === 'all' || profile.kind === item))) setProfileId(first.id);
                        }}
                        className={`min-h-11 cursor-pointer rounded-md px-3 text-xs font-semibold ${filter === item ? 'bg-brand-red text-white' : 'text-text-secondary hover:bg-card-bg'}`}
                      >
                        {item === 'all' ? 'All' : item === 'library' ? 'Shared' : 'Custom'}
                      </button>
                    ))}
                  </div>
                </div>

                {profile && version && (
                  <IcpEditorCard
                    key={profile.id}
                    profile={profile}
                    view={view}
                    onChanged={() => load(profile.id)}
                    extraActions={
                      canManageLibrary && profile.kind === 'library' && !profile.isDefault && newestPublished(profile) ? (
                        <ActionButton label="Set as default" icon={Check} busy={busy === 'default'} disabled={Boolean(busy)} onClick={() => void makeDefault()} />
                      ) : null
                    }
                  />
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Signal({ title, text, tone }: { title: string; text: string; tone: string }) {
  return (
    <div className={`rounded-2xl border p-5 ${tone}`}>
      <h3 className="type-card text-text-primary">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-text-secondary">{text}</p>
    </div>
  );
}

function CampaignTable({
  campaigns,
  versions,
  busy,
  onAssign,
}: {
  campaigns: Campaign[];
  versions: Array<{ id: string; label: string; profileId: string; versionNumber: number }>;
  busy: string;
  onAssign: (campaignId: string, versionId: string | null) => void;
}) {
  // A campaign follows its profile's newest published version, not the version it was pinned to.
  const currentFor = (campaign: Campaign) => {
    if (!campaign.icpProfileId) {
      const pin = campaign.icpVersion;
      return pin && pin.status === 'published' ? versions.find((item) => item.id === pin.id) ?? null : null;
    }
    return (
      versions
        .filter((item) => item.profileId === campaign.icpProfileId)
        .sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null
    );
  };
  const NO_ICP = '__none__';
  return (
    <section className="rounded-2xl border border-card-border bg-card-bg p-6">
      <h2 className="type-section text-text-primary">Campaign assignments</h2>
      <p className="mt-2 max-w-[68ch] text-sm leading-6 text-text-secondary">
        The same prospect can use a different published ICP in every campaign.
        Changing this selection makes old results stale until campaign rescore.
      </p>
      {campaigns.length === 0 ? (
        <p className="mt-5 text-sm text-text-secondary">No campaigns are visible in your scope.</p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="border-b border-card-border text-text-secondary">
                <th className="px-3 py-3">Campaign</th>
                <th className="px-3 py-3">Client</th>
                <th className="px-3 py-3">Current ICP</th>
                <th className="px-3 py-3">Published ICP</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className="border-b border-card-border/60">
                  <td className="px-3 py-3 font-semibold text-text-primary">{campaign.name}</td>
                  <td className="px-3 py-3 text-text-secondary">{campaign.client.name}</td>
                  <td className="px-3 py-3 text-text-secondary">
                    {currentFor(campaign)?.label ??
                      (campaign.icpProfile ? `${campaign.icpProfile.name} · nothing published, not scored` : 'No ICP, not scored')}
                  </td>
                  <td className="px-3 py-3">
                    <select
                      aria-label={`Assign ICP to ${campaign.name}`}
                      className={inputClass}
                      value={currentFor(campaign)?.id ?? NO_ICP}
                      disabled={busy === `campaign:${campaign.id}`}
                      onChange={(e) => {
                        if (e.target.value !== NO_ICP) return onAssign(campaign.id, e.target.value);
                        if (window.confirm(`Stop scoring ${campaign.name}? Its leads will show Not scored after the next rescore.`)) {
                          onAssign(campaign.id, null);
                        }
                      }}
                    >
                      <option value={NO_ICP}>{"No ICP (don't score)"}</option>
                      {versions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Engagement({
  summary,
  busy,
  onRun,
}: {
  summary: Summary | null;
  busy: boolean;
  onRun: () => void;
}) {
  const ladder = [
    ['Meeting booked', 'Hot', CheckCircle2],
    ['Reply received', 'Hot', MessageSquareReply],
    ['Email opened', 'Warm', Flame],
    ['No activity', 'Cold', CircleDot],
  ] as const;
  return (
    <section className="rounded-2xl border border-card-border bg-card-bg p-6">
      <div className="flex items-start justify-between gap-5">
        <div>
          <h2 className="type-section text-text-primary">Fixed engagement ladder</h2>
          <p className="mt-2 max-w-[68ch] text-sm leading-6 text-text-secondary">
            Meeting wins over reply, reply wins over opens. Title, phone, and email quality never affect engagement.
          </p>
        </div>
        <ActionButton label="Recalculate engagement" icon={RefreshCw} busy={busy} disabled={busy} onClick={onRun} primary />
      </div>
      <div className="mt-6 grid grid-cols-4 gap-4">
        {ladder.map(([title, label, Icon], index) => (
          <div key={title} className="rounded-xl border border-card-border bg-bg-main p-4">
            <div className="flex items-center justify-between">
              <Icon className="h-5 w-5 text-brand-red" aria-hidden="true" />
              <span className="rounded-full border border-card-border px-2 py-1 text-xs font-bold text-text-primary">{label}</span>
            </div>
            <h3 className="type-card mt-4 text-text-primary">{index + 1}. {title}</h3>
          </div>
        ))}
      </div>
      {summary && (
        <p className="mt-6 flex items-center gap-2 border-l-2 border-emerald-500 bg-emerald-500/5 px-4 py-3 text-sm text-text-primary" role="status">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Updated {summary.updatedCount} leads · {summary.distribution.hot} Hot · {summary.distribution.warm} Warm · {summary.distribution.cold} Cold
        </p>
      )}
    </section>
  );
}
