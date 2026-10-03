import { describe, expect, it } from "vitest";

import { buildQueriesFromBuilderParams, normalizeResearchBuilderParams, personaTitlesOf } from "../buildDiscoveryQueries";
import { buildFitPrompt } from "../fitPrompt";
import type { ParsedCandidate } from "../parseDiscoveryResults";
import { OFF_PERSONA_SCORE_CAP, scoreCandidateHeuristic } from "../scoreCandidates";

// The owner's report, verbatim: "Matched 3 ICP signals: lead, saas, united kingdom -> đang trả sai
// leads (rất nhiều lead sai title, họ chỉ match keyword thôi)". A contact search found the right
// companies and the wrong people, and the score could not tell, because a persona title counted the
// same as a country and could match anywhere — a name, a company, a page snippet.

function contact(overrides: Partial<ParsedCandidate> = {}): ParsedCandidate {
  return {
    kind: "CONTACT",
    name: "Sam Taylor",
    domain: null,
    linkedinUrl: "https://www.linkedin.com/in/sam-taylor",
    title: "Lead Developer",
    companyName: "Acme SaaS",
    location: "London, United Kingdom",
    source: {
      query: 'site:linkedin.com/in "Lead" "saas" united kingdom',
      url: "https://www.linkedin.com/in/sam-taylor",
      snippet: "Lead Developer at Acme SaaS, a B2B SaaS company in the United Kingdom",
      provider: "exa",
    },
    dedupeFingerprint: "contact:sam-taylor",
    ...overrides,
  };
}

const HINTS = ["CEO", "saas", "united kingdom"];
const PERSONAS = ["CEO", "CTO", "Founder", "VP Sales"];

describe("contacts are judged on their job title", () => {
  it("caps an off-persona title however well the company fits, and says why", () => {
    const fit = scoreCandidateHeuristic(contact(), HINTS, { personaTitles: PERSONAS });

    expect(fit.score).toBeLessThanOrEqual(OFF_PERSONA_SCORE_CAP);
    expect(fit.reason).toContain('Title "Lead Developer" is outside the searched personas');
  });

  it("ranks a matching title well above it", () => {
    const onPersona = scoreCandidateHeuristic(contact({ title: "CEO & Co-Founder" }), HINTS, { personaTitles: PERSONAS });
    const offPersona = scoreCandidateHeuristic(contact(), HINTS, { personaTitles: PERSONAS });

    expect(onPersona.score).toBeGreaterThanOrEqual(60);
    expect(onPersona.score - offPersona.score).toBeGreaterThanOrEqual(30);
    expect(onPersona.reason).toMatch(/^Title matches persona "(CEO|Founder)"/);
    expect(onPersona.reason).toMatch(/saas/);
  });

  it("accepts any persona the run searched for, not only the query's own", () => {
    // Surfaced by the "CEO" query, but the run also searched for CTOs.
    const fit = scoreCandidateHeuristic(contact({ title: "CTO" }), HINTS, { personaTitles: PERSONAS });
    expect(fit.reason).toMatch(/Title matches persona "CTO"/);
  });

  it("does not credit a persona word found in the company name or the snippet", () => {
    const fit = scoreCandidateHeuristic(
      contact({
        title: "Software Engineer",
        companyName: "CEO Insights Ltd",
        source: { ...contact().source, snippet: "Reports to the CEO and the Founder" },
      }),
      HINTS,
      { personaTitles: PERSONAS }
    );
    expect(fit.score).toBeLessThanOrEqual(OFF_PERSONA_SCORE_CAP);
  });

  it("treats a missing title as unknown, not wrong — scored between, and flagged", () => {
    const missing = scoreCandidateHeuristic(contact({ title: null }), HINTS, { personaTitles: PERSONAS });
    const wrong = scoreCandidateHeuristic(contact(), HINTS, { personaTitles: PERSONAS });
    const right = scoreCandidateHeuristic(contact({ title: "CEO" }), HINTS, { personaTitles: PERSONAS });

    expect(missing.score).toBeGreaterThan(wrong.score);
    expect(missing.score).toBeLessThan(right.score);
    expect(missing.reason).toMatch(/No job title found/);
  });

  it("uses the profile text when the page title carried only a name — labelled as unconfirmed", () => {
    // Exa titles a LinkedIn profile with the person's name alone; the highlight carries the role.
    const mentioned = scoreCandidateHeuristic(
      contact({ title: null, source: { ...contact().source, snippet: "CTO at Acme SaaS · London, United Kingdom" } }),
      HINTS,
      { personaTitles: PERSONAS }
    );
    const silent = scoreCandidateHeuristic(contact({ title: null, source: { ...contact().source, snippet: "Works at Acme SaaS" } }), HINTS, {
      personaTitles: PERSONAS,
    });
    const confirmed = scoreCandidateHeuristic(contact({ title: "CTO" }), HINTS, { personaTitles: PERSONAS });

    expect(mentioned.reason).toMatch(/Profile text mentions "CTO" — title not confirmed/);
    expect(mentioned.score).toBeGreaterThan(silent.score);
    expect(mentioned.score).toBeLessThan(confirmed.score);
  });

  it("leaves company scoring and persona-less runs exactly as they were", () => {
    const legacy = scoreCandidateHeuristic(contact(), ["lead", "saas", "united kingdom"]);
    expect(legacy.reason).toMatch(/Matched 3 ICP signals/);
  });
});

describe("the query planner", () => {
  it("no longer searches for a bare \"Lead\" when the seniority is manager", () => {
    const params = normalizeResearchBuilderParams({ seniority: ["manager"], industries: ["saas"], geos: ["United Kingdom"] });
    const queries = buildQueriesFromBuilderParams("CONTACT", params!);

    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some((q) => /"Lead"/.test(q.query))).toBe(false);
    expect(personaTitlesOf(queries)).toEqual(["Manager"]);
  });

  it("records which persona each contact query searched for, and collects them once", () => {
    const params = normalizeResearchBuilderParams({ titles: ["CEO", "CTO", "ceo"], industries: ["saas"] });
    const queries = buildQueriesFromBuilderParams("CONTACT", params!);

    expect(queries.every((q) => typeof q.titleHint === "string")).toBe(true);
    expect(personaTitlesOf(queries)).toEqual(["CEO", "CTO"]);
  });

  it("gives company queries no persona", () => {
    const params = normalizeResearchBuilderParams({ industries: ["saas"], geos: ["Denmark"] });
    const queries = buildQueriesFromBuilderParams("COMPANY", params!);
    expect(personaTitlesOf(queries)).toEqual([]);
  });
});

describe("the AI fit prompt", () => {
  it("states the persona rule for contact runs", () => {
    const prompt = buildFitPrompt("CONTACT", HINTS, [{ name: "Sam", title: "Lead Developer", companyName: "Acme", domain: null, snippet: null }], PERSONAS);
    expect(prompt).toMatch(/Target job titles: CEO, CTO, Founder, VP Sales/);
    expect(prompt).toMatch(/scores below 40/);
  });

  it("omits it when there are no personas", () => {
    const prompt = buildFitPrompt("COMPANY", HINTS, [{ name: "Acme", title: null, companyName: null, domain: "acme.io", snippet: null }]);
    expect(prompt).not.toMatch(/Target job titles/);
  });
});
