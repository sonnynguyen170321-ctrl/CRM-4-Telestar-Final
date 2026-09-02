import { describe, expect, it } from "vitest";

import {
  buildServedVerticalTree,
  classifyServedVerticals,
  formatIndustryDetail,
  isServedVerticalKey,
  SERVED_VERTICAL_TAXONOMY,
  verticalLabel,
  verticalMatchAliases,
} from "../dictionaries/servedVertical";

describe("classifyServedVerticals", () => {
  it("classifies 'for finance / fintech' onto the finance sector", () => {
    const v = classifyServedVerticals("platform for financial services and fintech");
    expect(v.map((m) => m.key)).toContain("FINANCE");
  });

  it("resolves the specific finance sub-vertical when present (payments)", () => {
    const v = classifyServedVerticals("payment processing gateway for merchants");
    expect(v[0]?.key).toBe("FIN_PAYMENTS");
    expect(v[0]?.parentLabel).toBe("Financial Services");
  });

  it("classifies 'manufacturing for wool' down to the WOOL leaf, not its ancestors", () => {
    const v = classifyServedVerticals("manufacturer of merino wool and worsted yarn");
    expect(v.map((m) => m.key)).toContain("IND_WOOL");
    // WOOL's ancestors (textiles, industrial) must be suppressed — most-specific-per-branch.
    expect(v.map((m) => m.key)).not.toContain("IND_TEXTILES");
    expect(v.find((m) => m.key === "IND_WOOL")?.parentLabel).toBe("Textiles & Apparel Mfg");
  });

  it("classifies rubber / elastic onto the rubber material vertical", () => {
    const v = classifyServedVerticals("elastic and vulcanized rubber components");
    expect(v.map((m) => m.key)).toContain("IND_RUBBER");
  });

  it("covers many sectors (broad, not just the seed examples)", () => {
    expect(classifyServedVerticals("renewable solar energy").map((m) => m.key)).toContain("ENE_RENEWABLES");
    expect(classifyServedVerticals("edtech e-learning platform").map((m) => m.key)).toContain("EDU_EDTECH");
    expect(classifyServedVerticals("3pl logistics and fulfilment").map((m) => m.key)).toContain("LOG_3PL");
    expect(classifyServedVerticals("proptech real estate software").map((m) => m.key)).toContain("RE_PROPTECH");
    expect(classifyServedVerticals("pharma and biotech drug discovery").map((m) => m.key)).toContain("HEALTH_PHARMA");
  });

  it("returns [] for empty or unmatched text", () => {
    expect(classifyServedVerticals("")).toEqual([]);
    expect(classifyServedVerticals("   ")).toEqual([]);
    expect(classifyServedVerticals("zzzz nothing here")).toEqual([]);
  });

  it("classifies Vietnamese text onto the right vertical", () => {
    expect(classifyServedVerticals("sữa tươi và sữa bột").map((m) => m.key)).toContain("AGRI_LIVESTOCK");
    expect(classifyServedVerticals("bia và nước giải khát").map((m) => m.key)).toContain("AGRI_FNB");
    expect(classifyServedVerticals("nhà phân phối và bán lẻ").map((m) => m.key)).toContain("CONSUMER");
    expect(classifyServedVerticals("nhà máy sản xuất cơ khí").map((m) => m.key)).toContain("INDUSTRIAL");
  });

  it("preferSectors breaks ties toward the branch matching the category", () => {
    // A food producer whose site also says "factory / production" hits INDUSTRIAL *and* AGRI_FNB.
    const text = "nhà máy sản xuất thực phẩm và đồ uống";
    expect(classifyServedVerticals(text, 1)[0]?.key).toBe("INDUSTRIAL"); // array order wins by default
    expect(classifyServedVerticals(text, 1, ["AGRICULTURE"])[0]?.key).toBe("AGRI_FNB");
    // and the reverse still works for a genuine manufacturer
    expect(classifyServedVerticals(text, 1, ["INDUSTRIAL"])[0]?.key).toBe("INDUSTRIAL");
  });

  it("preferSectors does not invent a match that isn't there", () => {
    expect(classifyServedVerticals("merino wool", 2, ["FINANCE"]).map((m) => m.key)).toContain("IND_WOOL");
    expect(classifyServedVerticals("zzzz nothing", 2, ["FINANCE"])).toEqual([]);
  });

  it("respects Vietnamese diacritics — 'sửa chữa' (repair) is not 'sữa' (milk)", () => {
    expect(classifyServedVerticals("dịch vụ sửa chữa ô tô").map((m) => m.key)).not.toContain("AGRI_LIVESTOCK");
  });

  it("matches on word boundaries — short aliases don't substring-hit (ev ≠ development)", () => {
    // The "ev" (automotive) alias must not fire inside development/every/delivery on a food page.
    const v = classifyServedVerticals("our development team delivers every beverage nationwide");
    expect(v.map((m) => m.key)).not.toContain("IND_AUTOMOTIVE");
    // A genuine standalone token still matches.
    expect(classifyServedVerticals("ev charging network").map((m) => m.key)).toContain("IND_AUTOMOTIVE");
  });

  it("caps the number of returned verticals + is deterministic", () => {
    const v = classifyServedVerticals("fintech healthcare logistics education energy", 2);
    expect(v.length).toBeLessThanOrEqual(2);
    expect(classifyServedVerticals("wool rubber factory")).toEqual(classifyServedVerticals("wool rubber factory"));
  });
});

describe("formatIndustryDetail", () => {
  it("joins category and top vertical as 'Category · Vertical'", () => {
    const v = classifyServedVerticals("merino wool");
    expect(formatIndustryDetail("Manufacturing", v)).toBe("Manufacturing · Wool");
  });
  it("falls back to category alone when no vertical", () => {
    expect(formatIndustryDetail("SaaS", [])).toBe("SaaS");
  });
  it("returns null when neither is present", () => {
    expect(formatIndustryDetail(null, [])).toBeNull();
  });
});

describe("filter facet helpers", () => {
  it("buildServedVerticalTree returns sector roots with children", () => {
    const tree = buildServedVerticalTree();
    const finance = tree.find((n) => n.key === "FINANCE");
    expect(finance).toBeTruthy();
    expect(finance!.children.map((c) => c.key)).toContain("FIN_PAYMENTS");
    // industrial → textiles → wool is 3 levels deep.
    const industrial = tree.find((n) => n.key === "INDUSTRIAL");
    const textiles = industrial!.children.find((c) => c.key === "IND_TEXTILES");
    expect(textiles!.children.map((c) => c.key)).toContain("IND_WOOL");
  });

  it("verticalMatchAliases includes the node + all descendant aliases", () => {
    const aliases = verticalMatchAliases("IND_TEXTILES");
    expect(aliases).toContain("textile");
    expect(aliases).toContain("wool"); // descendant leaf alias
    expect(aliases).toContain("cotton");
  });

  it("verticalLabel + isServedVerticalKey behave", () => {
    expect(verticalLabel("IND_WOOL")).toBe("Wool");
    expect(verticalLabel("NOPE")).toBe("NOPE");
    expect(isServedVerticalKey("FINANCE")).toBe(true);
    expect(isServedVerticalKey("NOPE")).toBe(false);
  });
});

describe("SERVED_VERTICAL_TAXONOMY integrity", () => {
  it("has unique keys", () => {
    const keys = SERVED_VERTICAL_TAXONOMY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("every parent reference resolves", () => {
    const keys = new Set(SERVED_VERTICAL_TAXONOMY.map((e) => e.key));
    for (const e of SERVED_VERTICAL_TAXONOMY) {
      if (e.parent) expect(keys.has(e.parent)).toBe(true);
    }
  });
  it("is broad — at least 12 top-level sectors", () => {
    const roots = SERVED_VERTICAL_TAXONOMY.filter((e) => !e.parent);
    expect(roots.length).toBeGreaterThanOrEqual(12);
  });
});
