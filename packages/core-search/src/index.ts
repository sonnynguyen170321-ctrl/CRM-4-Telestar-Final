// Multi-provider web search: query fan-out, provider chain, result reranking, and a fetch guarded
// against SSRF.
//
// The provider chain (exa, brave, serper, searxng, ddg) is what makes company discovery work on the
// ~40% of real sites that block a crawler outright. Callers supply the credentials through the
// environment contract in `search/env`; nothing here knows about a database.
export * from "./search/companyIntelSearch";
export * from "./search/buildCompanySearchQueries";
export * from "./search/rerankResults";
export * from "./search/scoreSearchResult";
export * from "./search/env";
export * from "./search/types";
export * from "./safeFetch";
