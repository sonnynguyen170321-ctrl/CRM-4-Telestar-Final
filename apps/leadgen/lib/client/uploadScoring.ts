import { researchAndSaveWebsiteForCompanyRecord } from "@/lib/client/websiteResearch";
import type { ParsedCsvRow } from "@/lib/csv";
import { scoreCompanyRow } from "@/lib/scoring";
import type { CompanyScoreResult, WebsiteResearchResult } from "@/lib/types";

export type WebsiteResearchSummary = {
  attempted: number;
  saved: number;
  failed: number;
  skipped: number;
  processed: number;
  errors: string[];
};

export type ScoredUploadRow = {
  sourceRowIndex: number;
  result: CompanyScoreResult;
};

export async function scoreRowsWithPersistedWebsiteResearch({
  rows,
  uploadJobId,
  companyRecordIdsByRowIndex,
  canPersistWebsiteResearch,
  persistedSourceRowIndexes,
  onProgress,
}: {
  rows: ParsedCsvRow[];
  uploadJobId: string | null;
  companyRecordIdsByRowIndex: Record<number, string>;
  canPersistWebsiteResearch: boolean;
  persistedSourceRowIndexes?: number[];
  onProgress: (summary: WebsiteResearchSummary) => void;
}) {
  const researchByRowIndex: Record<number, WebsiteResearchResult | null> = {};
  const rowsForScoring =
    persistedSourceRowIndexes && persistedSourceRowIndexes.length > 0
      ? persistedSourceRowIndexes.map((sourceRowIndex) => ({
          row: rows[sourceRowIndex],
          sourceRowIndex,
        }))
      : rows.map((row, sourceRowIndex) => ({ row, sourceRowIndex }));
  const researchSummary = buildInitialWebsiteResearchSummary(
    rowsForScoring.map(({ row }) => row)
  );

  if (canPersistWebsiteResearch && researchSummary.attempted > 0) {
    await mapWithConcurrency(rowsForScoring, 3, async ({ row, sourceRowIndex }) => {
      const website = getCell(row, "Website");
      const companyRecordId = companyRecordIdsByRowIndex[sourceRowIndex];

      if (!website || !companyRecordId) {
        researchByRowIndex[sourceRowIndex] = null;
        researchSummary.skipped += 1;
        onProgress({ ...researchSummary });
        return;
      }

      try {
        researchByRowIndex[sourceRowIndex] =
          await researchAndSaveWebsiteForCompanyRecord({
            companyRecordId,
            uploadJobId,
            website,
          });
        researchSummary.saved += 1;
      } catch (error) {
        researchByRowIndex[sourceRowIndex] = null;
        researchSummary.failed += 1;
        researchSummary.errors.push(
          `${getCell(row, "Company Name") || website}: ${
            error instanceof Error ? error.message : "Website research failed."
          }`
        );
      } finally {
        researchSummary.processed += 1;
        onProgress({ ...researchSummary, errors: [...researchSummary.errors] });
      }
    });
  } else {
    researchSummary.skipped = rowsForScoring.length;
    researchSummary.processed = rowsForScoring.length;
    onProgress({ ...researchSummary });
  }

  const scoredRows = rowsForScoring.map(({ row, sourceRowIndex }) => ({
    sourceRowIndex,
    result: scoreCompanyRow(row, sourceRowIndex, {
      websiteResearch: researchByRowIndex[sourceRowIndex] ?? null,
    }),
  }));

  return {
    scoredRows,
    researchSummary,
  };
}

export function buildInitialWebsiteResearchSummary(
  rows: ParsedCsvRow[]
): WebsiteResearchSummary {
  const attempted = rows.filter((row) => getCell(row, "Website")).length;

  return {
    attempted,
    saved: 0,
    failed: 0,
    skipped: 0,
    processed: 0,
    errors: [],
  };
}

export function getCompletedWebsiteResearchStatus(
  summary: WebsiteResearchSummary
) {
  if (summary.attempted === 0) {
    return "skipped";
  }

  if (summary.saved > 0 && summary.failed > 0) {
    return "partial";
  }

  if (summary.failed > 0) {
    return "failed";
  }

  if (summary.saved === 0) {
    return "skipped";
  }

  return "saved";
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await worker(items[currentIndex], currentIndex);
      }
    })
  );
}

function getCell(row: ParsedCsvRow, key: string) {
  return row[key]?.trim() ?? "";
}
