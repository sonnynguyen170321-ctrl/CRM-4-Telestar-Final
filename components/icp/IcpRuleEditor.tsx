'use client';

import type { IcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';

import { ChipInput } from '@/components/icp/ChipInput';
import {
  PreviewPanel,
  ScoringPointsEditor,
  useLivePreview,
} from '@/components/automation/ScoringPointsEditor';
import { COUNTRY_SUGGESTIONS, INDUSTRY_SUGGESTIONS } from '@/lib/icp/suggestions';
import { sumScoringWeights } from '@/lib/leadgen/icpScoringProblem';

/**
 * The ICP rule form, shared by Automation (ICP & Scoring) and the campaign's own ICP page.
 *
 * It edits one `IcpVersionRulesV2` in place of the caller's state and knows nothing about saving,
 * publishing or review: those differ by surface and by who is pressing the button. `view` picks the
 * plain rules (countries, industries, titles, size, weights, never-qualified switches) or the
 * per-value scoring points; both show a live preview of what the unsaved rules would do to real
 * leads, scoped to `campaignId` when given.
 */

export const inputClass =
  'min-h-11 w-full rounded-lg border border-card-border bg-bg-main px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-brand-red focus:ring-2 focus:ring-brand-red/20 disabled:cursor-not-allowed disabled:opacity-50';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-2 text-xs font-semibold text-text-secondary">{label}{children}</label>;
}

export type IcpRuleEditorProps = {
  rules: IcpVersionRulesV2;
  editable: boolean;
  /** The version being edited: anchors the preview and the points editor. */
  versionId: string;
  /** Preview on this campaign's leads. */
  campaignId?: string;
  view: 'rules' | 'points';
  onChange: (rules: IcpVersionRulesV2) => void;
  /** Starts a draft from a published version. */
  onEdit: () => void;
  /** Why the rules cannot be saved yet (`describeScoringProblem`). */
  problem: string | null;
};

export function IcpRuleEditor(props: IcpRuleEditorProps) {
  const { rules, editable, versionId, campaignId, view, onChange, onEdit, problem } = props;
  if (view === 'points') {
    return (
      <ScoringPointsEditor
        rules={rules}
        editable={editable}
        versionId={versionId}
        campaignId={campaignId}
        onChange={onChange}
        onEdit={onEdit}
      />
    );
  }
  return editable ? (
    <RulesWithPreview {...props} problem={problem} />
  ) : (
    <RulesForm rules={rules} editable={false} onChange={onChange} problem={problem} />
  );
}

function RulesWithPreview({ rules, versionId, campaignId, onChange, problem }: IcpRuleEditorProps) {
  const preview = useLivePreview(versionId, rules, campaignId);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-6">
      <RulesForm rules={rules} editable onChange={onChange} problem={problem} />
      <PreviewPanel state={preview} />
    </div>
  );
}

function RulesForm({
  rules,
  editable,
  onChange,
  problem,
}: {
  rules: IcpVersionRulesV2;
  editable: boolean;
  onChange: (rules: IcpVersionRulesV2) => void;
  problem: string | null;
}) {
  const setList = (group: 'geography' | 'industry' | 'persona', key: string, value: string[]) =>
    onChange({ ...rules, [group]: { ...rules[group], [key]: value } });

  return (
    <div>
      <fieldset disabled={!editable} className="mt-6 grid grid-cols-2 gap-5">
        <ChipInput label="Target countries" value={rules.geography.targetCountries} onChange={(next) => setList('geography', 'targetCountries', next)} placeholder="Vietnam, Singapore" suggestions={COUNTRY_SUGGESTIONS} />
        <ChipInput label="Excluded countries" value={rules.geography.excludedCountries} onChange={(next) => setList('geography', 'excludedCountries', next)} placeholder="Known mismatch means No fit" suggestions={COUNTRY_SUGGESTIONS} />
        <Field label="Industry rule">
          <select className={inputClass} value={rules.industry.mode} onChange={(e) => onChange({ ...rules, industry: { ...rules.industry, mode: e.target.value as IcpVersionRulesV2['industry']['mode'] } })}>
            <option value="all">Any industry</option>
            <option value="allowlist">Must match target industries</option>
            <option value="denylist">Exclude listed industries only</option>
          </select>
        </Field>
        <ChipInput label="Target industries" value={rules.industry.targetIndustries} onChange={(next) => setList('industry', 'targetIndustries', next)} placeholder="Software, Logistics" suggestions={INDUSTRY_SUGGESTIONS} />
        <ChipInput label="Excluded industries" value={rules.industry.excludedIndustries} onChange={(next) => setList('industry', 'excludedIndustries', next)} placeholder="Gambling, Tobacco" suggestions={INDUSTRY_SUGGESTIONS} />
        <ChipInput label="Accepted buyer titles" value={rules.persona.titleAllowlist} onChange={(next) => setList('persona', 'titleAllowlist', next)} placeholder="CEO, VP Sales, Head of Operations" />
        <ChipInput label="Excluded buyer titles" value={rules.persona.titleDenylist} onChange={(next) => setList('persona', 'titleDenylist', next)} placeholder="Intern, Assistant" />
        <Field label="Minimum seniority">
          <select className={inputClass} value={rules.persona.seniorityFloor ?? ''} onChange={(e) => {
            const persona = { ...rules.persona };
            if (e.target.value) persona.seniorityFloor = e.target.value as NonNullable<typeof persona.seniorityFloor>;
            else delete persona.seniorityFloor;
            onChange({ ...rules, persona });
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
          <input type="number" min={0} className={inputClass} value={rules.size.minEmployees ?? ''} onChange={(e) => onChange({ ...rules, size: { ...rules.size, minEmployees: e.target.value ? Number(e.target.value) : undefined } })} placeholder="No minimum" />
        </Field>
        <Field label="Maximum employees">
          <input type="number" min={0} className={inputClass} value={rules.size.maxEmployees ?? ''} onChange={(e) => onChange({ ...rules, size: { ...rules.size, maxEmployees: e.target.value ? Number(e.target.value) : undefined } })} placeholder="No maximum" />
        </Field>
      </fieldset>
      <ScoringControls rules={rules} editable={editable} onChange={onChange} problem={problem} />
    </div>
  );
}

const WEIGHT_FIELDS: { key: keyof IcpVersionRulesV2['scoringWeights']; label: string; hint: string }[] = [
  { key: 'persona', label: 'Buyer title', hint: 'Title matches the accepted buyers' },
  { key: 'geo', label: 'Country', hint: 'Company is in a target country' },
  { key: 'industry', label: 'Industry', hint: 'Only counts with "Must match target industries"' },
  { key: 'size', label: 'Company size', hint: 'Only counts when headcount is known' },
  { key: 'companyType', label: 'Company type', hint: 'Rarely known; usually leave low' },
  { key: 'signals', label: 'Keywords', hint: 'Industry keywords when industry is "Any"' },
];

/**
 * Points, thresholds and the "never qualified" switches.
 *
 * The verdict became weighted on 2026-10-03 (`lib/leadgen/weightedQualification.ts`): only the
 * dimensions this ICP constrains are averaged, by these points, and the two thresholds turn the
 * average into Fit / Review / No fit. Before, the points and thresholds were stored, unread, and
 * reset to defaults on every save — and so were four of the five disqualifiers below.
 */
function ScoringControls({
  rules,
  editable,
  onChange,
  problem,
}: {
  rules: IcpVersionRulesV2;
  editable: boolean;
  onChange: (rules: IcpVersionRulesV2) => void;
  problem: string | null;
}) {
  const sum = sumScoringWeights(rules.scoringWeights);
  const setWeight = (key: keyof IcpVersionRulesV2['scoringWeights'], value: string) =>
    onChange({ ...rules, scoringWeights: { ...rules.scoringWeights, [key]: Math.max(0, Math.round(Number(value) || 0)) } });
  const setPolicy = (key: 'qualifiedMinFitScore' | 'needsReviewMinFitScore', value: string) =>
    onChange({ ...rules, scorePolicy: { ...rules.scorePolicy, [key]: Math.max(0, Math.min(100, Math.round(Number(value) || 0))) } });
  const setToggle = (key: 'genericEmailContact' | 'websiteOffline', checked: boolean) =>
    onChange({ ...rules, disqualifiers: { ...rules.disqualifiers, [key]: { ...rules.disqualifiers[key], disqualify: checked } } });

  return (
    <fieldset disabled={!editable} className="mt-8 space-y-6 border-t border-card-border pt-6">
      {rules.pointRules?.enabled ? (
        <p className="rounded-lg border border-card-border px-3 py-2 text-xs text-text-secondary">
          This ICP scores with per-value points (Scoring points tab), so the weights and thresholds below are not used.
          The &ldquo;Never qualified&rdquo; switches still apply.
        </p>
      ) : null}
      <div className={rules.pointRules?.enabled ? 'hidden' : undefined}>
        <h4 className="text-sm font-bold text-text-primary">Dimension weights</h4>
        <p className="mt-1 text-xs leading-5 text-text-secondary">
          A lead scores the weighted average of the rules above that it has data for. Rules you have not set, and data the
          lead does not have, are left out rather than counted against it.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-4">
          {WEIGHT_FIELDS.map((field) => (
            <label key={field.key} className="space-y-1 text-xs font-semibold text-text-secondary">
              <span className="flex items-baseline justify-between gap-2">
                {field.label}
                <span className="font-normal text-text-muted">{field.hint}</span>
              </span>
              <input
                type="number"
                min={0}
                max={100}
                className={inputClass}
                value={rules.scoringWeights[field.key]}
                onChange={(e) => setWeight(field.key, e.target.value)}
              />
            </label>
          ))}
        </div>
        <p className={`mt-2 text-xs font-semibold ${sum === 100 ? 'text-text-muted' : 'text-amber-700'}`} role="status">
          Total {sum} / 100
        </p>
      </div>

      <div className={`grid grid-cols-2 gap-4 ${rules.pointRules?.enabled ? 'hidden' : ''}`}>
        <label className="space-y-1 text-xs font-semibold text-text-secondary">
          Fit at or above
          <input type="number" min={0} max={100} className={inputClass} value={rules.scorePolicy.qualifiedMinFitScore} onChange={(e) => setPolicy('qualifiedMinFitScore', e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-text-secondary">
          Review at or above (below is No fit)
          <input type="number" min={0} max={100} className={inputClass} value={rules.scorePolicy.needsReviewMinFitScore} onChange={(e) => setPolicy('needsReviewMinFitScore', e.target.value)} />
        </label>
      </div>
      <p className="text-xs leading-5 text-text-secondary">
        A lead missing its country, industry or title (where you set one) is Review at best — the score cannot vouch for
        what it never saw.
      </p>

      <div>
        <h4 className="text-sm font-bold text-text-primary">Never qualified</h4>
        <p className="mt-1 text-xs leading-5 text-text-secondary">
          These, excluded countries, excluded industries and excluded titles are No fit whatever the score.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Toggle
            label="Contact on a free email (Gmail, Yahoo…)"
            checked={rules.disqualifiers.genericEmailContact.disqualify}
            onChange={(checked) => setToggle('genericEmailContact', checked)}
          />
          <Toggle
            label="Company website is offline"
            checked={rules.disqualifiers.websiteOffline.disqualify}
            onChange={(checked) => setToggle('websiteOffline', checked)}
          />
          <Toggle
            label="One-person company"
            checked={rules.disqualifiers.onePersonCompany.disqualify}
            onChange={(checked) =>
              onChange({ ...rules, disqualifiers: { ...rules.disqualifiers, onePersonCompany: { ...rules.disqualifiers.onePersonCompany, disqualify: checked } } })
            }
          />
          <Toggle
            label="Sells services or consulting rather than a product"
            checked={rules.companyType.servicesConsultingPolicy.disqualify}
            onChange={(checked) =>
              onChange({
                ...rules,
                companyType: {
                  ...rules.companyType,
                  servicesConsultingPolicy: { ...rules.companyType.servicesConsultingPolicy, disqualify: checked },
                },
              })
            }
          />
        </div>
      </div>

      {problem && (
        <p className="text-xs font-semibold text-amber-700" role="alert">
          {problem} Fix this to save.
        </p>
      )}
    </fieldset>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-card-border px-3 text-xs font-semibold text-text-secondary">
      <input type="checkbox" className="h-4 w-4 accent-brand-red" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
