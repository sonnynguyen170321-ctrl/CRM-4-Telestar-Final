import type {
  WebsiteResearchPage,
  WebsiteSignalEvidence,
  WebsiteSignals,
} from "@/lib/types";
import {
  WEBSITE_RESEARCH_MAX_EVIDENCE_PER_CATEGORY,
  SIGNAL_DEFINITIONS,
  type SignalGroupKey,
} from "@/lib/server/websiteResearch/constants";

export function extractWebsiteSignals(
  pages: WebsiteResearchPage[]
): WebsiteSignals {
  const signals = createEmptySignals();

  for (const page of pages) {
    if (!isSuccessfulHtmlPage(page)) {
      continue;
    }

    const pageText = [page.title, page.metaDescription, page.textSnippet]
      .filter(Boolean)
      .join(" ");

    if (!pageText) {
      continue;
    }

    for (const [groupKey, definition] of Object.entries(
      SIGNAL_DEFINITIONS
    ) as Array<[SignalGroupKey, (typeof SIGNAL_DEFINITIONS)[SignalGroupKey]]>) {
      const evidence = findKeywordEvidence({
        text: pageText,
        url: page.url,
        category: definition.category,
        keywords: definition.keywords,
      });

      signals[groupKey].push(...evidence);
      signals[groupKey] = dedupeAndCapEvidence(signals[groupKey]);
    }
  }

  const positiveKeywords = new Set<string>();
  const negativeKeywords = new Set<string>();

  for (const key of positiveSignalKeys) {
    for (const evidence of signals[key]) {
      positiveKeywords.add(evidence.keyword);
    }
  }

  for (const key of negativeSignalKeys) {
    for (const evidence of signals[key]) {
      negativeKeywords.add(evidence.keyword);
    }
  }

  signals.positiveKeywords = [...positiveKeywords];
  signals.negativeKeywords = [...negativeKeywords];
  signals.hasProductSignal = signals.productSignals.length > 0;
  signals.hasServiceSignal = signals.serviceSignals.length > 0;
  signals.hasPricingSignal = signals.pricingSignals.length > 0;
  signals.hasApiSignal = signals.apiSignals.length > 0;
  signals.hasAiSignal = signals.aiSignals.length > 0;
  signals.hasCloudSignal = signals.cloudSignals.length > 0;
  signals.hasDataSignal = signals.dataSignals.length > 0;
  signals.hasSecuritySignal = signals.securitySignals.length > 0;

  return signals;
}

function createEmptySignals(): WebsiteSignals {
  return {
    positiveKeywords: [],
    negativeKeywords: [],
    productSignals: [],
    serviceSignals: [],
    pricingSignals: [],
    apiSignals: [],
    aiSignals: [],
    cloudSignals: [],
    dataSignals: [],
    securitySignals: [],
    parkedSignals: [],
    hasProductSignal: false,
    hasServiceSignal: false,
    hasPricingSignal: false,
    hasApiSignal: false,
    hasAiSignal: false,
    hasCloudSignal: false,
    hasDataSignal: false,
    hasSecuritySignal: false,
  };
}

const positiveSignalKeys: SignalGroupKey[] = [
  "productSignals",
  "pricingSignals",
  "apiSignals",
  "aiSignals",
  "cloudSignals",
  "dataSignals",
  "securitySignals",
];

const negativeSignalKeys: SignalGroupKey[] = [
  "serviceSignals",
  "parkedSignals",
];

function findKeywordEvidence({
  text,
  url,
  category,
  keywords,
}: {
  text: string;
  url: string;
  category: string;
  keywords: string[];
}) {
  const evidence: WebsiteSignalEvidence[] = [];

  for (const keyword of keywords) {
    const index = findTokenSafeKeywordIndex(text, keyword);

    if (index === -1) {
      continue;
    }

    evidence.push({
      keyword,
      category,
      url,
      snippet: createKeywordSnippet(text, index, keyword.length),
    });
  }

  return evidence;
}

function isSuccessfulHtmlPage(page: WebsiteResearchPage) {
  return (
    page.status !== null &&
    page.status >= 200 &&
    page.status < 300 &&
    page.error === null
  );
}

function findTokenSafeKeywordIndex(text: string, keyword: string) {
  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  let searchFrom = 0;

  while (searchFrom < lowerText.length) {
    const index = lowerText.indexOf(lowerKeyword, searchFrom);

    if (index === -1) {
      return -1;
    }

    const before = lowerText[index - 1] ?? "";
    const after = lowerText[index + lowerKeyword.length] ?? "";

    if (isTokenBoundary(before) && isTokenBoundary(after)) {
      return index;
    }

    searchFrom = index + lowerKeyword.length;
  }

  return -1;
}

function isTokenBoundary(character: string) {
  return character === "" || !/[a-z0-9]/i.test(character);
}

function dedupeAndCapEvidence(evidence: WebsiteSignalEvidence[]) {
  const seen = new Set<string>();
  const deduped: WebsiteSignalEvidence[] = [];

  for (const item of evidence) {
    const key = `${item.category}:${item.keyword.toLowerCase()}:${item.url}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);

    if (deduped.length >= WEBSITE_RESEARCH_MAX_EVIDENCE_PER_CATEGORY) {
      break;
    }
  }

  return deduped;
}

function createKeywordSnippet(text: string, index: number, keywordLength: number) {
  const start = Math.max(index - 80, 0);
  const end = Math.min(index + keywordLength + 80, text.length);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}
