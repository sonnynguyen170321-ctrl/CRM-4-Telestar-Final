import { describe, expect, it } from "vitest";

import { runCompanyResearch } from "../../runCompanyResearch";
import type { FetchImpl } from "../../fetchWebsite";
import { CATEGORY_TAXONOMY, matchTaxonomy } from "../taxonomy";

// Regression for the F&B / retail / manufacturing misclassification: real-economy companies were
// being labelled AI/SaaS/CRM because (a) the taxonomy had no non-tech categories and (b) matchTaxonomy
// used unbounded substring matching over junk keywords ("ml"→"330ml", "api"→"capital", "agents"→
// "distribution agents"). These cases run the REAL rules pipeline (crawl parse → reasoning → taxonomy)
// over canned pages, with no network (mock fetch) and no search.

const TECH_CATEGORY_IDS = new Set([
  "ecommerce_saas", "customer_intel", "crm_martech", "data_analytics", "ai_automation",
  "cybersecurity", "hr_recruiting", "fintech", "education", "healthtech", "b2b_saas", "devtools",
  "fintech_payments", "fintech_lending", "legaltech", "proptech", "hardware_iot", "marketplace",
  "msp", "hospitality_travel",
]);

function page(opts: { title?: string; meta: string; h1: string; body: string }): string {
  return `<html><head><title>${opts.title ?? "Company"}</title><meta name="description" content="${opts.meta}"></head>` +
    `<body><h1>${opts.h1}</h1><main><p>${opts.body}</p></main></body></html>`;
}

function mockFetch(body: string): FetchImpl {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url).pathname;
    const resolved = path === "/" ? { status: 200, body } : { status: 404, body: "" };
    return { status: resolved.status, url, text: async () => resolved.body } as unknown as Response;
  }) as unknown as FetchImpl;
}

const FILLER =
  " We serve customers nationwide and partner with distributors and agents across every province. " +
  "Our teams focus on quality, reliability and long-term growth for the markets we operate in. ".repeat(4);

async function classify(domain: string, html: string, industryRaw?: string): Promise<string | null> {
  const result = await runCompanyResearch({
    companyName: domain,
    canonicalDomainInput: `https://${domain}`,
    websiteUrl: `https://${domain}`,
    industryRaw,
    disableSearch: true,
    fetchOptions: { fetchImpl: mockFetch(html), rateLimitIntervalMs: 0 },
  });
  const token = result.profile.factsJson.find((f) => f.startsWith("category."));
  return token ? token.slice("category.".length) : null;
}

type Case = { name: string; domain: string; meta: string; h1: string; body: string; expect: string | null };

const CASES: Case[] = [
  {
    name: "Heineken (beer) → food_beverage", domain: "heineken.example.com",
    meta: "Heineken Vietnam brewery — beer and beverage brand.",
    h1: "Beer and beverage brewery",
    body: "Refreshing beer available in cans and bottles." + FILLER, expect: "food_beverage",
  },
  {
    name: "Vinamilk (dairy) → food_beverage", domain: "vinamilk.example.com",
    meta: "Vinamilk dairy company — milk, yogurt and nutrition products.",
    h1: "Dairy, milk and nutrition products",
    body: "Vietnam's leading dairy brand." + FILLER, expect: "food_beverage",
  },
  {
    name: "Acecook (instant noodles) → food_beverage", domain: "acecook.example.com",
    meta: "Acecook Vietnam — instant noodle maker and packaged food.",
    h1: "Instant noodle and food processing",
    body: "A leading noodle producer." + FILLER, expect: "food_beverage",
  },
  {
    name: "Orion (confectionery) → food_beverage", domain: "orion.example.com",
    meta: "Orion — confectionery and snack brand with biscuit lines.",
    h1: "Confectionery, biscuit and snack",
    body: "Choco pie and biscuits loved nationwide." + FILLER, expect: "food_beverage",
  },
  {
    name: "Trung Nguyen (coffee) → food_beverage", domain: "trungnguyen.example.com",
    meta: "Trung Nguyen Legend — coffee brand, roasted coffee and instant coffee.",
    h1: "Roasted coffee and instant coffee",
    body: "A Vietnamese coffee producer." + FILLER, expect: "food_beverage",
  },
  {
    name: "Bich Chi (rice noodles, LinkedIn=Machinery) → food_beverage", domain: "bichchi.example.com",
    meta: "Bich Chi Food — rice noodle and instant noodle, food processing.",
    h1: "Rice noodle and food processing",
    body: "Rice vermicelli and porridge." + FILLER, expect: "food_beverage",
  },
  {
    name: "LOF (dairy, LinkedIn=Machinery) → food_beverage", domain: "lof.example.com",
    meta: "LOF International Dairy — dairy and milk products.",
    h1: "Dairy and milk products",
    body: "Dairy nutrition for families." + FILLER, expect: "food_beverage",
  },
  {
    name: "Phuc Sinh (coffee/pepper export) → agriculture_commodities", domain: "phucsinh.example.com",
    meta: "Phuc Sinh — coffee beans and cashew exporter, agribusiness.",
    h1: "Agribusiness: coffee beans, cashew, commodity export",
    body: "A leading agricultural exporter." + FILLER, expect: "agriculture_commodities",
  },
  {
    name: "Masan Consumer (FMCG) → cpg_consumer_goods", domain: "masan.example.com",
    meta: "Masan Consumer — FMCG and consumer packaged goods brand.",
    h1: "FMCG and consumer goods",
    body: "Sauces, seasonings and consumer brands." + FILLER, expect: "cpg_consumer_goods",
  },
  {
    name: "Distributor → retail_distribution", domain: "distrib.example.com",
    meta: "A wholesale distributor serving modern trade and general trade.",
    h1: "Wholesale distribution, modern trade, general trade",
    body: "Nationwide distribution network." + FILLER, expect: "retail_distribution",
  },
  {
    name: "Industrial maker → manufacturing", domain: "industrial.example.com",
    meta: "Machinery and industrial equipment manufacturing, CNC production line.",
    h1: "Machinery and industrial equipment manufacturing",
    body: "Precision fabrication and assembly." + FILLER, expect: "manufacturing",
  },
  // ── Tech controls: de-bias must NOT over-suppress genuine software companies ──
  {
    name: "HR SaaS control → hr_recruiting", domain: "talenthub.example.com",
    meta: "TalentHub — applicant tracking system, HRIS and talent acquisition software.",
    h1: "Applicant tracking and HRIS",
    body: "Recruiting software for modern teams." + FILLER, expect: "hr_recruiting",
  },
  {
    name: "Fintech control → fintech_payments", domain: "payflow.example.com",
    meta: "PayFlow — payment gateway and payment processing, PSP and card issuing.",
    h1: "Payment gateway and payment processing",
    body: "Payments infrastructure for merchants." + FILLER, expect: "fintech_payments",
  },
  {
    name: "Martech control → crm_martech", domain: "marketai.example.com",
    meta: "MarketAI — marketing automation, email marketing and CRM.",
    h1: "Marketing automation and email marketing",
    body: "Campaign management software for growth teams." + FILLER, expect: "crm_martech",
  },
  // ── Vietnamese-language pages (most VN company sites are not in English) ──
  {
    name: "VN dairy page → food_beverage", domain: "vnsua.example.com",
    meta: "Công ty sữa hàng đầu Việt Nam. Sữa tươi, sữa bột và dinh dưỡng.",
    h1: "Sữa tươi và sữa bột",
    body: "Sản phẩm dinh dưỡng cho gia đình Việt." + FILLER, expect: "food_beverage",
  },
  {
    name: "VN beverage page → food_beverage", domain: "vnbia.example.com",
    meta: "Bia và nước giải khát chất lượng cao.",
    h1: "Bia và đồ uống",
    body: "Thương hiệu đồ uống lâu đời." + FILLER, expect: "food_beverage",
  },
  {
    name: "VN distributor page → retail_distribution", domain: "vnpp.example.com",
    meta: "Nhà phân phối hàng tiêu dùng, bán lẻ và bán buôn toàn quốc.",
    h1: "Phân phối và bán lẻ",
    body: "Mạng lưới phân phối rộng khắp." + FILLER, expect: "retail_distribution",
  },
  {
    name: "VN industrial page → manufacturing", domain: "vncokhi.example.com",
    meta: "Nhà máy sản xuất cơ khí, chế tạo máy móc công nghiệp.",
    h1: "Sản xuất và chế tạo cơ khí",
    body: "Gia công chính xác theo yêu cầu." + FILLER, expect: "manufacturing",
  },
  // ── Thin evidence: min-keyword gate must yield NO category, never a forced tech guess ──
  {
    name: "Thin page → null (no forced tech label)", domain: "thin.example.com",
    meta: "Welcome to our company website.",
    h1: "Home",
    body: "We are a leading company. Our platform helps businesses grow. Contact us today." + FILLER,
    expect: null,
  },
];

describe("taxonomy classification — deepened + de-biased", () => {
  it("has no duplicate category ids or labels", () => {
    const ids = CATEGORY_TAXONOMY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const labels = CATEGORY_TAXONOMY.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("does not substring-match junk keywords (ml / api / agents)", () => {
    // "330ml", "registered capital", "distribution agents" must NOT trigger ai_automation / b2b_saas.
    expect(matchTaxonomy("available in 330ml cans, registered capital, distribution agents")).toBeNull();
  });

  it("respects Vietnamese diacritics — 'sửa' (repair) is not 'sữa' (milk)", () => {
    // Accent-folding would collapse both to "sua" and label a repair shop as a dairy producer.
    // Two repair-shop terms present, yet food_beverage must not match.
    const m = matchTaxonomy("dịch vụ sửa chữa, bảo trì và sửa xe máy");
    expect(m?.category.id).not.toBe("food_beverage");
  });

  it("matches Vietnamese keywords regardless of accent composition (NFC vs NFD)", () => {
    const nfc = "sữa tươi và sữa bột".normalize("NFC");
    const nfd = "sữa tươi và sữa bột".normalize("NFD");
    expect(matchTaxonomy(nfc)?.category.id).toBe("food_beverage");
    expect(matchTaxonomy(nfd)?.category.id).toBe("food_beverage");
  });

  for (const c of CASES) {
    it(c.name, async () => {
      const got = await classify(c.domain, page(c));
      expect(got).toBe(c.expect);
      if (c.expect && c.expect !== "manufacturing") {
        // real-economy expectations must never resolve to a tech bucket
        if (!TECH_CATEGORY_IDS.has(c.expect)) expect(TECH_CATEGORY_IDS.has(got ?? "")).toBe(false);
      }
    });
  }
});

describe("LinkedIn industry — weak prior, never authoritative", () => {
  // One web food keyword ("beer") → null on its own; the imported industry supplies the 2nd hit.
  const oneHit = page({
    title: "Co", meta: "We brew beer.", h1: "Welcome",
    body: "A local producer serving the region." + FILLER,
  });

  it("does not classify on one web keyword alone", async () => {
    expect(await classify("onehit.example.com", oneHit)).toBeNull();
  });

  it("corroborates a web signal to clear the gate (beer + 'Food & Beverages')", async () => {
    expect(await classify("onehit2.example.com", oneHit, "Food & Beverages")).toBe("food_beverage");
  });

  it("cannot hijack a clear food page with a wrong 'Machinery' tag", async () => {
    const food = page({
      title: "Dairy Co", meta: "Dairy company — milk and yogurt.", h1: "Dairy, milk, yogurt",
      body: "Nutrition for families." + FILLER,
    });
    expect(await classify("dairy.example.com", food, "Machinery")).toBe("food_beverage");
  });

  it("cannot assign a category by itself on a thin page", async () => {
    const thin = page({
      title: "Co", meta: "Welcome.", h1: "Home",
      body: "We are a company. Contact us today." + FILLER,
    });
    expect(await classify("thin2.example.com", thin, "Food & Beverages")).toBeNull();
  });
});
