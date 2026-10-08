import { describe, expect, it } from 'vitest';

import { buildClassificationBundle } from '../classificationEvidence';
import { classifyDeterministically } from '../deterministicClassifier';
import { groundClassification } from '../groundClassification';

// Golden cases from the 2026-10-08 production run, end to end: evidence -> deterministic rules -> a
// model answer (faked) -> grounding. The model half is scripted; what is under test is that what survives
// is right and that nothing the evidence does not support gets through.

const run = (
  candidate: { name: string; domain: string; sourceUrl: string; highlight: string },
  model: Record<string, unknown> | null
) => {
  const bundle = buildClassificationBundle(candidate);
  const det = classifyDeterministically(bundle);
  return { det, out: groundClassification(model ?? {}, bundle, det) };
};

const base = {
  isCompanySite: true,
  notCompanyReason: null,
  companyKind: 'operator',
  industryText: null,
  industryKey: null,
  whatTheySell: null,
  hqCountry: null,
  employeeCount: null,
  employeeBand: null,
  confidence: 'high',
  evidence: [] as unknown[],
};

describe('golden: production junk is named for what it is', () => {
  it('AircraftCloud is a software vendor, not an MRO operator', () => {
    const url = 'https://aircraftcloud.com/';
    const { out } = run(
      { name: 'AircraftCloud', domain: 'aircraftcloud.com', sourceUrl: url, highlight: 'AircraftCloud is a cloud-based MRO software platform for airlines and maintenance organisations.' },
      {
        ...base,
        companyKind: 'software_vendor',
        industryKey: 'SAAS',
        industryText: 'Aviation software',
        evidence: [{ field: 'companyKind', quote: 'cloud-based MRO software platform', sourceUrl: url }],
      }
    );
    expect(out.value).toMatchObject({ companyKind: 'software_vendor', industryKey: 'SAAS', confidence: 'high' });
  });

  it('Lufthansa Technik is an operator in MRO', () => {
    const url = 'https://lufthansa-technik.com/';
    const { out } = run(
      { name: 'Lufthansa Technik', domain: 'lufthansa-technik.com', sourceUrl: url, highlight: 'Lufthansa Technik provides aircraft maintenance, repair and overhaul services worldwide.' },
      { ...base, industryText: 'Aircraft MRO', evidence: [{ field: 'industry', quote: 'aircraft maintenance, repair and overhaul services', sourceUrl: url }] }
    );
    expect(out.value?.companyKind).toBe('operator');
    expect(out.dropped).toEqual([]);
  });

  it('Riyad Bank is a positive operator with its headcount read from Exa prose', () => {
    const url = 'https://riyadbank.com/';
    const { out } = run(
      { name: 'Riyad Bank', domain: 'riyadbank.com', sourceUrl: url, highlight: 'Riyad Bank is a Banking company. Riyad Bank employs 25,498 people.' },
      {
        ...base,
        industryText: 'Banking',
        industryKey: 'BANKING',
        employeeCount: 25498,
        evidence: [{ field: 'employeeCount', quote: 'employs 25,498 people', sourceUrl: url }],
      }
    );
    expect(out.value).toMatchObject({ companyKind: 'operator', industryKey: 'BANKING', employeeCount: 25498, employeeBand: 'LARGE_ENTERPRISE', confidence: 'high' });
  });

  it('GulfTalent stays a job board even if the model calls it an operator', () => {
    const { out } = run(
      { name: 'GulfTalent', domain: 'gulftalent.com', sourceUrl: 'https://gulftalent.com/', highlight: 'Jobs in aircraft maintenance across the Gulf.' },
      base
    );
    expect(out.value?.companyKind).toBe('directory_marketplace_jobboard');
  });

  it('the apas1.com blog post is not a company', () => {
    const url = 'https://apas1.com/blog/top-10-mro-companies';
    const { out } = run(
      { name: 'Top 10 MRO Companies', domain: 'apas1.com', sourceUrl: url, highlight: 'Our roundup of the ten largest MRO providers in 2026, ranked by revenue.' },
      {
        ...base,
        isCompanySite: false,
        notCompanyReason: 'listicle',
        companyKind: null,
        confidence: 'medium',
        evidence: [{ field: 'notCompanyReason', quote: 'roundup of the ten largest MRO providers', sourceUrl: url }],
      }
    );
    expect(out.value).toMatchObject({ isCompanySite: false, notCompanyReason: 'listicle', companyKind: null });
  });

  it('an invented claim about a candidate with no evidence is not carried through', () => {
    const { out } = run(
      { name: 'Mystery Co', domain: 'mystery.com', sourceUrl: 'https://mystery.com/', highlight: 'Mystery Co.' },
      { ...base, employeeCount: 5000, evidence: [{ field: 'employeeCount', quote: 'employs 5,000 skilled people', sourceUrl: 'https://mystery.com/' }] }
    );
    expect(out.value?.employeeCount).toBeNull();
    expect(out.value?.confidence).not.toBe('high');
  });
});
