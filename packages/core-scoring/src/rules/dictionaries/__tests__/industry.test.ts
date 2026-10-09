import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { INDUSTRY_TAXONOMY, canonicalizeIndustry, industryKeysForTerm, type IndustryKey } from "../industry";

const LINKEDIN_LABELS = readFileSync(
  fileURLToPath(new URL("./__fixtures__/linkedin-industries-v2.txt", import.meta.url)),
  "utf8"
)
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const expectKeys = (cases: ReadonlyArray<readonly [string, IndustryKey | null]>) => {
  for (const [raw, key] of cases) expect(canonicalizeIndustry(raw), raw).toBe(key);
};

describe("canonicalizeIndustry: substring defects of industry-v1", () => {
  it("no longer fires a short alias inside another word", () => {
    expectKeys([
      ["Display advertising", "ADVERTISING"], // v1: ISP ("d-isp-lay")
      ["Alternative Dispute Resolution", null], // v1: ISP
      ["Waste Treatment and Disposal", "UTILITY"], // v1: ISP
      ["Urban Transit Services", "TRANSPORTATION"], // v1: IT_SERVICES ("trans-it services")
      ["Hospitality", "HOSPITALITY"], // v1: HEALTHCARE ("hospital-ity")
      ["Credit Intermediation", "BANKING"], // v1: MEDIA ("inter-media-tion")
      ["Golf Courses and Country Clubs", "ENTERTAINMENT"], // v1: EDUCATION ("courses")
      ["Lead management for roads", null], // v1: ADVERTISING ("le-ads", "ro-ads")
    ]);
  });

  it("drops bare nouns that name more than one industry", () => {
    expectKeys([
      ["Security and Investigations", null], // guards, not CYBERSECURITY
      ["Security Guards and Patrol Services", null],
      ["Intellectual property law", null], // not REAL_ESTATE
      ["Media Production", "MEDIA"], // v1: MANUFACTURING ("production")
      ["Animation and Post-production", "MEDIA"],
      ["Bottled water", null], // not UTILITY
      ["Hotels and Motels", "HOSPITALITY"], // v1: FNB
    ]);
  });

  it("keeps the matches v1 got right", () => {
    expectKeys([
      ["SaaS", "SAAS"],
      ["B2B SaaS platform", "SAAS"],
      ["Computer Software", "SOFTWARE"],
      ["IT Services and IT Consulting", "IT_SERVICES"],
      ["Information Technology & Services", "IT_SERVICES"],
      ["Computer and Network Security", "CYBERSECURITY"],
      ["Cloud hosting", "CLOUD_HOSTING"],
      ["Telecommunications", "TELECOM"],
      ["Internet Service Provider", "ISP"],
      ["Financial Services", "FINANCE"],
      ["Banking", "BANKING"],
      ["Insurance", "INSURANCE"],
      ["Hospitals and Health Care", "HEALTHCARE"],
      ["Retail", "RETAIL"],
      ["E-commerce", "ECOMMERCE"],
      ["Food & Beverages", "FNB"],
      ["Consumer Goods", "FMCG"],
      ["Industrial Machinery Manufacturing", "MANUFACTURING"],
      ["Logistics and Supply Chain", "LOGISTICS"],
      ["Truck Transportation", "TRANSPORTATION"],
      ["Computer Games", "GAMING"],
      ["Marketing and Advertising", "ADVERTISING"],
      ["Newspaper Publishing", "MEDIA"],
      ["Higher Education", "EDUCATION"],
      ["Government Administration", "GOVERNMENT"],
      ["Utilities", "UTILITY"],
      ["Oil & Energy", "ENERGY"],
      ["Real Estate", "REAL_ESTATE"],
      ["Blockchain Services", "CRYPTO"],
      ["Construction", "CONSTRUCTION"],
      ["Farming", "AGRICULTURE"],
    ]);
  });
});

describe("canonicalizeIndustry: new coverage (LinkedIn V2, plurals, Vietnamese)", () => {
  it("maps LinkedIn V2 labels v1 left raw", () => {
    expectKeys([
      ["Technology, Information and Internet", "SOFTWARE"],
      ["Data Security Software Products", "CYBERSECURITY"],
      ["Venture Capital and Private Equity Principals", "FINANCE"],
      ["Loan Brokers", "FINANCE"],
      ["Capital Markets", "FINANCE"],
      ["Claims Adjusting, Actuarial Services", "INSURANCE"],
      ["Physicians", "HEALTHCARE"],
      ["Biotechnology Research", "HEALTHCARE"],
      ["Retail Pharmacies", "RETAIL"],
      ["Online and Mail Order Retail", "ECOMMERCE"],
      ["Internet Marketplace Platforms", "ECOMMERCE"],
      ["Breweries", "FNB"],
      ["Caterers", "FNB"],
      ["Postal Services", "LOGISTICS"],
      ["Airlines and Aviation", "TRANSPORTATION"],
      ["Accommodation Services", "HOSPITALITY"],
      ["Performing Arts", "ENTERTAINMENT"],
      ["Public Relations and Communications Services", "MARKETING"],
      ["Professional Training and Coaching", "EDUCATION"],
      ["Law Enforcement", "GOVERNMENT"],
      ["Solar Electric Power Generation", "UTILITY"],
      ["Oil, Gas, and Mining", "ENERGY"],
      ["Specialty Trade Contractors", "CONSTRUCTION"],
      ["Ranching and Fisheries", "AGRICULTURE"],
    ]);
  });

  it("reads health, wellness and fitness as healthcare, never entertainment", () => {
    expectKeys([
      ["Health, Wellness and Fitness", "HEALTHCARE"],
      ["Wellness and Fitness Services", "HEALTHCARE"],
      // research splits "Health, Wellness and Fitness" on ",", "&" and "and" (rulesFromParams.ts)
      ["Health", "HEALTHCARE"],
      ["Wellness", "HEALTHCARE"],
      ["Fitness", "HEALTHCARE"],
      ["Educational Services", "EDUCATION"],
    ]);
  });

  it("accepts plurals without turning the plural into a free suffix", () => {
    expectKeys([
      ["Banks", "BANKING"],
      ["Retailers", "RETAIL"],
      ["Fintechs", "FINTECH"],
      ["Bankruptcy law", null],
    ]);
  });

  it("reads Vietnamese with and without diacritics", () => {
    expectKeys([
      ["Phần mềm", "SOFTWARE"],
      ["Dịch vụ công nghệ thông tin", "IT_SERVICES"],
      ["Ngân hàng", "BANKING"],
      ["Ngan hang", "BANKING"],
      ["Bảo hiểm", "INSURANCE"],
      ["Bất động sản", "REAL_ESTATE"],
      ["Bat dong san", "REAL_ESTATE"],
      ["Thương mại điện tử", "ECOMMERCE"],
      ["Logistics - Giao nhận", "LOGISTICS"],
      ["Sản xuất", "MANUFACTURING"],
      ["Xây dựng", "CONSTRUCTION"],
      ["Giáo dục & Đào tạo", "EDUCATION"],
      ["Y tế", "HEALTHCARE"],
      ["Du lịch", "HOSPITALITY"],
    ]);
  });

  it("still leaves industries with no key unmapped rather than guessing", () => {
    expectKeys([
      ["Staffing and Recruiting", null],
      ["Legal Services", null],
      ["Accounting", null],
      ["Non-profit Organizations", null],
      ["Gambling Facilities and Casinos", null],
      ["", null],
    ]);
  });
});

describe("taxonomy invariants", () => {
  it("every alias canonicalises to its own key (no alias is shadowed by an earlier entry)", () => {
    const shadowed: string[] = [];
    for (const entry of INDUSTRY_TAXONOMY) {
      for (const alias of entry.aliases) {
        const got = canonicalizeIndustry(alias);
        if (got !== entry.canonical) shadowed.push(`${alias}: ${entry.canonical} -> ${got}`);
      }
    }
    expect(shadowed).toEqual([]);
  });

  it("maps at least 70% of LinkedIn V2 labels (industry-v1 mapped 50%)", () => {
    const mapped = LINKEDIN_LABELS.filter((label) => canonicalizeIndustry(label) !== null).length;
    expect(LINKEDIN_LABELS.length).toBeGreaterThan(400);
    expect(mapped / LINKEDIN_LABELS.length).toBeGreaterThanOrEqual(0.7);
  });
});

describe("industryKeysForTerm (ICP side)", () => {
  it("names a family for shorthand and one key otherwise", () => {
    expect(industryKeysForTerm("Tech")).toEqual(["SOFTWARE", "SAAS", "IT_SERVICES", "CLOUD_HOSTING", "CYBERSECURITY"]);
    expect(industryKeysForTerm("IT")).toEqual(["IT_SERVICES", "CLOUD_HOSTING", "CYBERSECURITY"]);
    expect(industryKeysForTerm("Security")).toEqual(["CYBERSECURITY"]);
    expect(industryKeysForTerm("Health")).toEqual(["HEALTHCARE"]);
    expect(industryKeysForTerm("Banks")).toEqual(["BANKING"]);
    expect(industryKeysForTerm("Tech consulting")).toEqual([]);
  });
});
