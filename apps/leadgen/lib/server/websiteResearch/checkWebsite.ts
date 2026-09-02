import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type {
  WebsiteResearchPage,
  WebsiteResearchQuality,
  WebsiteResearchResult,
  WebsiteResearchStatus,
  WebsiteSignals,
} from "@/lib/types";
import {
  WEBSITE_RESEARCH_MAX_BYTES,
  WEBSITE_RESEARCH_MAX_REDIRECTS,
  WEBSITE_RESEARCH_PATHS,
  WEBSITE_RESEARCH_TIMEOUT_MS,
} from "@/lib/server/websiteResearch/constants";
import { extractWebsiteSignals } from "@/lib/server/websiteResearch/extractSignals";
import {
  createTextSnippet,
  extractMetaDescription,
  extractTitle,
  htmlToText,
} from "@/lib/server/websiteResearch/htmlText";

type FetchPageResult = WebsiteResearchPage & {
  finalUrl: string | null;
  redirectChain: string[];
};

type WebsiteClassificationHints =
  WebsiteResearchResult["classificationHints"];

const EMPTY_CLASSIFICATION_HINTS = {
  likelyProductLed: false,
  likelyServiceLed: false,
  likelySaas: false,
  likelyCloud: false,
  likelyAi: false,
  likelyDataSolution: false,
  likelyCyberSecurity: false,
  likelyNotRelevant: true,
} satisfies WebsiteClassificationHints;

export async function checkWebsite(
  inputUrl: string
): Promise<WebsiteResearchResult> {
  const researchedAt = new Date().toISOString();
  const normalized = normalizeWebsiteUrl(inputUrl);

  if (!normalized.ok) {
    return buildEmptyResult({
      inputUrl,
      status: normalized.status,
      summary: normalized.error,
      errors: [normalized.error],
      researchedAt,
    });
  }

  const blockedReason = getBlockedHostReason(normalized.url);

  if (blockedReason) {
    return buildEmptyResult({
      inputUrl,
      status: "blocked",
      normalizedUrl: normalized.url.toString(),
      normalizedDomain: normalized.url.hostname,
      summary: blockedReason,
      errors: [blockedReason],
      researchedAt,
    });
  }

  const dnsGuard = await checkResolvedAddresses(normalized.url);

  if (!dnsGuard.ok) {
    return buildEmptyResult({
      inputUrl,
      status: dnsGuard.status,
      normalizedUrl: normalized.url.toString(),
      normalizedDomain: normalized.url.hostname,
      summary: dnsGuard.error,
      errors: [dnsGuard.error],
      researchedAt,
    });
  }

  const pages: WebsiteResearchPage[] = [];
  const errors: string[] = [];
  const redirectChain: string[] = [];
  let finalUrl: string | null = null;
  let httpStatus: number | null = null;
  let candidateBaseUrl = normalized.url;

  const homepageResult = await fetchResearchPage(normalized.url, {
    allowOriginChange: true,
  });
  pages.push(stripFetchMetadata(homepageResult));

  if (homepageResult.redirectChain.length > 0) {
    redirectChain.push(...homepageResult.redirectChain);
  }

  if (homepageResult.finalUrl) {
    finalUrl = homepageResult.finalUrl;
  }

  if (homepageResult.finalUrl && homepageResult.error === null) {
    candidateBaseUrl = new URL(homepageResult.finalUrl);
  }

  if (homepageResult.status !== null) {
    httpStatus = homepageResult.status;
  }

  if (homepageResult.error) {
    errors.push(`${homepageResult.path}: ${homepageResult.error}`);
  }

  for (const url of buildCandidateUrls(candidateBaseUrl, {
    includeHomepage: false,
  })) {
    const result = await fetchResearchPage(url, {
      allowOriginChange: false,
    });
    pages.push(stripFetchMetadata(result));

    if (result.redirectChain.length > 0) {
      redirectChain.push(...result.redirectChain);
    }

    if (!finalUrl && result.finalUrl) {
      finalUrl = result.finalUrl;
    }

    if (httpStatus === null && result.status !== null) {
      httpStatus = result.status;
    }

    if (result.error) {
      errors.push(`${result.path}: ${result.error}`);
    }
  }

  const signals = extractWebsiteSignals(pages);
  const status = determineStatus({ pages, signals, errors });
  const reachable = status === "reachable" || status === "parked";
  const classificationHints = buildClassificationHints(signals, status);
  const quality = determineQuality({
    status,
    pages,
    signals,
    classificationHints,
  });

  return {
    inputUrl,
    normalizedUrl: normalized.url.toString(),
    normalizedDomain: normalized.url.hostname,
    finalUrl,
    reachable,
    status,
    httpStatus,
    redirectChain: [...new Set(redirectChain)],
    pagesChecked: pages,
    signals,
    quality,
    classificationHints,
    summary: buildSummary({ status, quality, signals, pages }),
    errors,
    researchedAt,
  };
}

function normalizeWebsiteUrl(inputUrl: string):
  | { ok: true; url: URL }
  | { ok: false; status: WebsiteResearchStatus; error: string } {
  const trimmed = inputUrl.trim();

  if (!trimmed) {
    return {
      ok: false,
      status: "invalid_url",
      error: "Website is required.",
    };
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);

    if (!["http:", "https:"].includes(url.protocol)) {
      return {
        ok: false,
        status: "blocked",
        error: "Only http and https websites can be researched.",
      };
    }

    url.hash = "";
    return { ok: true, url };
  } catch {
    return {
      ok: false,
      status: "invalid_url",
      error: "Website URL is invalid.",
    };
  }
}

function getBlockedHostReason(url: URL) {
  const hostname = normalizeHostname(url.hostname);

  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    return "Internal localhost addresses cannot be researched.";
  }

  if (
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.")
  ) {
    return "Private network addresses cannot be researched.";
  }

  const parts = hostname.split(".").map(Number);
  const isPrivate172 =
    parts.length === 4 &&
    parts[0] === 172 &&
    Number.isInteger(parts[1]) &&
    parts[1] >= 16 &&
    parts[1] <= 31;

  if (isPrivate172) {
    return "Private network addresses cannot be researched.";
  }

  return null;
}

async function checkResolvedAddresses(
  url: URL
): Promise<
  | { ok: true }
  | { ok: false; status: "blocked" | "offline"; error: string }
> {
  const hostname = normalizeHostname(url.hostname);
  const ipVersion = isIP(hostname);

  if (ipVersion !== 0) {
    return isPrivateIpAddress(hostname)
      ? {
          ok: false,
          status: "blocked",
          error: "Private network addresses cannot be researched.",
        }
      : { ok: true };
  }

  try {
    const addresses = await lookup(hostname, {
      all: true,
      verbatim: true,
    });

    if (addresses.some((address) => isPrivateIpAddress(address.address))) {
      return {
        ok: false,
        status: "blocked",
        error: "Resolved private network addresses cannot be researched.",
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      status: "offline",
      error: "Website hostname could not be resolved.",
    };
  }
}

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function isPrivateIpAddress(address: string) {
  const normalizedAddress = normalizeHostname(address);
  const ipVersion = isIP(normalizedAddress);

  if (ipVersion === 4) {
    return isPrivateIpv4Address(normalizedAddress);
  }

  if (ipVersion === 6) {
    return isPrivateIpv6Address(normalizedAddress);
  }

  return false;
}

function isPrivateIpv4Address(address: string) {
  const parts = address.split(".").map(Number);

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [first, second] = parts;

  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6Address(address: string) {
  return (
    address === "::1" ||
    address === "::" ||
    address === "0:0:0:0:0:0:0:1" ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    address.startsWith("fe80:") ||
    address.startsWith("::ffff:10.") ||
    address.startsWith("::ffff:127.") ||
    address.startsWith("::ffff:192.168.") ||
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

function buildCandidateUrls(
  baseUrl: URL,
  { includeHomepage = true }: { includeHomepage?: boolean } = {}
) {
  const urls = new Map<string, URL>();

  for (const path of WEBSITE_RESEARCH_PATHS) {
    if (!includeHomepage && path === "/") {
      continue;
    }

    const candidate = new URL(path, baseUrl.origin);
    urls.set(candidate.toString(), candidate);
  }

  return [...urls.values()];
}

async function fetchResearchPage(
  url: URL,
  { allowOriginChange }: { allowOriginChange: boolean }
): Promise<FetchPageResult> {
  const redirectChain: string[] = [];
  let currentUrl = url;

  for (
    let redirects = 0;
    redirects <= WEBSITE_RESEARCH_MAX_REDIRECTS;
    redirects += 1
  ) {
    const currentBlockedReason = getBlockedHostReason(currentUrl);

    if (currentBlockedReason) {
      return pageResult({
        url: currentUrl,
        status: null,
        error: currentBlockedReason,
        redirectChain,
      });
    }

    const currentDnsGuard = await checkResolvedAddresses(currentUrl);

    if (!currentDnsGuard.ok) {
      return pageResult({
        url: currentUrl,
        status: null,
        error: currentDnsGuard.error,
        redirectChain,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      WEBSITE_RESEARCH_TIMEOUT_MS
    );

    try {
      const response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "TeleStarWebsiteResearch/0.1",
        },
      });
      clearTimeout(timeout);

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");

        if (!location) {
          return pageResult({
            url: currentUrl,
            status: response.status,
            error: "Redirect response did not include a location.",
            redirectChain,
          });
        }

        const nextUrl = new URL(location, currentUrl);

        const blockedRedirectReason = getBlockedHostReason(nextUrl);

        if (blockedRedirectReason) {
          return pageResult({
            url: currentUrl,
            status: response.status,
            error: blockedRedirectReason,
            redirectChain,
            finalUrl: nextUrl.toString(),
          });
        }

        const redirectDnsGuard = await checkResolvedAddresses(nextUrl);

        if (!redirectDnsGuard.ok) {
          return pageResult({
            url: currentUrl,
            status: response.status,
            error: redirectDnsGuard.error,
            redirectChain,
            finalUrl: nextUrl.toString(),
          });
        }

        if (!allowOriginChange && nextUrl.origin !== url.origin) {
          return pageResult({
            url: currentUrl,
            status: response.status,
            error: "Redirected outside researched origin.",
            redirectChain,
            finalUrl: nextUrl.toString(),
          });
        }

        redirectChain.push(nextUrl.toString());
        currentUrl = nextUrl;
        continue;
      }

      if (!response.ok) {
        return pageResult({
          url: currentUrl,
          status: response.status,
          error: `HTTP ${response.status}`,
          redirectChain,
          finalUrl: currentUrl.toString(),
        });
      }

      if (!isHtmlResponse(response)) {
        return pageResult({
          url: currentUrl,
          status: response.status,
          error: "Non-HTML response skipped.",
          redirectChain,
          finalUrl: currentUrl.toString(),
        });
      }

      const html = await readResponseText(response);
      const text = htmlToText(html);

      return {
        url: currentUrl.toString(),
        path: currentUrl.pathname,
        status: response.status,
        title: extractTitle(html),
        metaDescription: extractMetaDescription(html),
        textSnippet: createTextSnippet(text),
        error: null,
        finalUrl: currentUrl.toString(),
        redirectChain,
      };
    } catch (error) {
      clearTimeout(timeout);

      return pageResult({
        url: currentUrl,
        status: null,
        error:
          error instanceof Error && error.name === "AbortError"
            ? "Request timed out."
            : "Website request failed.",
        redirectChain,
      });
    }
  }

  return pageResult({
    url: currentUrl,
    status: null,
    error: "Too many redirects.",
    redirectChain,
  });
}

async function readResponseText(response: Response) {
  const reader = response.body?.getReader();

  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (receivedBytes < WEBSITE_RESEARCH_MAX_BYTES) {
    const { done, value } = await reader.read();

    if (done || !value) {
      break;
    }

    const remainingBytes = WEBSITE_RESEARCH_MAX_BYTES - receivedBytes;
    const chunk =
      value.byteLength > remainingBytes ? value.slice(0, remainingBytes) : value;
    chunks.push(chunk);
    receivedBytes += chunk.byteLength;
  }

  await reader.cancel().catch(() => undefined);

  return new TextDecoder().decode(joinChunks(chunks));
}

function joinChunks(chunks: Uint8Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const joined = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return joined;
}

function pageResult({
  url,
  status,
  error,
  redirectChain,
  finalUrl = null,
}: {
  url: URL;
  status: number | null;
  error: string;
  redirectChain: string[];
  finalUrl?: string | null;
}): FetchPageResult {
  return {
    url: url.toString(),
    path: url.pathname,
    status,
    title: null,
    metaDescription: null,
    textSnippet: null,
    error,
    finalUrl,
    redirectChain,
  };
}

function stripFetchMetadata(result: FetchPageResult): WebsiteResearchPage {
  return {
    url: result.url,
    path: result.path,
    status: result.status,
    title: result.title,
    metaDescription: result.metaDescription,
    textSnippet: result.textSnippet,
    error: result.error,
  };
}

function isRedirectStatus(status: number) {
  return [301, 302, 303, 307, 308].includes(status);
}

function isHtmlResponse(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  return (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml+xml")
  );
}

function determineStatus({
  pages,
  signals,
  errors,
}: {
  pages: WebsiteResearchPage[];
  signals: WebsiteSignals;
  errors: string[];
}): WebsiteResearchStatus {
  const successfulPages = pages.filter(
    (page) => page.status !== null && page.status >= 200 && page.status < 300
  );

  if (successfulPages.length === 0) {
    return errors.some((error) => error.toLowerCase().includes("timed out"))
      ? "timeout"
      : "offline";
  }

  const hasUsefulText = successfulPages.some(
    (page) => (page.textSnippet?.length ?? 0) > 80
  );

  if (signals.parkedSignals.length > 0) {
    return "parked";
  }

  if (!hasUsefulText) {
    return "empty";
  }

  return "reachable";
}

function buildClassificationHints(
  signals: WebsiteSignals,
  status: WebsiteResearchStatus
): WebsiteClassificationHints {
  const productSignalScore = getProductSignalScore(signals);
  const serviceSignalScore = getServiceSignalScore(signals);
  const hasStrongProductSignal =
    hasAnyKeyword(signals.productSignals, [
      "platform",
      "software platform",
      "product",
      "product suite",
      "dashboard",
      "workflow",
      "automation",
      "workflow automation",
      "integration",
      "integrations",
      "SaaS",
      "subscription",
      "cloud software",
      "web app",
      "platform as a service",
      "PaaS",
      "developer platform",
      "infrastructure platform",
      "deployment platform",
      "application platform",
      "build on our platform",
      "cloud platform",
    ]) || getStrongProductSignalScore(signals) >= 2;
  const likelySaas =
    hasAnyKeyword(signals.productSignals, [
      "SaaS",
      "software platform",
      "subscription",
      "cloud software",
      "web app",
      "platform",
      "product suite",
    ]) ||
    (signals.hasPricingSignal && hasStrongProductSignal);
  const likelyAi =
    hasAnyKeyword(signals.aiSignals, [
      "AI",
      "AI platform",
      "AI automation",
      "AI model",
      "artificial intelligence",
      "artificial intelligence platform",
      "machine learning",
      "machine learning platform",
      "machine learning model",
      "ML",
      "model training",
      "LLM",
      "large language model",
      "computer vision",
      "natural language processing",
      "NLP",
      "generative AI",
      "predictive analytics",
      "recommendation engine",
    ]);
  const likelyDataSolution = hasAnyKeyword(signals.dataSignals, [
    "data platform",
    "analytics platform",
    "analytics",
    "data pipeline",
    "data warehouse",
    "warehouse",
    "ETL",
    "ELT",
    "data integration",
    "customer data platform",
    "CDP",
    "reporting dashboard",
    "data engineering",
    "BI",
    "business intelligence",
  ]);
  const likelyCloud = hasAnyKeyword(signals.cloudSignals, [
    "cloud",
    "cloud infrastructure",
    "cloud migration",
    "cloud native",
    "managed cloud",
    "infrastructure",
    "infrastructure automation",
    "migration",
    "DevOps",
    "Kubernetes",
    "AWS",
    "Azure",
    "Google Cloud",
    "GCP",
    "cloud security",
  ]);
  const likelyCyberSecurity = hasAnyKeyword(signals.securitySignals, [
    "security",
    "cybersecurity",
    "cyber security",
    "compliance",
    "SOC 2",
    "ISO 27001",
    "threat",
    "threat detection",
    "vulnerability",
    "penetration testing",
    "SIEM",
    "endpoint security",
    "identity security",
    "access management",
  ]);
  const likelyServiceLed = isServiceLed(
    signals,
    serviceSignalScore,
    productSignalScore
  );
  const likelyProductLed =
    hasStrongProductSignal ||
    signals.hasApiSignal ||
    signals.hasPricingSignal ||
    likelySaas;

  return {
    likelyProductLed,
    likelyServiceLed,
    likelySaas,
    likelyCloud,
    likelyAi,
    likelyDataSolution,
    likelyCyberSecurity,
    likelyNotRelevant:
      status !== "reachable" ||
      signals.parkedSignals.length > 0 ||
      (likelyServiceLed && !likelyProductLed),
  };
}

function determineQuality({
  status,
  pages,
  signals,
  classificationHints,
}: {
  status: WebsiteResearchStatus;
  pages: WebsiteResearchPage[];
  signals: WebsiteSignals;
  classificationHints: WebsiteClassificationHints;
}): WebsiteResearchQuality {
  if (
    ["blocked", "offline", "timeout", "invalid_url", "error"].includes(status)
  ) {
    return "unknown";
  }

  if (status === "parked" || status === "empty") {
    return "weak";
  }

  const successfulPages = pages.filter(
    (page) =>
      page.status !== null &&
      page.status >= 200 &&
      page.status < 300 &&
      page.error === null
  );
  const usefulPageCount = successfulPages.filter(
    (page) => (page.textSnippet?.length ?? 0) > 120
  ).length;
  const failedPageCount = pages.length - successfulPages.length;
  const positiveCategoryCount = [
    signals.hasProductSignal,
    signals.hasPricingSignal,
    signals.hasApiSignal,
    signals.hasAiSignal,
    signals.hasCloudSignal,
    signals.hasDataSignal,
    signals.hasSecuritySignal,
  ].filter(Boolean).length;
  const serviceDominated =
    getServiceSignalScore(signals) >= 2 &&
    getServiceSignalScore(signals) >= getProductSignalScore(signals);
  const mostlyFailed = failedPageCount > successfulPages.length;

  if (
    classificationHints.likelyProductLed &&
    !serviceDominated &&
    usefulPageCount >= 2 &&
    positiveCategoryCount >= 3
  ) {
    return "strong";
  }

  if (
    classificationHints.likelyProductLed &&
    !serviceDominated &&
    !mostlyFailed &&
    usefulPageCount >= 1 &&
    positiveCategoryCount >= 1
  ) {
    return "medium";
  }

  return "weak";
}

function getProductSignalScore(signals: WebsiteSignals) {
  return (
    signals.productSignals.length +
    signals.pricingSignals.length +
    signals.apiSignals.length
  );
}

function getStrongProductSignalScore(signals: WebsiteSignals) {
  return (
    signals.productSignals.filter(
      (item) => item.keyword.toLowerCase() !== "software"
    ).length +
    signals.pricingSignals.length +
    signals.apiSignals.length
  );
}

function getServiceSignalScore(signals: WebsiteSignals) {
  return signals.serviceSignals.length;
}

function isServiceLed(
  signals: WebsiteSignals,
  serviceSignalScore: number,
  productSignalScore: number
) {
  const hasStrongServiceSignal = hasAnyKeyword(signals.serviceSignals, [
    "IT outsourcing",
    "consulting",
    "agency",
    "outsourcing",
    "staffing",
    "staff augmentation",
    "custom software development",
    "software development services",
    "managed services",
    "IT services",
    "recruitment",
    "offshore development",
    "dedicated developers",
    "AI consulting",
    "AI development services",
    "machine learning consulting",
    "custom AI solutions",
    "AI implementation services",
    "AI agency",
    "AI outsourcing",
  ]);

  return (
    hasStrongServiceSignal &&
    serviceSignalScore >= 1 &&
    serviceSignalScore >= productSignalScore
  );
}

function hasAnyKeyword(
  evidence: Array<{ keyword: string }>,
  keywords: string[]
) {
  const normalizedKeywords = new Set(
    keywords.map((keyword) => keyword.toLowerCase())
  );

  return evidence.some((item) =>
    normalizedKeywords.has(item.keyword.toLowerCase())
  );
}

function buildSummary({
  status,
  quality,
  signals,
  pages,
}: {
  status: WebsiteResearchStatus;
  quality: string;
  signals: WebsiteSignals;
  pages: WebsiteResearchPage[];
}) {
  const checkedCount = pages.length;

  if (status === "parked") {
    return `Website appears parked after checking ${checkedCount} pages.`;
  }

  if (status !== "reachable") {
    return `Website research ended with status ${status}.`;
  }

  const categories = [
    signals.hasAiSignal ? "AI" : null,
    signals.hasCloudSignal ? "cloud" : null,
    signals.hasDataSignal ? "data" : null,
    signals.hasSecuritySignal ? "security" : null,
    signals.hasServiceSignal ? "services" : null,
  ].filter(Boolean);

  return `Website is reachable with ${quality} signal quality${
    categories.length > 0 ? ` across ${categories.join(", ")}` : ""
  }.`;
}

function buildEmptyResult({
  inputUrl,
  status,
  summary,
  errors,
  researchedAt,
  normalizedUrl = null,
  normalizedDomain = null,
}: {
  inputUrl: string;
  status: WebsiteResearchStatus;
  summary: string;
  errors: string[];
  researchedAt: string;
  normalizedUrl?: string | null;
  normalizedDomain?: string | null;
}): WebsiteResearchResult {
  const signals = extractWebsiteSignals([]);

  return {
    inputUrl,
    normalizedUrl,
    normalizedDomain,
    finalUrl: null,
    reachable: false,
    status,
    httpStatus: null,
    redirectChain: [],
    pagesChecked: [],
    signals,
    quality: "unknown",
    classificationHints: buildEmptyClassificationHints(),
    summary,
    errors,
    researchedAt,
  };
}

function buildEmptyClassificationHints({
  likelyNotRelevant = true,
}: {
  likelyNotRelevant?: boolean;
} = {}): WebsiteClassificationHints {
  return {
    ...EMPTY_CLASSIFICATION_HINTS,
    likelyNotRelevant,
  };
}
