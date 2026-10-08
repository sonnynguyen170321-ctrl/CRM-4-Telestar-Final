import { describe, expect, it } from 'vitest';

import { buildClassificationBundle } from '../classificationEvidence';
import { classifyDeterministically } from '../deterministicClassifier';

// Production junk from the 2026-10-08 run, each as the evidence Exa/crawl actually returned.
const bundleOf = (name: string, domain: string, highlight: string, sourceUrl?: string) =>
  buildClassificationBundle({ name, domain, sourceUrl: sourceUrl ?? `https://${domain}/`, highlight });

describe('classifyDeterministically — LinkedIn Industry table', () => {
  const cases: Array<[string, string, string, string, string]> = [
    ['ISP Schools', 'ispschools.com', 'Primary and Secondary Education', 'Privately held', 'education'],
    ['TECH Global University', 'techglobal.edu.vn', 'Higher Education', 'Educational', 'education'],
    ['Mordor Intelligence', 'mordorintelligence.com', 'Market Research', 'Privately held', 'research_analyst'],
    ['GlobalData', 'globaldata.com', 'Market Research', 'Public Company', 'research_analyst'],
    ['Kingdom of Gaming', 'kingdomofgaming.com', 'Events Services', 'Privately held', 'event'],
    ['G&G FMCG Wholesales', 'ggfmcg.com', 'Wholesale', 'Privately held', 'reseller_wholesaler'],
    ['Gulf Staffing', 'gulfstaffing.com', 'Staffing and Recruiting', 'Privately held', 'services_agency'],
    ['Daily News', 'dailynews.com', 'Newspaper Publishing', 'Privately held', 'media_news'],
    ['City Council Org', 'cityorg.org', 'Civic and Social Organization', 'Nonprofit', 'association_nonprofit'],
    ['Ministry Unit', 'unit.example.com', 'Government Administration', 'Government Agency', 'government'],
  ];

  it.each(cases)('%s is %s-decided from its LinkedIn record', (name, domain, industry, type, kind) => {
    const out = classifyDeterministically(
      bundleOf(name, domain, `${name} is a company. - Industry: ${industry} - Type: ${type} - Employees: 40`)
    );
    expect(out.decided).toBe(true);
    expect(out.partial.companyKind).toBe(kind);
    expect(out.partial.isCompanySite).toBe(true);
    expect(out.hardEvidence.length).toBeGreaterThan(0);
    expect(out.hardEvidence[0].quote.length).toBeGreaterThanOrEqual(8);
  });

  it('does not decide an ordinary operating company from its industry', () => {
    const out = classifyDeterministically(
      bundleOf('Riyad Bank', 'riyadbank.com', 'Riyad Bank is a Banking company. - Industry: Banking - Type: Public Company')
    );
    expect(out.decided).toBe(false);
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
  it('a .gov.ae host is government (ICT Fund TDRA)', () => {
    const out = classifyDeterministically(bundleOf('ICT Fund', 'ictfund.gov.ae', 'Supporting ICT in the UAE.'));
    expect(out.decided).toBe(true);
    expect(out.partial.companyKind).toBe('government');
  });

  it('an .edu host is education, an ac.uk host too', () => {
    expect(classifyDeterministically(bundleOf('MIT', 'mit.edu', 'x')).partial.companyKind).toBe('education');
    expect(classifyDeterministically(bundleOf('Oxford', 'ox.ac.uk', 'x')).partial.companyKind).toBe('education');
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
});

describe('classifyDeterministically — soft signals', () => {
  it('an association name is a medium-confidence hint, never decided (UAE Banks Federation)', () => {
    const out = classifyDeterministically(bundleOf('UAE Banks Federation', 'uaebf.ae', 'Representing the banks of the UAE.'));
    expect(out.decided).toBe(false);
    expect(out.partial.companyKind).toBe('association_nonprofit');
    expect(out.partial.confidence).toBe('medium');
    expect(out.hardEvidence).toEqual([]);
  });

  it('a blog post path with a listicle title is not a company (apas1.com)', () => {
    const out = classifyDeterministically(
      bundleOf('Top 10 Aircraft MRO Companies in 2026', 'apas1.com', 'A roundup.', 'https://apas1.com/blog/top-10-aircraft-mro-companies')
    );
    expect(out.partial.isCompanySite).toBe(false);
    expect(out.partial.notCompanyReason).toBe('listicle');
    expect(out.partial.confidence).toBe('medium');
  });

  it('a plain blog path alone says article, medium confidence', () => {
    const out = classifyDeterministically(bundleOf('apas1', 'apas1.com', 'x', 'https://apas1.com/blog/2026/10/mro-trends'));
    expect(out.partial.notCompanyReason).toBe('article');
    expect(out.decided).toBe(false);
  });

  it('a parked domain is decided, not a company', () => {
    const out = classifyDeterministically(bundleOf('Foo', 'foo.com', 'This domain is for sale. Buy this domain today!'));
    expect(out.decided).toBe(true);
    expect(out.partial.isCompanySite).toBe(false);
    expect(out.partial.notCompanyReason).toBe('parked');
  });

  it('says nothing about an ordinary company with no signals', () => {
    const out = classifyDeterministically(bundleOf('Lufthansa Technik', 'lufthansa-technik.com', 'Aircraft maintenance, repair and overhaul.'));
    expect(out.decided).toBe(false);
    expect(out.hardEvidence).toEqual([]);
    expect(out.partial.companyKind).toBeUndefined();
  });
});
