import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileCompanyIntelligence } from "../compile";
import type { EvidenceRef } from "../contract";
import { CATEGORY_SECTOR } from "../taxonomy";
import {
  CLASSIFICATION_GOLDEN,
  CLASSIFICATION_FIXTURE_DIR,
  type GoldenCase,
} from "../../__fixtures__/classificationGolden";

// Measures classification accuracy against a labelled set of real companies, replayed from captured
// page + search snapshots (`scripts/capture-classification-fixtures.mjs`). No network.
//
// Why the floors below are where they are: this exists because the classifier was changed twice with
// no way to tell whether accuracy moved. The point is not to pass today — it is that any later change
// to the taxonomy, the corpus construction, or the keyword lists moves a number somebody can read.
//
// MEASURED, on the 98-company golden set:
//   before this work   category 20%   (75 of 99 got no category at all)
//   after              category 64%   sector 95%
//
// Three defects accounted for almost all of the gap, and only the last one was in the taxonomy:
//   - the classifier read a 400-character citation blurb per page instead of the page (8.7% of the
//     crawled text on Jabil), so a stricter matcher simply starved;
//   - captured search evidence dropped the `highlight` field, which is where every provider puts the
//     body text, reducing a five-result search to ~100 characters;
//   - categories competed flat, so a property developer could win at hr_recruiting.
//
// Known error classes the set was built to catch:
//   1. "serves industry X" read as "is industry X"  — advocadoapp / grabjobs / syrve / supy / zonal
//   2. missing category, so the company lands somewhere unrelated — capitaland / frasersproperty /
//      airliquide / jabil / swisse
//   3. the generic b2b_saas bucket swallowing a specific one — snyk / ionix / hibob / sumsub
//   4. no category at all — unilever / shopee

const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../__fixtures__",
  CLASSIFICATION_FIXTURE_DIR
);

type Fixture = {
  domain: string;
  name: string;
  status: string;
  pages: Array<{
    url: string;
    pageType: string;
    title: string | null;
    metaDescription: string | null;
    h1: string | null;
    h2s: string[];
    mainText: string;
  }>;
  searchResults: Array<{
    url: string | null;
    title: string | null;
    snippet: string | null;
    highlight: string | null;
    provider: string | null;
  }>;
};

function loadFixture(domain: string): Fixture | null {
  const path = join(fixtureDir, `${domain}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

/** Fixtures captured before search snapshotting was added have no `searchResults` key. */
function searchResultsOf(fixture: Fixture): Fixture["searchResults"] {
  return fixture.searchResults ?? [];
}

/** Rebuilds the SEARCH evidence shape `runCompanyResearch.toSearchEvidence` produces. */
function toSearchEvidence(result: Fixture["searchResults"][number]): EvidenceRef {
  const parts = [result.title, result.snippet, result.highlight]
    .map((part) => (part ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const part of parts) {
    if (kept.some((k) => k.toLowerCase().includes(part.toLowerCase()))) continue;
    kept.push(part);
  }
  return {
    url: result.url ?? "",
    text: kept.join(" — ").slice(0, 400),
    pageType: "SEARCH",
    provider: (result.provider ?? undefined) as EvidenceRef["provider"],
  };
}

async function classify(fixture: Fixture): Promise<string | null> {
  const compiled = await compileCompanyIntelligence({
    companyName: fixture.name,
    canonicalDomain: fixture.domain,
    country: null,
    industryRaw: null,
    pages: fixture.pages.map((page) => ({
      url: page.url,
      pageType: page.pageType,
      title: page.title,
      metaDescription: page.metaDescription,
      headings: [page.h1, ...page.h2s].filter((value): value is string => Boolean(value)),
      mainText: page.mainText || null,
    })),
    searchResults: searchResultsOf(fixture).map(toSearchEvidence),
  });
  const token = compiled.controlledTokens.find((fact) => fact.startsWith("category."));
  return token ? token.slice("category.".length) : null;
}

type Outcome = {
  case: GoldenCase;
  actual: string | null;
  correct: boolean;
  /** No page text and no search snippet — unclassifiable by any taxonomy, so not a classifier miss. */
  noEvidence: boolean;
};

describe("company classification accuracy", () => {
  const captured = existsSync(fixtureDir)
    ? readdirSync(fixtureDir).filter((f) => f.endsWith(".json")).length
    : 0;

  it("has fixtures captured for the golden set", () => {
    expect(
      captured,
      `No fixtures in ${fixtureDir}. Run: node --env-file=.env scripts/capture-classification-fixtures.mjs`
    ).toBeGreaterThan(0);
  });

  it("classifies the golden set", async () => {
    const outcomes: Outcome[] = [];

    for (const goldenCase of CLASSIFICATION_GOLDEN) {
      const fixture = loadFixture(goldenCase.domain);
      if (!fixture) continue;

      const hasEvidence =
        fixture.pages.some((page) => page.mainText.trim().length > 0) || searchResultsOf(fixture).length > 0;
      const actual = await classify(fixture);

      outcomes.push({
        case: goldenCase,
        actual,
        correct: actual === goldenCase.category,
        noEvidence: !hasEvidence,
      });
    }

    expect(outcomes.length, "no golden case had a fixture — capture them first").toBeGreaterThan(0);

    // Companies with no evidence at all are reported separately rather than counted as misses:
    // nothing in this repo can classify a site that is offline AND absent from search.
    const scored = outcomes.filter((o) => !o.noEvidence);
    const correct = scored.filter((o) => o.correct);
    const wrong = scored.filter((o) => !o.correct && o.actual !== null);
    const unclassified = scored.filter((o) => o.actual === null);
    const accuracy = scored.length > 0 ? correct.length / scored.length : 0;

    // Sector is the coarser, more important number: a wrong category inside the right sector is a
    // near miss a human can live with, while a property developer filed under HR software is not.
    const sectorJudged = scored.filter((o) => o.actual !== null);
    const sectorCorrect = sectorJudged.filter((o) => CATEGORY_SECTOR[o.actual as string] === o.case.sector);
    const sectorAccuracy = sectorJudged.length > 0 ? sectorCorrect.length / sectorJudged.length : 0;

    console.log("\n──────── CLASSIFICATION ACCURACY ────────");
    console.log(`golden cases with fixtures: ${outcomes.length}`);
    console.log(`no evidence (excluded):     ${outcomes.length - scored.length}`);
    console.log(`scored:                     ${scored.length}`);
    console.log(`correct category:           ${correct.length}  (${Math.round(accuracy * 100)}%)`);
    console.log(`wrong category:             ${wrong.length}`);
    console.log(`no category assigned:       ${unclassified.length}`);
    console.log(`correct sector:             ${sectorCorrect.length}/${sectorJudged.length}  (${Math.round(sectorAccuracy * 100)}%)`);

    if (wrong.length > 0) {
      console.log("\n──────── WRONG ────────");
      console.table(
        wrong.map((o) => ({
          domain: o.case.domain,
          expected: o.case.category,
          actual: o.actual,
          why: o.case.why.slice(0, 60),
        }))
      );
    }

    if (unclassified.length > 0) {
      console.log("\n──────── NO CATEGORY ────────");
      console.table(unclassified.map((o) => ({ domain: o.case.domain, expected: o.case.category })));
    }

    // Floors, not targets. Raise them as the work lands; never lower one to make a change pass.
    expect(sectorAccuracy).toBeGreaterThanOrEqual(SECTOR_ACCURACY_FLOOR);
    expect(accuracy).toBeGreaterThanOrEqual(CATEGORY_ACCURACY_FLOOR);
  }, 120_000);
});

/**
 * Current agreed floor for category accuracy over the golden set.
 *
 * Deliberately set from the measured baseline rather than from an aspiration: a floor above what the
 * code does today would fail on arrival and get commented out, which is how accuracy gates die.
 */
const CATEGORY_ACCURACY_FLOOR = 0.6;

/** Sector is the coarse verdict; it should be right far more often than the exact category. */
const SECTOR_ACCURACY_FLOOR = 0.9;
