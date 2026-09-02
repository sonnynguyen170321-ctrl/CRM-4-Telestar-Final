import { describe, expect, it } from "vitest";

import { buildParaphrasePrompt, distill, parseParaphrase } from "../paraphrasePrompt";

describe("distill", () => {
  it("strips bio filler + boilerplate and caps to a clean phrase", () => {
    const out = distill("Experienced Business Development Specialist with a demonstrated history of working in the telecommunications industry. Skilled in Sales, Pricing Strategy.", 120);
    expect(out).toBeTruthy();
    expect(out).not.toMatch(/experienced|demonstrated history/i);
    expect((out ?? "").length).toBeLessThanOrEqual(121);
  });

  it("keeps the first sentence when the text is long", () => {
    const out = distill("Acme builds payments infrastructure for platforms. It also does a lot of other unrelated things across many paragraphs.");
    expect(out).toBe("Acme builds payments infrastructure for platforms.");
  });

  it("returns null for empty/too-short input", () => {
    expect(distill("")).toBeNull();
    expect(distill(null)).toBeNull();
  });
});

describe("paraphrase prompt/parse", () => {
  it("builds a purpose-specific prompt with the source text", () => {
    const p = buildParaphrasePrompt("role_summary", "VP of Sales at Acme leading the EMEA team");
    expect(p).toMatch(/ONE sentence/i);
    expect(p).toContain("VP of Sales at Acme");
  });

  it("parses the model reply into one clean sentence, stripping quotes/fences", () => {
    expect(parseParaphrase("```\n\"Leads EMEA sales at Acme.\"\n```")).toBe("Leads EMEA sales at Acme.");
    expect(parseParaphrase("")).toBeNull();
  });
});
