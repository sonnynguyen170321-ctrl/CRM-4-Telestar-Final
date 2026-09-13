import { describe, expect, it } from "vitest";

import { cleanSerpFragment, looksLikePersonName, looksLikeListicleResult, parseCompanyHits, parseContactHits, type RawSearchHit } from "../parseDiscoveryResults";
import { scoreCandidateHeuristic } from "../scoreCandidates";
import { extractLinkedInPeopleFromText, isTargetTitle } from "../peopleDiscovery";
import { humanize } from "../insightMapper";

// Research used to harvest any linkedin.com/in/* SERP hit as a "person": when the
// "Name - Role - Company" pattern didn't match it fell back to the whole page title, so listicles,
// job feeds, LinkedIn's signup page and hashtag pages all became contacts — and a listicle whose
// title happened to contain the ICP hints outranked the real person.

const hit = (title: string, slug: string, snippet = "x"): RawSearchHit => ({
  title,
  url: `https://www.linkedin.com/in/${slug}`,
  snippet,
  provider: "exa",
});

const MIXED_HITS: RawSearchHit[] = [
  hit("Anna Tran - VP Sales - Acme Corp | LinkedIn", "anna-tran", "VP Sales at Acme"),
  hit("Top 10 Trade Marketing Managers in Vietnam | LinkedIn", "listicle", "list"),
  hit("(20+) Sales Director jobs in Ho Chi Minh City | LinkedIn", "jobs", "jobs"),
  hit("Sign Up | LinkedIn", "signup", "join"),
  hit("#salesjobs - hashtag on LinkedIn", "hashtag", "posts"),
  hit("Minh Nguyen - Sales Director - Vinamilk | 500+ connections | LinkedIn", "minh", "Trade marketing FMCG Vietnam"),
];

describe("junk candidate rejection", () => {
  it("keeps only real people out of a mixed SERP page", () => {
    const parsed = parseContactHits("q", MIXED_HITS);
    expect(parsed.map((c) => c.name)).toEqual(["Anna Tran", "Minh Nguyen"]);
  });

  it("rejects non-profile slugs and page-title shapes", () => {
    expect(parseContactHits("q", [hit("Sign Up | LinkedIn", "signup")])).toEqual([]);
    expect(parseContactHits("q", [hit("Jobs | LinkedIn", "jobs")])).toEqual([]);
    expect(parseContactHits("q", [hit("#sales - hashtag on LinkedIn", "hashtag")])).toEqual([]);
    // a profile slug whose title is a listicle is still rejected by the name shape
    expect(parseContactHits("q", [hit("Top 10 Sales Leaders | LinkedIn", "real-slug")])).toEqual([]);
  });

  it("looksLikePersonName accepts real names (incl. Vietnamese) and rejects page titles", () => {
    for (const ok of ["Anna Tran", "Nguyễn Văn Minh", "Trần Thị Hương", "Lê Đức Anh"]) {
      expect(looksLikePersonName(ok)).toBe(true);
    }
    for (const bad of ["Top 10 Trade Marketing Managers in Vietnam", "#salesjobs", "Sign Up", "(20+) Sales Director jobs", "Anna"]) {
      expect(looksLikePersonName(bad)).toBe(false);
    }
  });

  it("a real on-target person outranks everything else", () => {
    const hints = ["trade marketing", "fmcg", "vietnam"];
    const parsed = parseContactHits("q", MIXED_HITS);
    const scored = parsed.map((c) => ({ name: c.name, fit: scoreCandidateHeuristic(c, hints).score }));
    const best = scored.reduce((a, b) => (b.fit > a.fit ? b : a));
    expect(best.name).toBe("Minh Nguyen");
  });

  it("hint matching is word-boundary, not substring", () => {
    const [c] = parseContactHits("q", [hit("Anna Tran - VP Sales - Acme Corp | LinkedIn", "a", "digital chrome")]);
    // "it" and "hr" must not fire inside "digital"/"chrome"
    expect(scoreCandidateHeuristic(c, ["it", "hr"]).reason).toContain("No ICP terms");
  });
});

describe("company harvest — reject listicles, name from the real segment", () => {
  const cHit = (title: string, url: string): RawSearchHit => ({ title, url, snippet: null, provider: "exa" });

  it("looksLikeListicleResult flags roundups/comparisons, not real companies", () => {
    for (const t of ["Top 10 SaaS companies", "10 Best CRM Software (2024)", "Salesforce vs HubSpot", "Notion alternatives", "7 Leading Fintech Startups"]) {
      expect(looksLikeListicleResult(t)).toBe(true);
    }
    for (const t of ["Rippling — HR & IT SaaS platform", "Pricing | Acme", "Best Buy Co.", "Guideline — 401(k)"]) {
      expect(looksLikeListicleResult(t)).toBe(false);
    }
  });

  it("drops listicle + content-site results, keeps real companies", () => {
    const out = parseCompanyHits("q", [
      cHit("Rippling — HR & IT SaaS platform", "https://rippling.com/"),
      cHit("Top 10 SaaS companies in the US", "https://blog.example.com/top-10"),
      cHit("BuiltIn — best SaaS startups", "https://builtin.com/saas"),
    ]);
    expect(out.map((c) => c.domain)).toEqual(["rippling.com"]);
  });

  it("uses the domain-matching segment as the name, not the tagline", () => {
    const [c] = parseCompanyHits("q", [cHit("Payments infrastructure for platforms | Stripe", "https://stripe.com/")]);
    expect(c.name).toBe("Stripe");
  });
});

describe("Vietnamese support", () => {
  it("extracts Vietnamese names from LinkedIn snippets", () => {
    for (const text of [
      "Nguyễn Văn Minh - Sales Director at Vinamilk",
      "Trần Thị Hương - Trade Marketing Manager at Masan",
      "Lê Đức Anh - IT Director at Acecook",
    ]) {
      expect(extractLinkedInPeopleFromText(text, "Co", null).length).toBeGreaterThan(0);
    }
  });

  it("accepts Vietnamese decision-maker titles and rejects VN junior ones", () => {
    for (const ok of ["Giám đốc kinh doanh", "Tổng giám đốc", "Trưởng phòng", "Sales Director"]) {
      expect(isTargetTitle(ok)).toBe(true);
    }
    for (const bad of ["Thực tập sinh", "Trợ lý giám đốc", "intern"]) {
      expect(isTargetTitle(bad)).toBe(false);
    }
  });
});

describe("company-page people extraction — person validation + noise cleaning", () => {
  it("keeps a real person and cleans SERP noise from the company", () => {
    const out = extractLinkedInPeopleFromText(
      "Sarah Lee - VP Sales at Rippling | 500+ connections | LinkedIn",
      "Fallback Co",
      "https://www.linkedin.com/in/sarah-lee",
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Sarah Lee");
    expect(out[0].companyName).toBe("Rippling"); // "| 500+ connections | LinkedIn" stripped
  });

  it("rejects a non-person phrase even with a target-title tail", () => {
    // "Our Team" matched the old [A-Z][a-z]+ shape + isTargetTitle('Sales') → a fake person.
    expect(extractLinkedInPeopleFromText("Our Team - Sales at Acme", "Acme", null)).toHaveLength(0);
  });
});

describe("wording normalization", () => {
  it("strips LinkedIn SERP boilerplate from role/company", () => {
    expect(cleanSerpFragment("Vinamilk | 500+ connections")).toBe("Vinamilk");
    expect(cleanSerpFragment("Sales Director · 3rd+")).toBe("Sales Director");
    expect(cleanSerpFragment("Masan | 1,234 followers")).toBe("Masan");
    expect(cleanSerpFragment("VP Sales")).toBe("VP Sales");
  });

  it("humanizes fact tokens into readable business language", () => {
    expect(humanize("size.employee_count_51_200")).toBe("51–200 employees");
    expect(humanize("geo.hq_country_vietnam")).toBe("Vietnam");
    expect(humanize("geo.market_south_korea")).toBe("South Korea");
    expect(humanize("offering.saas")).toBe("SaaS");
    expect(humanize("industry.food_beverage")).toBe("Food & Beverage");
    expect(humanize("news.recent")).toBe("Recent news");
    expect(humanize("risk.service_product_ambiguity")).toBe("Risk: service/product ambiguity");
  });
});
