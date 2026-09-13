// Research discovery: turn an ICP into search queries, reject the junk that comes back, deduplicate
// candidates across runs, score their fit, and shape them for review.
//
// This is the half the CRM does not have. Its existing research caches enrich a record that already
// exists; nothing there finds new companies or people. All of it is pure: queries in, candidates out.
// Provider calls, persistence and the AI refinements stay in the app.
export * from "./buildDiscoveryQueries";
export * from "./parseDiscoveryResults";
export * from "./icpDiscoveryFilter";
export * from "./candidateIdentity";
export * from "./prospectDedupe";
export * from "./scoreCandidates";
export * from "./fitPrompt";
export * from "./peopleDiscovery";
export * from "./contactExtract";
export * from "./findContactEmail";
export * from "./insightMapper";
export * from "./verifyCandidates";
export * from "./comprehendSeed";
