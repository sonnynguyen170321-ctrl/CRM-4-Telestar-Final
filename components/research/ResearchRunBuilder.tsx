'use client';

import { useEffect, useMemo, useState } from 'react';
import { Compass, Eye, Loader2, X } from 'lucide-react';
import {
  buildQueriesFromBuilderParams,
  normalizeResearchBuilderParams,
  type ResearchBuilderMode,
  type ResearchBuilderParams,
} from '@telestar/core-research/buildDiscoveryQueries';

import { readApiError } from '@/lib/api/client';

export type ResearchRunPayload = {
  kind: 'company' | 'contact';
  icpVersionId?: string;
  queryLimit: number;
  builderParams?: ResearchBuilderParams;
};

type IcpVersionOption = {
  id: string;
  versionNumber: number;
  icpProfile: { name: string; isDefault: boolean };
};

type Props = {
  isOpen: boolean;
  versions: IcpVersionOption[];
  queryOptions: number[];
  onClose: () => void;
  onCreated: (run: { id: string; queries: number }) => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

type Preview = {
  total: number;
  queries: Array<{ query: string; hints: string[] }>;
  payloadFingerprint: string;
};

const fieldClass =
  'min-h-11 w-full rounded-lg border border-card-border bg-bg-main px-3 py-2 type-body text-text-primary outline-none transition-colors focus:border-brand-red focus:ring-2 focus:ring-brand-red/20';
const secondaryButton =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-card-border bg-bg-main px-4 type-meta font-semibold text-text-secondary transition-colors hover:bg-card-border/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red disabled:cursor-not-allowed disabled:opacity-50';
const primaryButton =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-red px-4 type-meta font-semibold text-white transition-colors hover:bg-brand-red/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-card-bg disabled:cursor-not-allowed disabled:opacity-50';

const modes: Array<{ id: ResearchBuilderMode; label: string; description: string }> = [
  { id: 'ICP', label: 'ICP', description: 'Use a published ICP exactly as configured.' },
  { id: 'BUILDER', label: 'Builder', description: 'Describe a market with your own terms.' },
  { id: 'COMPANY_CONTACTS', label: 'Company contacts', description: 'Find people at one company.' },
  { id: 'LOOKALIKE', label: 'Lookalike', description: 'Find companies similar to a seed.' },
];

export default function ResearchRunBuilder({
  isOpen,
  versions,
  queryOptions,
  onClose,
  onCreated,
  showToast,
}: Props) {
  const [mode, setMode] = useState<ResearchBuilderMode>('ICP');
  const [kind, setKind] = useState<'company' | 'contact'>('company');
  const [icpVersionId, setIcpVersionId] = useState('');
  const [queryLimit, setQueryLimit] = useState(50);
  const [industries, setIndustries] = useState('');
  const [keywords, setKeywords] = useState('');
  const [titles, setTitles] = useState('');
  const [geos, setGeos] = useState('');
  const [seniority, setSeniority] = useState('');
  const [excludeKeywords, setExcludeKeywords] = useState('');
  const [excludeDomains, setExcludeDomains] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyDomain, setCompanyDomain] = useState('');
  const [seedName, setSeedName] = useState('');
  const [seedDomain, setSeedDomain] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setQueryLimit((current) => (queryOptions.includes(current) ? current : queryOptions[0] ?? 50));
  }, [queryOptions]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    setPreview(null);
  }, [
    mode,
    kind,
    icpVersionId,
    queryLimit,
    industries,
    keywords,
    titles,
    geos,
    seniority,
    excludeKeywords,
    excludeDomains,
    companySize,
    companyName,
    companyDomain,
    seedName,
    seedDomain,
  ]);

  const payload = useMemo<ResearchRunPayload>(() => {
    if (mode === 'ICP') {
      return {
        kind,
        icpVersionId: icpVersionId || undefined,
        queryLimit,
      };
    }
    const effectiveKind = mode === 'COMPANY_CONTACTS' ? 'contact' : kind;
    const builderParams = normalizeResearchBuilderParams({
      queryLimit,
      industries,
      keywords,
      titles,
      geos,
      seniority,
      excludeKeywords,
      excludeDomains,
      companySize,
      ...(mode === 'COMPANY_CONTACTS'
        ? { scope: { companyName, domain: companyDomain } }
        : {}),
      ...(mode === 'LOOKALIKE' ? { seed: { name: seedName, domain: seedDomain } } : {}),
    });
    return {
      kind: mode === 'LOOKALIKE' ? 'company' : effectiveKind,
      queryLimit,
      ...(builderParams ? { builderParams } : {}),
    };
  }, [
    mode,
    kind,
    icpVersionId,
    queryLimit,
    industries,
    keywords,
    titles,
    geos,
    seniority,
    excludeKeywords,
    excludeDomains,
    companySize,
    companyName,
    companyDomain,
    seedName,
    seedDomain,
  ]);

  const payloadFingerprint = useMemo(
    () => JSON.stringify(payload),
    [payload],
  );

  const localPreview = useMemo(() => {
    if (!payload.builderParams) return [];
    return buildQueriesFromBuilderParams(
      payload.kind === 'company' ? 'COMPANY' : 'CONTACT',
      payload.builderParams,
    ).slice(0, 3);
  }, [payload]);

  async function previewPlan() {
    if (mode === 'ICP' && !icpVersionId) {
      showToast('Choose a published ICP before previewing.', 'error');
      return;
    }
    setPreviewing(true);
    const requestedFingerprint = payloadFingerprint;
    try {
      const response = await fetch('/api/research/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        showToast(await readApiError(response, 'Could not preview the query plan'), 'error');
        return;
      }
      const result = (await response.json()) as Omit<Preview, 'payloadFingerprint'>;
      setPreview({ ...result, payloadFingerprint: requestedFingerprint });
    } catch {
      showToast('Network error while previewing the query plan', 'error');
    } finally {
      setPreviewing(false);
    }
  }

  async function createRun() {
    if (!preview || preview.payloadFingerprint !== payloadFingerprint) {
      showToast('Preview the query plan before creating this run.', 'error');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/research/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        showToast(await readApiError(response, 'Could not create the run'), 'error');
        return;
      }
      await onCreated(await response.json());
      onClose();
    } catch {
      showToast('Network error while creating the run', 'error');
    } finally {
      setCreating(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close new research run"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="research-builder-title"
        className="relative z-10 flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-card-border bg-card-bg shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-card-border px-5 py-4">
          <div>
            <h2 id="research-builder-title" className="type-section font-bold text-text-primary">
              New research run
            </h2>
            <p className="mt-1 type-meta text-text-muted">
              Build and inspect the exact search plan before any provider is called.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-main hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <fieldset>
            <legend className="mb-2 type-meta font-semibold text-text-primary">Research mode</legend>
            <div className="grid grid-cols-4 gap-2">
              {modes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={mode === item.id}
                  onClick={() => setMode(item.id)}
                  className={`min-h-20 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red ${
                    mode === item.id
                      ? 'border-brand-red bg-brand-red/10'
                      : 'border-card-border bg-bg-main hover:border-text-muted'
                  }`}
                >
                  <span className="block type-meta font-bold text-text-primary">{item.label}</span>
                  <span className="mt-1 block type-meta text-text-muted">{item.description}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-3 gap-4">
            {mode !== 'COMPANY_CONTACTS' && mode !== 'LOOKALIKE' && (
              <label className="space-y-1">
                <span className="type-meta font-semibold text-text-secondary">Looking for</span>
                <select
                  className={fieldClass}
                  value={kind}
                  onChange={(event) => setKind(event.target.value as 'company' | 'contact')}
                >
                  <option value="company">Companies</option>
                  <option value="contact">People</option>
                </select>
              </label>
            )}
            {mode === 'ICP' && (
              <label className="col-span-2 space-y-1">
                <span className="type-meta font-semibold text-text-secondary">Published ICP</span>
                <select
                  className={fieldClass}
                  value={icpVersionId}
                  onChange={(event) => setIcpVersionId(event.target.value)}
                >
                  <option value="">Select an ICP.</option>
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.icpProfile.name}  /  v{version.versionNumber}
                      {version.icpProfile.isDefault ? '  /  Default' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="space-y-1">
              <span className="type-meta font-semibold text-text-secondary">Query budget</span>
              <select
                className={fieldClass}
                value={queryLimit}
                onChange={(event) => setQueryLimit(Number(event.target.value))}
              >
                {queryOptions.map((limit) => (
                  <option key={limit} value={limit}>
                    {limit} queries
                  </option>
                ))}
              </select>
            </label>
          </div>

          {mode !== 'ICP' && (
            <div className="grid grid-cols-2 gap-4 border-t border-card-border pt-4">
              {mode === 'COMPANY_CONTACTS' && (
                <>
                  <TextField label="Company name" value={companyName} onChange={setCompanyName} required />
                  <TextField label="Company domain" value={companyDomain} onChange={setCompanyDomain} placeholder="example.com" />
                </>
              )}
              {mode === 'LOOKALIKE' && (
                <>
                  <TextField label="Seed company" value={seedName} onChange={setSeedName} required />
                  <TextField label="Seed domain" value={seedDomain} onChange={setSeedDomain} placeholder="example.com" />
                </>
              )}
              <TextField label="Industries" value={industries} onChange={setIndustries} placeholder="SaaS, logistics" />
              <TextField label="Keywords" value={keywords} onChange={setKeywords} placeholder="automation, compliance" />
              {mode !== 'LOOKALIKE' && (
                <TextField label="Titles" value={titles} onChange={setTitles} placeholder="VP Sales, Revenue Director" />
              )}
              <TextField label="Locations" value={geos} onChange={setGeos} placeholder="United States, Singapore" />
              <TextField label="Seniority" value={seniority} onChange={setSeniority} placeholder="C-level, VP, Director" />
              <TextField label="Company size" value={companySize} onChange={setCompanySize} placeholder="51-200 employees" />
              <TextField label="Exclude keywords" value={excludeKeywords} onChange={setExcludeKeywords} placeholder="agency, recruiter" />
              <TextField label="Exclude domains" value={excludeDomains} onChange={setExcludeDomains} placeholder="example.org" />
            </div>
          )}

          {(preview || localPreview.length > 0) && (
            <section aria-live="polite" className="rounded-xl border border-card-border bg-bg-main p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="type-meta font-bold text-text-primary">Query preview</h3>
                <span className="type-meta font-mono text-text-muted">
                  {preview?.payloadFingerprint === payloadFingerprint ? `${preview.total} planned` : 'Local draft'}
                </span>
              </div>
              <ol className="mt-3 space-y-2">
                {(preview?.payloadFingerprint === payloadFingerprint ? preview.queries : localPreview).map((query, index) => (
                  <li key={`${query.query}-${index}`} className="rounded-lg border border-card-border bg-card-bg p-3">
                    <span className="mr-2 font-mono type-meta text-text-muted">{index + 1}.</span>
                    <code className="whitespace-pre-wrap break-words type-meta text-text-secondary">{query.query}</code>
                  </li>
                ))}
              </ol>
              {preview?.payloadFingerprint === payloadFingerprint && preview.total > preview.queries.length && (
                <p className="mt-2 type-meta text-text-muted">
                  Showing the first {preview.queries.length} of {preview.total} queries.
                </p>
              )}
            </section>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-card-border px-5 py-4">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={secondaryButton} onClick={previewPlan} disabled={previewing}>
            {previewing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
            {previewing ? 'Previewing.' : 'Preview query plan'}
          </button>
          <button type="button" className={primaryButton} onClick={createRun} disabled={!preview || preview.payloadFingerprint !== payloadFingerprint || creating}>
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Compass className="h-4 w-4" aria-hidden="true" />
            )}
            {creating ? 'Creating.' : 'Create run'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="space-y-1">
      <span className="type-meta font-semibold text-text-secondary">{label}{required ? ' *' : ''}</span>
      <input className={fieldClass} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} />
      <span className="block type-meta text-text-muted">Separate multiple values with commas.</span>
    </label>
  );
}
