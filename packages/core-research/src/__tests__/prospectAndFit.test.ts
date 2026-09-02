import { describe, expect, it } from "vitest";

import type { ParsedCandidate } from "../parseDiscoveryResults";
import { scoreCandidateHeuristic } from "../scoreCandidates";
import { wasSeenInPriorRun } from "../prospectDedupe";
import { buildFitPrompt, parseFitResponse } from "../fitPrompt";
import { bestEmailGuess, guessEmailPatterns } from "../findContactEmail";
import { isLivenessEnabled } from "../verifyCandidates";

function company(overrides: Partial<ParsedCandidate> = {}): ParsedCandidate {
  return {
    kind: "COMPANY",
    name: "Acme Payments",
    domain: "acme.io",
    linkedinUrl: null,
    title: null,
    companyName: null,
    location: null,
    source: { query: "q", url: "https://acme.io", snippet: "Acme is a fintech payments platform in Vietnam", provider: "brave" },
    dedupeFingerprint: "company:acme.io",
    ...overrides,
  };
}

describe("scoreCandidateHeuristic", () => {
  it("scores higher when more ICP hint tokens surface in the evidence", () => {
    const strong = scoreCandidateHeuristic(company(), ["fintech", "payments", "Vietnam"]);
    const weak = scoreCandidateHeuristic(company(), ["logistics", "warehouse"]);
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.reason).toMatch(/Matched \d ICP signal/);
  });

  it("ignores generic query modifiers so they never inflate the score", () => {
    // "companies"/"providers" are query scaffolding, not ICP signal — must not count.
    const onlyModifiers = scoreCandidateHeuristic(company({ source: { query: "q", url: "u", snippet: "list of companies and providers", provider: null } }), ["companies", "providers"]);
    const realSignal = scoreCandidateHeuristic(company(), ["fintech"]);
    expect(realSignal.score).toBeGreaterThan(onlyModifiers.score);
  });

  it("clamps to 0-100 and flags weak candidates for verification", () => {
    const noSignal = scoreCandidateHeuristic(company({ domain: null, source: { query: "q", url: "u", snippet: null, provider: null } }), ["fintech"]);
    expect(noSignal.score).toBeGreaterThanOrEqual(0);
    expect(noSignal.score).toBeLessThanOrEqual(100);
    expect(noSignal.reason).toMatch(/verify before promoting|no ICP hint/i);
  });
});

describe("wasSeenInPriorRun", () => {
  const base = { dedupeFingerprint: "company:acme.io", firstSeenAt: new Date(), lastSeenAt: new Date(), timesSeen: 1 };

  it("is false when no ledger entry exists (brand-new prospect)", () => {
    expect(wasSeenInPriorRun(undefined, "run-1")).toBe(false);
  });

  it("is false for the same run's earlier batch (not a cross-run duplicate)", () => {
    expect(wasSeenInPriorRun({ ...base, lastRunId: "run-1" }, "run-1")).toBe(false);
  });

  it("is true when a different prior run already saw the prospect", () => {
    expect(wasSeenInPriorRun({ ...base, lastRunId: "run-0" }, "run-1")).toBe(true);
  });
});

describe("AI fit parsing", () => {
  it("builds a compact prompt carrying target signals + candidate evidence", () => {
    const prompt = buildFitPrompt("COMPANY", ["fintech", "Vietnam"], [
      { name: "Acme", title: null, companyName: null, domain: "acme.io", snippet: "payments platform" },
    ]);
    expect(prompt).toContain("fintech, Vietnam");
    expect(prompt).toContain("acme.io");
    expect(prompt).toMatch(/JSON array/i);
  });

  it("parses a JSON array (tolerating code fences) into clamped per-index fit", () => {
    const text = "```json\n[{\"i\":0,\"score\":150,\"reason\":\"strong\",\"location\":\"Hanoi\"},{\"i\":1,\"score\":-5,\"reason\":\"off\"}]\n```";
    const map = parseFitResponse(text, 2);
    expect(map.get(0)).toEqual({ fitScore: 100, fitReason: "strong", location: "Hanoi" });
    expect(map.get(1)).toEqual({ fitScore: 0, fitReason: "off", location: null });
  });

  it("drops out-of-range indexes and malformed entries", () => {
    const map = parseFitResponse('[{"i":9,"score":50},{"i":0,"score":"x"},{"i":0,"score":70,"reason":"ok"}]', 2);
    expect(map.has(9)).toBe(false);
    expect(map.get(0)).toEqual({ fitScore: 70, fitReason: "ok", location: null });
  });

  it("returns an empty map when there is no JSON array", () => {
    expect(parseFitResponse("sorry, I cannot help with that", 3).size).toBe(0);
  });
});

describe("email guesser", () => {
  it("produces common corporate patterns, most-likely first", () => {
    const patterns = guessEmailPatterns("Anna Tran", "acme.io");
    expect(patterns[0]).toBe("anna.tran@acme.io");
    expect(patterns).toContain("atran@acme.io");
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it("folds Vietnamese diacritics to ASCII and uses Vietnamese name order", () => {
    // "Nguyễn Đức" is Surname Given, so the address is built from the GIVEN name: duc.nguyen@.
    // This previously asserted nguyen.duc@ — Western order applied to a Vietnamese name.
    const guess = bestEmailGuess("Nguyễn Đức", "vng.com.vn");
    expect(guess).toEqual({ email: "duc.nguyen@vng.com.vn", status: "GUESSED" });
  });

  it("ranks Vietnamese surname-initial patterns, which are common locally", () => {
    // Real examples from an uploaded VN list: thuy.tran@, duy_p@, nguyent@, kduy@, hle@.
    const patterns = guessEmailPatterns("Trần Thị Thuy", "bibica.com.vn");
    expect(patterns[0]).toBe("thuy.tran@bibica.com.vn");
    expect(patterns).toContain("thuyt@bibica.com.vn"); // given + surname initial
    expect(patterns).toContain("trant@bibica.com.vn"); // surname + given initial
  });

  it("keeps Western order for non-Vietnamese names", () => {
    expect(guessEmailPatterns("Anna Tran", "acme.io")[0]).toBe("anna.tran@acme.io");
    expect(guessEmailPatterns("John Smith", "acme.io")[0]).toBe("john.smith@acme.io");
  });

  it("returns nothing without a usable name or domain", () => {
    expect(guessEmailPatterns("", "acme.io")).toEqual([]);
    expect(bestEmailGuess("Anna Tran", "not-a-domain")).toBeNull();
  });
});

describe("insight mapper", () => {
  it("humanizes controlled fact tokens into business insight", async () => {
    const { mapProfileToInsight } = await import("../insightMapper");
    const insight = mapProfileToInsight({
      companySummary: "Acme builds payment infrastructure.",
      factsJson: ["size.employee_count_51_200", "geo.hq_country_vietnam", "geo.market_singapore", "news.recent_funding", "risk.litigation"],
      classificationJson: {
        offerings: ["offering.payment_gateway", "offering.checkout"],
        industries: ["industry.fintech"],
        geographies: ["geo.hq_country_vietnam"],
      },
      evidenceItemsJson: [{ url: "https://acme.io", title: "Acme" }, { sourceUrl: "https://acme.io/about" }],
    });
    // These previously asserted the raw de-underscored output ("51 200", "vietnam", "fintech").
    // That is what the SDR reads, so tokens are now formatted, not just de-snake-cased.
    expect(insight.summary).toBe("Acme builds payment infrastructure.");
    expect(insight.whatTheySell).toEqual(["Payment Gateway", "Checkout"]);
    expect(insight.industry).toEqual(["Fintech"]);
    expect(insight.size).toBe("51–200 employees");
    expect(insight.hq).toBe("Vietnam");
    expect(insight.geoMarkets).toEqual(["Singapore"]);
    expect(insight.signals.length).toBeGreaterThan(0);
    expect(insight.citations).toHaveLength(2);
  });
});

describe("liveness gate flag", () => {
  it("is on by default and only off when explicitly disabled", () => {
    const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
    expect(isLivenessEnabled(env({}))).toBe(true);
    expect(isLivenessEnabled(env({ RESEARCH_LIVENESS_CHECK: "1" }))).toBe(true);
    expect(isLivenessEnabled(env({ RESEARCH_LIVENESS_CHECK: "0" }))).toBe(false);
  });
});
