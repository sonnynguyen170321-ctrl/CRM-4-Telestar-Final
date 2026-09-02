import type { Prisma } from "@/app/generated/prisma/client";
import { toPrismaJsonValue } from "@/lib/server/api/json";

type PersistableWebsiteResearchResult = {
  inputUrl: string;
  normalizedUrl?: string | null;
  normalizedDomain?: string | null;
  finalUrl?: string | null;
  reachable: boolean;
  status: string;
  httpStatus?: number | null;
  quality: string;
  summary: string;
  signals: unknown;
  classificationHints: unknown;
  pagesChecked: unknown[];
  errors: string[];
  redirectChain: string[];
  researchedAt: string;
};

export function mapWebsiteResearchResultToCreateData({
  companyRecordId,
  uploadJobId,
  result,
}: {
  companyRecordId?: string;
  uploadJobId?: string;
  result: PersistableWebsiteResearchResult;
}): Prisma.WebsiteResearchResultCreateInput {
  return {
    companyRecord: companyRecordId
      ? { connect: { id: companyRecordId } }
      : undefined,
    uploadJob: uploadJobId ? { connect: { id: uploadJobId } } : undefined,
    inputUrl: result.inputUrl,
    normalizedUrl: result.normalizedUrl,
    normalizedDomain: result.normalizedDomain,
    finalUrl: result.finalUrl,
    reachable: result.reachable,
    status: result.status,
    httpStatus: result.httpStatus,
    quality: result.quality,
    summary: result.summary,
    signalsJson: toPrismaJsonValue(result.signals),
    classificationHintsJson: toPrismaJsonValue(result.classificationHints),
    pagesCheckedJson: toPrismaJsonValue(result.pagesChecked),
    errorsJson: toPrismaJsonValue(result.errors),
    redirectChainJson: toPrismaJsonValue(result.redirectChain),
    researchedAt: parseResearchDate(result.researchedAt),
  };
}

function parseResearchDate(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }

  return parsed;
}
