import crypto from "node:crypto";

import type { Prisma } from "@/app/generated/prisma/client";

import { getAiQueueConfig } from "@/lib/server/ai/config";
import { buildCompanyDuplicateKey } from "@/lib/normalization/dedupeCompanyRows";

export type CompanyRecordForCompactAiInput = Prisma.CompanyRecordGetPayload<{
  include: {
    scoreResults: {
      orderBy: { createdAt: "desc" };
      take: 1;
    };
    websiteResearchResults: {
      orderBy: { createdAt: "desc" };
      take: 1;
    };
  };
}>;

export function buildCompactCompanyAiInput(
  companyRecord: CompanyRecordForCompactAiInput,
  latestScore: CompanyRecordForCompactAiInput["scoreResults"][number],
  latestWebsiteResearch:
    | CompanyRecordForCompactAiInput["websiteResearchResults"][number]
    | null
) {
  const queueConfig = getAiQueueConfig();
  const input = {
    company: {
      companyName: clean(companyRecord.companyName, 160),
      website: clean(companyRecord.website, 160),
      country: clean(companyRecord.companyCountry, 100),
      industry: clean(companyRecord.companyIndustry, 120),
      staffCountRange: clean(companyRecord.companyStaffCountRange, 80),
      companyLinkedInUrl: clean(companyRecord.companyLinkedInUrl, 180),
    },
    localRuleBaseline: {
      localScoreResultId: latestScore.id,
      qualification: latestScore.qualification.toLowerCase(),
      companyType: latestScore.companyType,
      score: latestScore.companyScore,
      confidence: Number(latestScore.confidence),
      reason: clean(latestScore.reason, queueConfig.maxReasonChars),
      summary: clean(latestScore.oneSentenceCompanySummary, 220),
      hardRuleFlags: latestScore.hardRuleFlags,
    },
    websiteEvidence: compactWebsiteEvidence(
      latestWebsiteResearch,
      queueConfig.maxWebsiteSignalChars
    ),
  };

  return trimSerializedInput(input, queueConfig.maxInputChars);
}

export function buildAiIdentityKey(
  companyRecord: Pick<
    CompanyRecordForCompactAiInput,
    "website" | "companyLinkedInUrl" | "companyName" | "companyCountry" | "id"
  >
) {
  const duplicateKey = buildCompanyDuplicateKey({
    website: companyRecord.website,
    companyLinkedInUrl: companyRecord.companyLinkedInUrl,
    companyName: companyRecord.companyName,
    companyCountry: companyRecord.companyCountry,
    fallbackKey: `record:${companyRecord.id}`,
  });

  return `${duplicateKey.type}:${duplicateKey.value}`;
}

export function buildInputFingerprint(input: unknown) {
  return hashStableJson(input);
}

export function buildAiCacheKey({
  identityKey,
  provider,
  model,
  promptVersion,
  inputFingerprint,
}: {
  identityKey: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputFingerprint: string;
}) {
  return hashStableJson({
    identityKey,
    provider,
    model,
    promptVersion,
    inputFingerprint,
  });
}

function compactWebsiteEvidence(
  latestWebsiteResearch:
    | CompanyRecordForCompactAiInput["websiteResearchResults"][number]
    | null,
  maxChars: number
) {
  if (!latestWebsiteResearch) {
    return {
      available: false,
      reason: "No website research result is linked to this company row.",
    };
  }

  return {
    available: true,
    reachable: latestWebsiteResearch.reachable,
    status: clean(latestWebsiteResearch.status, 80),
    quality: clean(latestWebsiteResearch.quality, 80),
    normalizedDomain: clean(latestWebsiteResearch.normalizedDomain, 140),
    finalUrl: clean(latestWebsiteResearch.finalUrl, 220),
    httpStatus: latestWebsiteResearch.httpStatus,
    summary: clean(latestWebsiteResearch.summary, 450),
    signalFlags: extractSignalFlags(latestWebsiteResearch.signalsJson),
    evidenceSnippets: extractEvidenceSnippets(
      latestWebsiteResearch.signalsJson,
      maxChars
    ),
    classificationHints: latestWebsiteResearch.classificationHintsJson,
    errors: summarizeErrors(latestWebsiteResearch.errorsJson),
  };
}

function extractSignalFlags(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  return {
    hasProductSignal: value.hasProductSignal === true,
    hasServiceSignal: value.hasServiceSignal === true,
    hasPricingSignal: value.hasPricingSignal === true,
    hasApiSignal: value.hasApiSignal === true,
    hasAiSignal: value.hasAiSignal === true,
    hasCloudSignal: value.hasCloudSignal === true,
    hasDataSignal: value.hasDataSignal === true,
    hasSecuritySignal: value.hasSecuritySignal === true,
  };
}

function extractEvidenceSnippets(value: unknown, maxChars: number) {
  if (!isRecord(value)) {
    return [];
  }

  const groups = [
    "productSignals",
    "apiSignals",
    "aiSignals",
    "cloudSignals",
    "dataSignals",
    "securitySignals",
    "serviceSignals",
  ];
  const snippets: Array<{ category: string; keyword: string; snippet: string }> =
    [];
  let usedChars = 0;

  for (const group of groups) {
    const items = value[group];

    if (!Array.isArray(items)) {
      continue;
    }

    for (const item of items) {
      if (!isRecord(item) || typeof item.snippet !== "string") {
        continue;
      }

      const snippet = clean(item.snippet, 180);

      if (!snippet || usedChars + snippet.length > maxChars) {
        continue;
      }

      usedChars += snippet.length;
      snippets.push({
        category: typeof item.category === "string" ? item.category : group,
        keyword: typeof item.keyword === "string" ? item.keyword : "signal",
        snippet,
      });

      if (snippets.length >= 8) {
        return snippets;
      }
    }
  }

  return snippets;
}

function summarizeErrors(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, 3)
    .map((item) => clean(item, 160));
}

function trimSerializedInput<T>(input: T, maxChars: number): T {
  const serialized = JSON.stringify(input);

  if (serialized.length <= maxChars) {
    return input;
  }

  if (!isRecord(input)) {
    return input;
  }

  return {
    ...input,
    websiteEvidence: {
      ...(isRecord(input.websiteEvidence) ? input.websiteEvidence : {}),
      evidenceSnippets: [],
      trimmedForTokenBudget: true,
    },
  } as T;
}

function clean(value: string | null | undefined, maxLength: number) {
  const trimmed = value?.replace(/\s+/g, " ").trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.length > maxLength
    ? `${trimmed.slice(0, Math.max(maxLength - 1, 0))}…`
    : trimmed;
}

function hashStableJson(value: unknown) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(sortForHash(value)))
    .digest("hex");
}

function sortForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForHash);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, childValue]) => [key, sortForHash(childValue)])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
