'use client';

import {
  AlertCircle,
  Check,
  CheckCircle2,
  CircleDot,
  Copy,
  Flame,
  Loader2,
  MessageSquareReply,
  Plus,
  RefreshCw,
  Save,
  Target,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';
import { useToast } from '@/context/ToastContext';
import {
  clearIcpDraft,
  loadIcpDraft,
  saveIcpDraft,
  shouldPersistIcpDraft,
} from '@/lib/leadgen/icpDraftRecovery';
import { managerSimplificationNotes } from '@/lib/leadgen/icpManagerRules';

type Version = {
  id: string;
  versionNumber: number;
  status: 'draft' | 'published' | 'archived';
  rulesJson: IcpVersionRulesV2;
  updatedAt: string;
};
type Profile = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  versions: Version[];
};
type Template = { id: string; name: string; description: string };
type Campaign = {
  id: string;
  name: string;
  icpVersionId: string | null;
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

const inputClass =
  'min-h-11 w-full rounded-lg border border-card-border bg-bg-main px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-brand-red focus:ring-2 focus:ring-brand-red/20 disabled:cursor-not-allowed disabled:opacity-50';

const csv = (value: string) =>
  Array.from(new Set(value.split(',').map((part) => part.trim()).filter(Boolean)));

async function json<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export function IcpScoringPanel() {
  const { showToast } = useToast();
  const [section, setSection] = useState<'icp' | 'engagement'>('icp');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [profileId, setProfileId] = useState('');
  const [rules, setRules] = useState<IcpVersionRulesV2 | null>(null);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recoveredDraft, setRecoveredDraft] = useState(false);
  const [rulesVersionId, setRulesVersionId] = useState('');

  const load = useCallback(async (preferred?: string) => {
    setLoading(true);
    try {
      const [library, campaignData] = await Promise.all([
        fetch('/api/icp/profiles').then((r) =>
          json<{ profiles: Profile[]; templates: Template[] }>(r),
        ),
        fetch('/api/icp/campaigns').then((r) =>
          json<{ campaigns: Campaign[] }>(r),
        ),
      ]);
      setProfiles(library.profiles);
      setTemplates(library.templates);
      setCampaigns(campaignData.campaigns);
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

  const profile = profiles.find((item) => item.id === profileId) ?? null;
  const version =
    profile?.versions.find((item) => item.status === 'draft') ??
    profile?.versions.find((item) => item.status === 'published') ??
    null;
  const editable = version?.status === 'draft';
  const dirty =
    Boolean(rules && version && rulesVersionId === version.id) &&
    JSON.stringify(rules) !== JSON.stringify(version?.rulesJson);
  const advanced = useMemo(() => (rules ? managerSimplificationNotes(rules) : []), [rules]);
  const needsSave = dirty || advanced.length > 0;

  useEffect(() => {
    if (!version?.rulesJson) {
      setRules(null);
      setRulesVersionId('');
      setRecoveredDraft(false);
      return;
    }
    const recovered = loadIcpDraft(
      window.sessionStorage,
      version.id,
      version.updatedAt,
    );
    setRules(structuredClone(recovered ?? version.rulesJson));
    setRulesVersionId(version.id);
    setRecoveredDraft(Boolean(recovered));
  }, [version]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (
      !version ||
      !rules ||
      !shouldPersistIcpDraft(dirty, rulesVersionId, version.id)
    )
      return;
    saveIcpDraft(
      window.sessionStorage,
      version.id,
      version.updatedAt,
      rules,
    );
  }, [dirty, rules, rulesVersionId, version]);

  const published = useMemo(
    () =>
      profiles.flatMap((item) =>
        item.versions
          .filter((candidate) => candidate.status === 'published')
          .map((candidate) => ({
            id: candidate.id,
            label: `${item.name} · v${candidate.versionNumber}`,
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
        if (draftName.trim().length < 2) throw new Error('Enter an ICP name');
        const result = await fetch('/api/icp/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: draftName.trim(),
            templateId: templateId || undefined,
          }),
        }).then((r) => json<{ profile: { id: string } }>(r));
        setDraftName('');
        setTemplateId('');
        setShowCreate(false);
        await load(result.profile.id);
      },
      'ICP draft created',
    );

  const confirmSimplification = () =>
    advanced.length === 0 ||
    window.confirm(
      [
        'This legacy ICP cannot be represented exactly by the simple editor.',
        'Continuing may remove criteria or broaden the employee range:',
        ...advanced.map((criterion) => `- ${criterion}`),
        '',
        'Continue with simplification?',
      ].join('\n'),
    );

  const clone = () => {
    if (!version || !confirmSimplification()) return;
    void act(
      'clone',
      async () => {
        await fetch('/api/icp/versions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceVersionId: version.id,
            acknowledgeSimplification: advanced.length > 0,
          }),
        }).then(json);
        clearIcpDraft(window.sessionStorage, version.id);
        setRecoveredDraft(false);
        await load(profileId);
      },
      'Editable draft created',
    );
  };

  const save = () => {
    if (!version || !rules || !confirmSimplification()) return;
    void act(
      'save',
      async () => {
        await fetch(`/api/icp/versions/${version.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedUpdatedAt: version.updatedAt,
            rulesJson: rules,
            acknowledgeSimplification: advanced.length > 0,
          }),
        }).then(json);
        clearIcpDraft(window.sessionStorage, version.id);
        setRecoveredDraft(false);
        setRules(null);
        setRulesVersionId('');
        await load(profileId);
      },
      'ICP draft saved',
    );
  };
  const publish = () =>
    version &&
    act(
      'publish',
      async () => {
        await fetch(`/api/icp/versions/${version.id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedUpdatedAt: version.updatedAt }),
        }).then(json);
        await load(profileId);
      },
      'ICP version published',
    );

  const assign = (campaignId: string, icpVersionId: string) =>
    act(
      `campaign:${campaignId}`,
      async () => {
        await fetch(`/api/icp/campaigns/${campaignId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ icpVersionId }),
        }).then(json);
        const campaignData = await fetch('/api/icp/campaigns').then((response) =>
          json<{ campaigns: Campaign[] }>(response),
        );
        setCampaigns(campaignData.campaigns);
      },
      'Campaign ICP updated; old assessments now show Review until rescored',
    );

  const recalculate = () =>
    act(
      'recalculate',
      async () => {
        const result = await fetch('/api/leads/recalculate-scores', {
          method: 'POST',
        }).then((r) => json<Summary>(r));
        setSummary(result);
      },
      'Engagement priorities recalculated',
    );

  const setList = (
    group: 'geography' | 'industry' | 'persona',
    key: string,
    value: string,
  ) =>
    setRules((current) =>
      current
        ? {
            ...current,
            [group]: { ...current[group], [key]: csv(value) },
          }
        : current,
    );

  return (
    <div className="space-y-6">
      <section className="glass-card rounded-2xl border border-card-border p-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="type-section flex items-center gap-2 text-text-primary">
              <Target className="h-5 w-5 text-brand-red" aria-hidden="true" />
              ICP & Scoring
            </h2>
            <p className="mt-2 max-w-[68ch] text-sm leading-6 text-text-secondary">
              ICP Match belongs to each campaign. Engagement belongs to the
              person. The CRM never blends them into one score.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-card-border bg-bg-main p-1" aria-label="Scoring settings">
            {(['icp', 'engagement'] as const).map((item) => (
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
                {item === 'icp' ? 'ICP library' : 'Engagement'}
              </button>
            ))}
          </div>
        </div>
      </section>

      {section === 'engagement' ? (
        <Engagement summary={summary} busy={busy === 'recalculate'} onRun={recalculate} />
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
                </p>
              </div>
              <button type="button" onClick={() => setShowCreate((value) => !value)} disabled={dirty} title={dirty ? 'Save or discard the current draft first' : undefined} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-brand-red px-4 text-xs font-bold text-white hover:bg-brand-red-hover disabled:cursor-not-allowed disabled:opacity-50">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New ICP
              </button>
            </div>

            {showCreate && (
              <div className="mt-5 grid grid-cols-[1fr_1fr_auto] items-end gap-4 border-y border-card-border py-5">
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
                <Button label="Create draft" icon={Plus} busy={busy === 'create'} disabled={Boolean(busy)} onClick={create} primary />
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
                <label className="block max-w-md space-y-2 text-xs font-semibold text-text-secondary">
                  Active profile
                  <select className={inputClass} value={profileId} onChange={(e) => {
                      if (!dirty || window.confirm('Discard unsaved ICP changes?')) {
                        if (dirty && version) {
                          clearIcpDraft(window.sessionStorage, version.id);
                        }
                        setRecoveredDraft(false);
                        setRules(null);
                        setRulesVersionId('');
                        setProfileId(e.target.value);
                      }
                    }}>
                    {profiles.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}{item.isDefault ? ' · Default' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                {profile && version && rules && (
                  <div className="mt-6 border-t border-card-border pt-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="type-card text-text-primary">
                          {profile.name} · v{version.versionNumber}
                        </h3>
                        <p className="mt-1 text-xs text-text-secondary">
                          {editable ? 'Draft — editable' : 'Published — read only'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {editable ? (
                          <>
                            <Button label="Save draft" icon={Save} busy={busy === 'save'} disabled={Boolean(busy) || !needsSave} onClick={save} />
                            <Button label="Publish" icon={Check} busy={busy === 'publish'} disabled={Boolean(busy) || needsSave} onClick={publish} primary />
                          </>
                        ) : (
                          <Button label="Create editable draft" icon={Copy} busy={busy === 'clone'} disabled={Boolean(busy)} onClick={clone} />
                        )}
                      </div>
                    </div>

                    {!editable && (
                      <p className="mt-4 flex items-center gap-2 border-l-2 border-blue-500 bg-blue-500/5 px-4 py-3 text-xs text-text-secondary">
                        <AlertCircle className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                        Clone this version to change rules without rewriting campaign history.
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

                    {recoveredDraft && (
                      <p className="mt-4 text-xs font-semibold text-blue-700" role="status">
                        Unsaved draft recovered from this browser session.
                      </p>
                    )}
                    {dirty && (
                      <p className="mt-4 text-xs font-semibold text-amber-700" role="status">
                        Unsaved changes. Save the draft before publishing or leaving this profile.
                      </p>
                    )}
                    <fieldset disabled={!editable} className="mt-6 grid grid-cols-2 gap-5">
                      <Field label="Target countries">
                        <input className={inputClass} value={rules.geography.targetCountries.join(', ')} onChange={(e) => setList('geography', 'targetCountries', e.target.value)} placeholder="Vietnam, Singapore" />
                      </Field>
                      <Field label="Excluded countries">
                        <input className={inputClass} value={rules.geography.excludedCountries.join(', ')} onChange={(e) => setList('geography', 'excludedCountries', e.target.value)} placeholder="Known mismatch means No fit" />
                      </Field>
                      <Field label="Industry rule">
                        <select className={inputClass} value={rules.industry.mode} onChange={(e) => setRules({ ...rules, industry: { ...rules.industry, mode: e.target.value as IcpVersionRulesV2['industry']['mode'] } })}>
                          <option value="all">Any industry</option>
                          <option value="allowlist">Must match target industries</option>
                          <option value="denylist">Exclude listed industries only</option>
                        </select>
                      </Field>
                      <Field label="Target industries">
                        <input className={inputClass} value={rules.industry.targetIndustries.join(', ')} onChange={(e) => setList('industry', 'targetIndustries', e.target.value)} placeholder="Software, Logistics" />
                      </Field>
                      <Field label="Excluded industries">
                        <input className={inputClass} value={rules.industry.excludedIndustries.join(', ')} onChange={(e) => setList('industry', 'excludedIndustries', e.target.value)} placeholder="Gambling, Tobacco" />
                      </Field>
                      <Field label="Accepted buyer titles">
                        <input className={inputClass} value={rules.persona.titleAllowlist.join(', ')} onChange={(e) => setList('persona', 'titleAllowlist', e.target.value)} placeholder="CEO, VP Sales, Head of Operations" />
                      </Field>
                      <Field label="Excluded buyer titles">
                        <input className={inputClass} value={rules.persona.titleDenylist.join(', ')} onChange={(e) => setList('persona', 'titleDenylist', e.target.value)} placeholder="Intern, Assistant" />
                      </Field>
                      <Field label="Minimum seniority">
                        <select className={inputClass} value={rules.persona.seniorityFloor ?? ''} onChange={(e) => {
                          const persona = { ...rules.persona };
                          if (e.target.value) persona.seniorityFloor = e.target.value as NonNullable<typeof persona.seniorityFloor>;
                          else delete persona.seniorityFloor;
                          setRules({ ...rules, persona });
                        }}>
                          <option value="">No minimum</option>
                          <option value="C_LEVEL">C-level</option>
                          <option value="VP">VP</option>
                          <option value="DIRECTOR">Director</option>
                          <option value="MANAGER">Manager</option>
                          <option value="IC">Individual contributor</option>
                        </select>
                      </Field>
                      <Field label="Minimum employees">
                        <input type="number" min={0} className={inputClass} value={rules.size.minEmployees ?? ''} onChange={(e) => setRules({ ...rules, size: { ...rules.size, minEmployees: e.target.value ? Number(e.target.value) : undefined } })} placeholder="No minimum" />
                      </Field>
                      <Field label="Maximum employees">
                        <input type="number" min={0} className={inputClass} value={rules.size.maxEmployees ?? ''} onChange={(e) => setRules({ ...rules, size: { ...rules.size, maxEmployees: e.target.value ? Number(e.target.value) : undefined } })} placeholder="No maximum" />
                      </Field>
                    </fieldset>
                    <p className="mt-4 text-xs leading-5 text-text-secondary">
                      Missing configured evidence becomes Review. Only a known mismatch becomes No fit.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          <CampaignTable campaigns={campaigns} versions={published} busy={busy} onAssign={assign} />
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-2 text-xs font-semibold text-text-secondary">{label}{children}</label>;
}

function Signal({ title, text, tone }: { title: string; text: string; tone: string }) {
  return (
    <div className={`rounded-2xl border p-5 ${tone}`}>
      <h3 className="type-card text-text-primary">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-text-secondary">{text}</p>
    </div>
  );
}

function Button({
  label,
  icon: Icon,
  busy,
  disabled,
  onClick,
  primary = false,
}: {
  label: string;
  icon: typeof Save;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-4 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${primary ? 'bg-brand-red text-white hover:bg-brand-red-hover' : 'border border-card-border text-text-primary hover:bg-bg-main'}`}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
      {label}
    </button>
  );
}

function CampaignTable({
  campaigns,
  versions,
  busy,
  onAssign,
}: {
  campaigns: Campaign[];
  versions: Array<{ id: string; label: string }>;
  busy: string;
  onAssign: (campaignId: string, versionId: string) => void;
}) {
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
                    {campaign.icpVersion ? `${campaign.icpVersion.icpProfile.name} · v${campaign.icpVersion.versionNumber}` : 'Not assigned'}
                  </td>
                  <td className="px-3 py-3">
                    <select
                      aria-label={`Assign ICP to ${campaign.name}`}
                      className={inputClass}
                      value={campaign.icpVersionId ?? ''}
                      disabled={!versions.length || busy === `campaign:${campaign.id}`}
                      onChange={(e) => e.target.value && onAssign(campaign.id, e.target.value)}
                    >
                      <option value="">Select published ICP</option>
                      {campaign.icpVersion && !versions.some((item) => item.id === campaign.icpVersion?.id) && (
                        <option value={campaign.icpVersion.id}>
                          {campaign.icpVersion.icpProfile.name} - v{campaign.icpVersion.versionNumber} (pinned)
                        </option>
                      )}
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
        <Button label="Recalculate engagement" icon={RefreshCw} busy={busy} disabled={busy} onClick={onRun} primary />
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