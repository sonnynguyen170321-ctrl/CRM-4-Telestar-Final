// Company intelligence: crawl a company's own site, reason over what it says, and classify what the
// company actually does.
//
// The classifier is two-tier on purpose. It settles a sector (TECH / REAL_ECONOMY / SERVICES) from
// markers about how a business runs, then scores categories only within that sector — a flat list let
// a property developer win at `hr_recruiting` off its careers pages. It also reads whole identity
// pages rather than the short blurb kept for citations, and it ignores the page types that describe
// somebody else (INDUSTRIES, CUSTOMERS, CASE_STUDY, CAREERS, JOBS, ...). Measured on a 98-company
// labelled set: 64% category accuracy, 95% sector.
//
// Persistence stays in each app: snapshot and profile rows, the job handler, read models and the
// provider budget all live app-side, because the two applications keep them in different tables.
export * from "./runCompanyResearch";
export * from "./crawlCompanySite";
export * from "./fetchWebsite";
export * from "./canonicalDomain";
export * from "./extractFacts";
export * from "./companySignals";
export * from "./companyDepthSignals";
export * from "./presentIntelligence";
export * from "./mapIntelligenceToCompanyEvidence";
export * from "./mapIntelligenceProfileToScoring";
export * from "./pipelineVersion";
export * from "./searchProvider";
export * from "./playwrightFallback";
export * from "./profileSummary";
