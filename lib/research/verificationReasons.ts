/**
 * Plain words for a research candidate's verification reason (2026-10-08). Shared by the run summary
 * (lib/research/verify.ts) and the research page, so a rep reads "media / news" where the database says
 * `company_type:media_news`. No imports: safe in client components.
 */
const REASON_WORDS: Array<[RegExp, string]> = [
  [/^not_company_site:article/, 'an article, not a company page'],
  [/^not_company_site:listicle/, 'a list of companies, not a company'],
  [/^not_company_site:job_posting/, 'a job posting'],
  [/^not_company_site:directory_page/, 'a directory page'],
  [/^not_company_site:parked/, 'a parked domain'],
  [/^not_company_site/, 'not a company site'],
  [/^company_type:media_news/, 'media / news'],
  [/^company_type:directory_marketplace_jobboard/, 'directory or job board'],
  [/^company_type:research_analyst/, 'research / analyst firm'],
  [/^company_type:association_nonprofit/, 'association / non-profit'],
  [/^company_type:government/, 'government'],
  [/^company_type:education/, 'education'],
  [/^company_type:event/, 'event'],
  [/^company_type:software_vendor/, 'software vendor'],
  [/^company_type:services_agency/, 'services / agency'],
  [/^company_type:reseller_wholesaler/, 'reseller / wholesaler'],
  [/^company_type:/, 'wrong kind of company'],
  [/^competitor/, 'competitor'],
  [/^(hq_outside_target|outside_target_geo)/, 'outside the target countries'],
  [/^size_out_of_range|^one_person_company/, 'wrong size'],
  [/^industry_not_targeted/, 'wrong industry'],
  [/^not_icp_fit/, 'not the ICP'],
  [/^excluded_keyword_mention/, 'mentions an excluded keyword'],
  [/^excluded_keyword/, 'excluded keyword'],
  [/^industry_unconfirmed/, 'industry not confirmed'],
  [/^company_type_review/, 'company type not confirmed'],
  [/^judge_(unsure|doubt)/, 'fit not confirmed'],
  [/^low_confidence/, 'evidence thin'],
  [/^(weighted_qualified|judge_confirmed)/, 'fits the ICP'],
  [/^weighted_borderline/, 'borderline fit'],
  [/^core_evidence_missing/, 'key facts missing'],
  [/^site_blocked/, 'site refused'],
  [/^site_timeout/, 'site timed out'],
  [/^site_unreachable/, 'site unreachable'],
  [/^no_evidence/, 'nothing readable'],
  [/^no_domain/, 'no website'],
  [/^classifier_unavailable/, 'checker unavailable'],
];

export function describeReason(reason: string | null | undefined): string {
  if (!reason) return 'other';
  return REASON_WORDS.find(([pattern]) => pattern.test(reason))?.[1] ?? reason.replace(/[_:]/g, ' ');
}
