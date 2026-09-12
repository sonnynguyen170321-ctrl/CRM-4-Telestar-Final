import { describe, expect, it } from "vitest";

import { extractEmails } from "../contactExtract";
import { cleanSerpFragment, parseContactHits, type RawSearchHit } from "../parseDiscoveryResults";

// SERP titles, snippets and page HTML are provider- or site-controlled. Generous budget so the
// suite is not flaky on CI; a polynomial regex on 100k characters takes seconds to minutes.
const BUDGET_MS = 500;
const N = 100_000;

function timed<T>(fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  return { result, ms: performance.now() - start };
}

const hit = (title: string, url = "https://www.linkedin.com/in/anna-tran"): RawSearchHit => ({
  title,
  url,
  snippet: null,
  provider: "test",
});

describe("LinkedIn title parsing stays linear", () => {
  it("a title that is one long run of spaces", () => {
    const { ms } = timed(() => parseContactHits("q", [hit(" ".repeat(N))]));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("a title that is many separators with no segments", () => {
    const { ms } = timed(() => parseContactHits("q", [hit("- ".repeat(N / 2))]));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("a role with a long run of spaces before 'at'", () => {
    const { ms } = timed(() => parseContactHits("q", [hit(`Anna Tran - VP${" ".repeat(N)}at Acme`)]));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("still parses the shapes it parsed before", () => {
    const [a, b] = parseContactHits("q", [
      hit("Anna Tran - VP Sales - Acme Corp | LinkedIn"),
      hit("Minh Le – Head of Growth at Beta Ltd | LinkedIn", "https://vn.linkedin.com/in/minh-le"),
    ]);
    expect(a).toMatchObject({ name: "Anna Tran", title: "VP Sales", companyName: "Acme Corp" });
    expect(b).toMatchObject({ name: "Minh Le", title: "Head of Growth", companyName: "Beta Ltd" });
  });
});

describe("LinkedIn host check is exact-or-subdomain", () => {
  it("rejects a look-alike host that merely ends with linkedin.com", () => {
    const out = parseContactHits("q", [
      hit("Anna Tran - VP Sales - Acme | LinkedIn", "https://evillinkedin.com/in/anna-tran"),
      hit("Anna Tran - VP Sales - Acme | LinkedIn", "https://notlinkedin.com/in/anna-tran"),
    ]);
    expect(out).toEqual([]);
  });

  it("accepts the apex host and real subdomains", () => {
    const out = parseContactHits("q", [
      hit("Anna Tran - VP Sales - Acme | LinkedIn", "https://linkedin.com/in/a-1"),
      hit("Bao Pham - CTO - Beta | LinkedIn", "https://vn.linkedin.com/in/b-2"),
    ]);
    expect(out.map((c) => c.name)).toEqual(["Anna Tran", "Bao Pham"]);
  });
});

describe("cleanSerpFragment stays linear and keeps its cleaning", () => {
  it("long runs of separators and spaces", () => {
    const { ms } = timed(() => cleanSerpFragment(`${"· ".repeat(N / 2)}Vinamilk${" ".repeat(N)}`));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("still strips degree markers, counts and the LinkedIn suffix", () => {
    expect(cleanSerpFragment("Vinamilk · 3rd+ | 500+ connections | LinkedIn")).toBe("Vinamilk");
    expect(cleanSerpFragment("  — Acme Corp —  ")).toBe("Acme Corp");
  });
});

describe("email extraction stays linear on dotted junk", () => {
  it("a long run of dots after an @ never resolves and does not backtrack", () => {
    const html = `contact: a@${".".repeat(N)}`;
    const { result, ms } = timed(() => extractEmails(html, "acme.com"));
    expect(result).toEqual([]);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("a long run of trailing punctuation", () => {
    const html = `sales@acme.com${".".repeat(N)}`;
    const { result, ms } = timed(() => extractEmails(html, "acme.com"));
    expect(result).toEqual(["sales@acme.com"]);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("still finds real addresses, company domain first", () => {
    const html = 'Write to <a href="mailto:hello@acme.com">us</a> or partner@other.io.';
    expect(extractEmails(html, "https://www.acme.com/about")).toEqual(["hello@acme.com", "partner@other.io"]);
  });
});
