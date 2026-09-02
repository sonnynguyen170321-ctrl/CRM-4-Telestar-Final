export type WebsiteResearchStatus =
  | "reachable"
  | "offline"
  | "timeout"
  | "invalid_url"
  | "blocked"
  | "parked"
  | "empty"
  | "error";

export type WebsiteResearchQuality =
  | "strong"
  | "medium"
  | "weak"
  | "unknown";

export type WebsiteResearchPage = {
  url: string;
  path: string;
  status: number | null;
  title: string | null;
  metaDescription: string | null;
  textSnippet: string | null;
  error: string | null;
};

export type WebsiteSignalEvidence = {
  keyword: string;
  category: string;
  url: string;
  snippet: string;
};

export type WebsiteSignals = {
  positiveKeywords: string[];
  negativeKeywords: string[];
  productSignals: WebsiteSignalEvidence[];
  serviceSignals: WebsiteSignalEvidence[];
  pricingSignals: WebsiteSignalEvidence[];
  apiSignals: WebsiteSignalEvidence[];
  aiSignals: WebsiteSignalEvidence[];
  cloudSignals: WebsiteSignalEvidence[];
  dataSignals: WebsiteSignalEvidence[];
  securitySignals: WebsiteSignalEvidence[];
  parkedSignals: WebsiteSignalEvidence[];
  hasProductSignal: boolean;
  hasServiceSignal: boolean;
  hasPricingSignal: boolean;
  hasApiSignal: boolean;
  hasAiSignal: boolean;
  hasCloudSignal: boolean;
  hasDataSignal: boolean;
  hasSecuritySignal: boolean;
};

export type WebsiteResearchResult = {
  inputUrl: string;
  normalizedUrl: string | null;
  normalizedDomain: string | null;
  finalUrl: string | null;
  reachable: boolean;
  status: WebsiteResearchStatus;
  httpStatus: number | null;
  redirectChain: string[];
  pagesChecked: WebsiteResearchPage[];
  signals: WebsiteSignals;
  quality: WebsiteResearchQuality;
  classificationHints: {
    likelyProductLed: boolean;
    likelyServiceLed: boolean;
    likelySaas: boolean;
    likelyCloud: boolean;
    likelyAi: boolean;
    likelyDataSolution: boolean;
    likelyCyberSecurity: boolean;
    likelyNotRelevant: boolean;
  };
  summary: string;
  errors: string[];
  researchedAt: string;
};
