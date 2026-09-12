import { describe, expect, it } from "vitest";

import { extractNeutralFacts, uniqueFactTokens, type FetchedPage } from "../extractFacts";
import { extractVisibleText, parseRobotsDisallowRules } from "../fetchWebsite";

// Every input here is the crawled site's own bytes. The budget is generous so the suite is
// not flaky on a loaded CI runner, but a polynomial regex on 100k characters takes seconds
// to minutes, so any regression is still caught by an order of magnitude.
const BUDGET_MS = 500;
const N = 100_000;

function timed<T>(fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  return { result, ms: performance.now() - start };
}

describe("extractVisibleText stays linear and filters tags completely", () => {
  it("does not rescan the document for every unclosed <script", () => {
    const html = "<script".repeat(N / 7);
    const { ms } = timed(() => extractVisibleText(html));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("does not rescan for every unclosed comment opener", () => {
    const html = "<!--".repeat(N / 4);
    const { ms } = timed(() => extractVisibleText(html));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("strips script bodies whose close tag has whitespace or mixed case", () => {
    const html = 'a <SCRIPT type="x">alert(1)</script > b <script>evil()</ScRiPt\n> c';
    expect(extractVisibleText(html)).toBe("a b c");
  });

  it("does not treat <scripts> or <scripted> as a script element", () => {
    expect(extractVisibleText("<scripts>kept</scripts>")).toBe("kept");
  });

  it("leaves no tag token behind on nested or malformed markup", () => {
    expect(extractVisibleText("x <b<i>>y <div")).not.toMatch(/<[^>]*>/);
    expect(extractVisibleText("x <b<i>>y")).toBe("x >y");
  });

  it("is linear on a document full of `<` with no `>`", () => {
    const { ms } = timed(() => extractVisibleText("<a".repeat(N / 2)));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("decodes entities exactly once", () => {
    // `&amp;lt;` is the literal text "&lt;" — sequential replaces turned it into "<".
    expect(extractVisibleText("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
    expect(extractVisibleText("a&nbsp;&amp;&lt;&gt;&quot;&#39;&apos;")).toBe("a &<>\"''");
  });
});

describe("parseRobotsDisallowRules stays linear", () => {
  it("handles a line stuffed with comment markers", () => {
    const robots = `User-agent: *\nDisallow: /private ${"#".repeat(N)}\n`;
    const { result, ms } = timed(() => parseRobotsDisallowRules(robots, "TeleStarBot"));
    expect(result).toEqual(["/private"]);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe("fact extraction regexes stay linear on hostile page text", () => {
  const page = (text: string): FetchedPage => ({ url: "https://acme.example", path: "/", text });

  it("long runs of whitespace around a headcount", () => {
    const text = `team of${" ".repeat(N)}`;
    const { ms } = timed(() => extractNeutralFacts([page(text)]));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("long runs of whitespace after a number", () => {
    const text = `500${" ".repeat(N)}`;
    const { ms } = timed(() => extractNeutralFacts([page(text)]));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("long runs of whitespace after 'revenue'", () => {
    const text = `revenue${" ".repeat(N)}`;
    const { ms } = timed(() => extractNeutralFacts([page(text)]));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("still reads the headcount and revenue phrasings it read before", () => {
    const tokens = uniqueFactTokens(
      extractNeutralFacts([
        page("Acme employs 1,200 people across 3 offices. Annual revenue of US$ 45 million in 2025."),
      ])
    );
    expect(tokens).toContain("size.employee_count_1200");
    expect(tokens.some((t) => t.startsWith("revenue.usd_"))).toBe(true);
  });
});
