import { describe, expect, it } from 'vitest';

import { buildClassificationBundle } from '../classificationEvidence';
import { classifyDeterministically } from '../deterministicClassifier';

// Production junk from the 2026-10-08 run, each as the evidence Exa/crawl actually returned.
const bundleOf = (name: string, domain: string | null, highlight: string, sourceUrl?: string) =>
  buildClassificationBundle({ name, domain, sourceUrl: sourceUrl ?? (domain ? `https://${domain}/` : null), highlight });

describe('classifyDeterministically — LinkedIn Type is a hard rule', () => {
  const cases: Array<[string, string, string, string, string]> = [
    ['City Council Org', 'cityorg.org', 'Civic and Social Organization', 'Nonprofit', 'association_nonprofit'],
    ['Ministry Unit', 'unit.example.com', 'Government Administration', 'Government Agency', 'government'],
    ['Some Institute', 'institute.example.com', 'Research Services', 'Educational', 'education'],
  ];

  it.each(cases)('%s is decided from its LinkedIn Type', (name, domain, industry, type, kind) => {
    const out = classifyDeterministically(
      bundleOf(name, domain, `${name} is a company. - Industry: ${industry} - Type: ${type} - Employees: 40`)
    );
    expect(out.decided).toBe(true);
    expect(out.partial.companyKind).toBe(kind);
    expect(out.partial.isCompanySite).toBe(true);
    expect(out.hardEvidence[0].quote).toBe(`Type: ${type}`);
    expect(out.hardEvidence[0].origin).toBeUndefined();
  });
});

describe('classifyDeterministically — LinkedIn Industry is only a hint', () => {
  // These industries reject real prospects often enough (a wholesale distributor of aircraft parts, an
  // online-media ad platform) that the model must be able to overrule them with evidence.
  const cases: Array<[string, string, string, string]> = [
    ['ISP Schools', 'ispschools.com', 'Primary and Secondary Education', 'education'],
    ['Mordor Intelligence', 'mordorintelligence.com', 'Market Research', 'research_analyst'],
    ['GlobalData', 'globaldata.com', 'Market Research', 'research_analyst'],
    ['Kingdom of Gaming', 'kingdomofgaming.com', 'Events Services', 'event'],
    ['G&G FMCG Wholesales', 'ggfmcg.com', 'Wholesale', 'reseller_wholesaler'],
    ['Gulf Staffing', 'gulfstaffing.com', 'Staffing and Recruiting', 'services_agency'],
    ['Daily News', 'dailynews.com', 'Newspaper Publishing', 'media_news'],
    ['Policy Unit', 'policyunit.com', 'Government Relations', 'government'],
  ];

  it.each(cases)('%s: industry suggests %s but decides nothing', (name, domain, industry, kind) => {
    const out = classifyDeterministically(
      bundleOf(name, domain, `${name} is a company. - Industry: ${industry} - Type: Privately held - Employees: 40`)
    );
    expect(out.decided).toBe(false);
    expect(out.hardEvidence).toEqual([]);
    expect(out.partial.companyKind).toBeUndefined();
    expect(out.hints).toContainEqual(expect.objectContaining({ field: 'companyKind', value: kind }));
  });

  it('does not hint an ordinary operating company', () => {
    const out = classifyDeterministically(
      bundleOf('Riyad Bank', 'riyadbank.com', 'Riyad Bank is a Banking company. - Industry: Banking - Type: Public Company')
    );
    expect(out.decided).toBe(false);
    expect(out.hints).toEqual([]);
    expect(out.partial.industryText).toBe('Banking');
  });

  it('carries the headcount stated in Exa prose', () => {
    const out = classifyDeterministically(
      bundleOf('Riyad Bank', 'riyadbank.com', 'Riyad Bank is a Banking company. Riyad Bank employs 25,498 people.')
    );
    expect(out.partial.employeeCount).toBe(25498);
    expect(out.partial.employeeBand).toBe('LARGE_ENTERPRISE');
  });
});

describe('classifyDeterministically — hosts', () => {
  it('a .gov.ae host is government (ICT Fund TDRA), and its evidence is marked as a rule', () => {
    const out = classifyDeterministically(bundleOf('ICT Fund', 'ictfund.gov.ae', 'Supporting ICT in the UAE.'));
    expect(out.decided).toBe(true);
    expect(out.partial.companyKind).toBe('government');
    expect(out.hardEvidence[0].origin).toBe('rule');
  });

  it('an .edu host is education, an ac.uk host too', () => {
    expect(classifyDeterministically(bundleOf('MIT', 'mit.edu', 'x')).partial.companyKind).toBe('education');
    expect(classifyDeterministically(bundleOf('Oxford', 'ox.ac.uk', 'x')).partial.companyKind).toBe('education');
    expect(classifyDeterministically(bundleOf('TECH Global University', 'techglobal.edu.vn', 'x')).partial.companyKind).toBe('education');
  });

  it('govtech.com is a company, not government', () => {
    const out = classifyDeterministically(bundleOf('GovTech', 'govtech.com', 'We build software.'));
    expect(out.partial.companyKind).toBeUndefined();
  });

  it('a job board host is directory_marketplace_jobboard (GulfTalent)', () => {
    const out = classifyDeterministically(bundleOf('GulfTalent', 'gulftalent.com', 'Jobs in the Gulf.'));
    expect(out.decided).toBe(true);
    expect(out.partial.companyKind).toBe('directory_marketplace_jobboard');
  });

  it('a directory host is decided too', () => {
    const out = classifyDeterministically(bundleOf('Clutch', 'clutch.co', 'Top agencies.'));
    expect(out.partial.companyKind).toBe('directory_marketplace_jobboard');
  });

  it('a LinkedIn-sourced candidate with no domain is not a job board because of the source host', () => {
    const out = classifyDeterministically(
      bundleOf('Acme Aero', null, 'Acme Aero provides aircraft maintenance. - Industry: Airlines and Aviation - Type: Privately held', 'https://www.linkedin.com/company/acme-aero')
    );
    expect(out.decided).toBe(false);
    expect(out.partial.companyKind).toBeUndefined();
  });

  it('LinkedIn Type is read before the host rules', () => {
    const out = classifyDeterministically(
      bundleOf('Gulf Society', 'gulfsociety.com', 'x is a body. - Industry: Civic and Social Organization - Type: Nonprofit')
    );
    expect(out.hardEvidence[0].quote).toBe('Type: Nonprofit');
  });
});

describe('classifyDeterministically — soft hints never decide', () => {
  it('an association name is a hint only (UAE Banks Federation)', () => {
    const out = classifyDeterministically(bundleOf('UAE Banks Federation', 'uaebf.ae', 'Representing the banks of the UAE.'));
    expect(out.decided).toBe(false);
    expect(out.partial.companyKind).toBeUndefined();
    expect(out.hints).toContainEqual(expect.objectContaining({ field: 'companyKind', value: 'association_nonprofit' }));
    expect(out.hardEvidence).toEqual([]);
  });

  it('a bank with Council in its name is not changed by the hint', () => {
    const out = classifyDeterministically(bundleOf('Gulf Cooperation Council Bank', 'gccbank.com', 'A retail bank. - Industry: Banking - Type: Public Company'));
    expect(out.decided).toBe(false);
    expect(out.partial.companyKind).toBeUndefined();
    expect(out.partial.isCompanySite).toBeUndefined();
  });

  it('a listicle title with a blog path hints listicle (apas1.com)', () => {
    const out = classifyDeterministically(
      bundleOf('Top 10 Aircraft MRO Companies in 2026', 'apas1.com', 'A roundup.', 'https://apas1.com/blog/top-10-aircraft-mro-companies')
    );
    expect(out.decided).toBe(false);
    expect(out.partial.isCompanySite).toBeUndefined();
    expect(out.hints).toContainEqual(expect.objectContaining({ field: 'notCompanyReason', value: 'listicle' }));
  });

  it('a plain blog path hints article', () => {
    const out = classifyDeterministically(bundleOf('apas1', 'apas1.com', 'x', 'https://apas1.com/blog/2026/10/mro-trends'));
    expect(out.hints).toContainEqual(expect.objectContaining({ field: 'notCompanyReason', value: 'article' }));
  });

  it('a job path hints job_posting', () => {
    const out = classifyDeterministically(bundleOf('Engineer', 'acme.com', 'x', 'https://acme.com/jobs/aircraft-engineer-123'));
    expect(out.hints).toContainEqual(expect.objectContaining({ field: 'notCompanyReason', value: 'job_posting' }));
  });
});

describe('classifyDeterministically — parked and quiet', () => {
  it('a parked domain is decided, not a company', () => {
    const out = classifyDeterministically(bundleOf('Foo', 'foo.com', 'This domain is for sale. Buy this domain today!'));
    expect(out.decided).toBe(true);
    expect(out.partial.isCompanySite).toBe(false);
    expect(out.partial.notCompanyReason).toBe('parked');
  });

  it('a long page that mentions a domain for sale is not parked', () => {
    const text = `Domain for sale marketplace. ${'Browse premium names and make an offer. '.repeat(60)}`;
    const out = buildClassificationBundle({ name: 'Broker', domain: 'broker.com', highlight: text });
    expect(classifyDeterministically(out).decided).toBe(false);
  });

  it('says nothing about an ordinary company with no signals', () => {
    const out = classifyDeterministically(bundleOf('Lufthansa Technik', 'lufthansa-technik.com', 'Aircraft maintenance, repair and overhaul.'));
    expect(out.decided).toBe(false);
    expect(out.hardEvidence).toEqual([]);
    expect(out.hints).toEqual([]);
    expect(out.partial.companyKind).toBeUndefined();
  });
});
