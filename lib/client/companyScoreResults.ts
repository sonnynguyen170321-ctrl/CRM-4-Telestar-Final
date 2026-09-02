import type { CompanyScoreResult } from "@/lib/types";

export type ScoredCompanySourceRow = {
  sourceRowIndex: number;
  result: CompanyScoreResult;
};

type CreateCompanyScoreResultInput = {
  companyRecordId: string;
  result: CompanyScoreResult;
};

type CreateCompanyScoreResultResponse = {
  data: {
    id: string;
  };
};

export async function createCompanyScoreResultsForRecords({
  scoredRows,
  companyRecordIdsByRowIndex,
}: {
  scoredRows: ScoredCompanySourceRow[];
  companyRecordIdsByRowIndex: Record<number, string>;
}) {
  const scoreResults = await Promise.all(
    scoredRows.map(({ result, sourceRowIndex }) => {
      const companyRecordId = companyRecordIdsByRowIndex[sourceRowIndex];

      if (!companyRecordId) {
        throw new Error("Missing company record id for score result.");
      }

      return createCompanyScoreResult({ companyRecordId, result }).then(
        (scoreResult) => ({
          ...scoreResult,
          sourceRowIndex,
        })
      );
    })
  );

  return {
    count: scoreResults.length,
    idsBySourceRowIndex: Object.fromEntries(
      scoreResults.map((scoreResult) => [
        scoreResult.sourceRowIndex,
        scoreResult.id,
      ])
    ) as Record<number, string>,
  };
}

async function createCompanyScoreResult({
  companyRecordId,
  result,
}: CreateCompanyScoreResultInput) {
  const response = await fetch("/api/company-score-results", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyRecordId,
      companyType: result.type,
      companyScore: result.company_score,
      qualification: result.qualification,
      confidence: result.confidence,
      reason: result.reason,
      oneSentenceCompanySummary: result.one_sentence_company_summary,
      hardRuleFlags: result.hard_rule_flags,
      reviewState: "unreviewed",
      scoringSource: "rules",
      scoringVersion: "local-hard-rules-v1",
    }),
  });

  if (!response.ok) {
    throw new Error("Score result save failed.");
  }

  const body = (await response.json()) as CreateCompanyScoreResultResponse;

  if (!body.data?.id) {
    throw new Error("Score result response did not include an id.");
  }

  return body.data;
}
