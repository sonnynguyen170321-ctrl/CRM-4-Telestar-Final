import { describe, it, expect } from "vitest";
import { prisma } from "../../../server/prisma";

describe("debug ingestion errors", () => {
  it("shows error distribution", async () => {
    const jobs = await prisma.v2IngestionJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { id: true, status: true, originalFileName: true },
    });
    console.log("Latest job:", jobs[0]);
    const jid = jobs[0]?.id;
    expect(jid).toBeTruthy();

    const errors: Array<{ errorMessage: string | null; cnt: number }> =
      await prisma.$queryRawUnsafe(
        `SELECT "errorMessage", COUNT(*)::int as cnt FROM "V2IngestionRow" WHERE "jobId" = $1 AND "rowStatus" = 'ERROR' GROUP BY "errorMessage" ORDER BY cnt DESC LIMIT 10`,
        jid
      );
    console.log("ERROR DISTRIBUTION:");
    for (const e of errors) {
      console.log(`  [${e.cnt}x] ${e.errorMessage}`);
    }

    const samples: Array<{
      sourceRowNumber: number;
      errorMessage: string | null;
      np: string | null;
    }> = await prisma.$queryRawUnsafe(
      `SELECT "sourceRowNumber", "errorMessage", substring("normalizedRowJson"::text, 1, 500) as "np" FROM "V2IngestionRow" WHERE "jobId" = $1 AND "rowStatus" = 'ERROR' ORDER BY "sourceRowNumber" LIMIT 3`,
      jid
    );
    console.log("SAMPLE ERRORS:");
    for (const s of samples) {
      console.log(`  Row #${s.sourceRowNumber}: ${s.errorMessage}`);
      console.log(`    normalized: ${s.np}`);
    }

    const statusDist: Array<{ rowStatus: string; cnt: number }> =
      await prisma.$queryRawUnsafe(
        `SELECT "rowStatus", COUNT(*)::int as cnt FROM "V2IngestionRow" WHERE "jobId" = $1 GROUP BY "rowStatus" ORDER BY cnt DESC`,
        jid
      );
    console.log("STATUS DISTRIBUTION:");
    for (const s of statusDist) {
      console.log(`  ${s.rowStatus}: ${s.cnt}`);
    }

    await prisma.$disconnect();
  });
});