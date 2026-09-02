import { describe, expect, it } from "vitest";

import { extractNeutralFacts, uniqueFactTokens, type FetchedPage } from "../extractFacts";

const QUALIFICATION_LIKE_KEYS = [
  "qualification",
  "fitScore",
  "confidenceScore",
  "status",
  "verdict",
];

describe("extractNeutralFacts", () => {
  it("extracts offering, business model, and industry tokens with evidence pointers", () => {
    const pages: FetchedPage[] = [
      {
        url: "https://example.com/",
        path: "/",
        text:
          "We provide a SaaS cybersecurity platform for banking and telecom clients. " +
          "Our B2B offering helps enterprises with network protection and threat detection.",
      },
    ];

    const evidence = extractNeutralFacts(pages);
    const tokens = uniqueFactTokens(evidence);

    expect(tokens).toContain("offering.saas");
    expect(tokens).toContain("offering.cybersecurity");
    expect(tokens).toContain("business_model.b2b");
    expect(tokens).toContain("industry.banking");
    expect(tokens).toContain("industry.telecom");

    for (const item of evidence) {
      expect(item).toHaveProperty("token");
      expect(item).toHaveProperty("evidenceText");
      expect(item).toHaveProperty("sourceUrl");
      expect(item.sourceUrl).toBe("https://example.com/");
    }
  });

  it("extracts ERP and manufacturing industry tokens", () => {
    const pages: FetchedPage[] = [
      {
        url: "https://erp-vendor.example/",
        path: "/",
        text: "Our ERP software is built for manufacturing companies running factory operations.",
      },
    ];

    const tokens = uniqueFactTokens(extractNeutralFacts(pages));

    expect(tokens).toContain("offering.erp");
    expect(tokens).toContain("industry.manufacturing");
  });

  it("does NOT emit hiring from footer/nav boilerplate", () => {
    const pages: FetchedPage[] = [
      {
        url: "https://example.com/",
        path: "/",
        text:
          "We build a SaaS platform for enterprises. Join our team and explore career opportunities. " +
          "Contact us | Careers | Privacy Policy",
      },
    ];
    const tokens = uniqueFactTokens(extractNeutralFacts(pages));
    expect(tokens).not.toContain("maturity.hiring");
  });

  it("does NOT emit hiring from a careers page with no real role evidence", () => {
    const pages: FetchedPage[] = [
      { url: "https://example.com/careers", path: "/careers", text: "Careers at Acme. We love what we do." },
    ];
    expect(uniqueFactTokens(extractNeutralFacts(pages))).not.toContain("maturity.hiring");
  });

  it("emits hiring when there is real role evidence, with a sentence for evidence", () => {
    const pages: FetchedPage[] = [
      {
        url: "https://example.com/careers",
        path: "/careers",
        text: "We are hiring across engineering and sales. We have 12 open positions — apply now to join us.",
      },
    ];
    const evidence = extractNeutralFacts(pages);
    const hiring = evidence.find((e) => e.token === "maturity.hiring");
    expect(hiring).toBeDefined();
    // Evidence is a real sentence, not the bare keyword.
    expect((hiring?.evidenceText.length ?? 0)).toBeGreaterThan(15);
  });

  it("extracts geo.hq_country tokens from headquarters context", () => {
    const pages: FetchedPage[] = [
      {
        url: "https://example.com/about",
        path: "/about",
        text: "Our company is headquartered in Singapore with a regional team across APAC.",
      },
    ];

    const tokens = uniqueFactTokens(extractNeutralFacts(pages));

    expect(tokens).toContain("geo.hq_country_singapore");
  });

  it("extracts geo.factory_country tokens from factory context", () => {
    const pages: FetchedPage[] = [
      {
        url: "https://example.com/about",
        path: "/about",
        text: "Our manufacturing plant is located in Vietnam, supporting our regional customers.",
      },
    ];

    const tokens = uniqueFactTokens(extractNeutralFacts(pages));

    expect(tokens).toContain("geo.factory_country_vietnam");
  });

  it("extracts geo.market tokens from market presence context", () => {
    const pages: FetchedPage[] = [
      {
        url: "https://example.com/about",
        path: "/about",
        text: "We have offices in Singapore and serve customers in Vietnam and Thailand.",
      },
    ];

    const tokens = uniqueFactTokens(extractNeutralFacts(pages));

    expect(tokens.some((token) => token.startsWith("geo.market_"))).toBe(true);
  });

  it("extracts maturity tokens from path and content signals", () => {
    const pages: FetchedPage[] = [
      { url: "https://example.com/pricing", path: "/pricing", text: "See our pricing plans below." },
      { url: "https://example.com/careers", path: "/careers", text: "We're hiring engineers in 2026." },
      { url: "https://example.com/news", path: "/news", text: "Company announces new product launch." },
      {
        url: "https://example.com/case-studies",
        path: "/case-studies",
        text: "Read our customer success stories and case studies.",
      },
    ];

    const tokens = uniqueFactTokens(extractNeutralFacts(pages));

    expect(tokens).toContain("maturity.has_pricing_page");
    expect(tokens).toContain("maturity.hiring");
    expect(tokens).toContain("news.recent");
    expect(tokens).toContain("maturity.has_case_studies");
    expect(tokens).toContain("proof.case_study");
  });

  it("extracts growth tokens for funding and expansion language", () => {
    const pages: FetchedPage[] = [
      {
        url: "https://example.com/news",
        path: "/news",
        text: "We raised $20M in our Series B round and are expanding into new markets with a new office.",
      },
    ];

    const tokens = uniqueFactTokens(extractNeutralFacts(pages));

    expect(tokens).toContain("growth.funding");
    expect(tokens).toContain("growth.expansion");
  });

  it("extracts a risk token when product and service language coexist", () => {
    const pages: FetchedPage[] = [
      {
        url: "https://example.com/",
        path: "/",
        text: "Our platform is delivered alongside managed consulting services for every customer.",
      },
    ];

    const tokens = uniqueFactTokens(extractNeutralFacts(pages));

    expect(tokens).toContain("risk.service_product_ambiguity");
  });

  it("emits nothing for unknown/empty content", () => {
    const pages: FetchedPage[] = [{ url: "https://example.com/", path: "/", text: "" }];

    expect(extractNeutralFacts(pages)).toEqual([]);
  });

  it("never emits qualification, fitScore, confidenceScore, status, or verdict fields", () => {
    const pages: FetchedPage[] = [
      {
        url: "https://example.com/",
        path: "/",
        text:
          "SaaS cybersecurity ERP cloud infrastructure consulting B2B B2C marketplace banking " +
          "manufacturing retail telecom headquartered in Singapore factory is located in Vietnam " +
          "pricing plans we're hiring case studies raised $5M expanding into new markets trusted by leading brands",
      },
    ];

    const evidence = extractNeutralFacts(pages);

    for (const item of evidence) {
      for (const forbiddenKey of QUALIFICATION_LIKE_KEYS) {
        expect(item).not.toHaveProperty(forbiddenKey);
      }
    }
  });

  it("deduplicates repeated token/sourceUrl pairs", () => {
    const pages: FetchedPage[] = [
      { url: "https://example.com/", path: "/", text: "SaaS SaaS SaaS platform for everyone." },
    ];

    const evidence = extractNeutralFacts(pages);
    const saasMatches = evidence.filter((item) => item.token === "offering.saas");

    expect(saasMatches).toHaveLength(1);
  });
});
