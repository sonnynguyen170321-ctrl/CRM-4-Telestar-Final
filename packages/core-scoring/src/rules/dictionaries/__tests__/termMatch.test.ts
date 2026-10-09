import { describe, expect, it } from "vitest";

import { containsTerm, foldForMatch } from "../termMatch";

describe("foldForMatch", () => {
  it("strips accents, including letters NFD does not decompose", () => {
    expect(foldForMatch("Giám Đốc")).toBe("giam doc");
    expect(foldForMatch("Geschäftsführer")).toBe("geschaftsfuhrer");
    expect(foldForMatch("Administrerende direktør")).toBe("administrerende direktor");
    expect(foldForMatch("Właściciel")).toBe("wlasciciel");
    expect(foldForMatch("  Président   Directeur  ")).toBe("president directeur");
  });
});

describe("containsTerm", () => {
  it("matches whole words only", () => {
    expect(containsTerm("Display advertising", "isp")).toBe(false);
    expect(containsTerm("Alternative Dispute Resolution", "isp")).toBe(false);
    expect(containsTerm("Urban Transit Services", "it services")).toBe(false);
    expect(containsTerm("Hospitality", "hospital")).toBe(false);
    expect(containsTerm("Credit Intermediation", "media")).toBe(false);
    expect(containsTerm("Regional ISP", "isp")).toBe(true);
    expect(containsTerm("IT Services and IT Consulting", "it services")).toBe(true);
  });

  it("keeps punctuation inside a term usable", () => {
    expect(containsTerm("B2B e-commerce platform", "e-commerce")).toBe(true);
    expect(containsTerm("F&B group", "f&b")).toBe(true);
    expect(containsTerm("Ex-CEO", "ex-", { atStart: true })).toBe(true);
  });

  it("accepts plural endings only when asked", () => {
    expect(containsTerm("Loan Brokers", "loan", { plural: true })).toBe(true);
    expect(containsTerm("Retail Groceries", "groceries", { plural: true })).toBe(true);
    expect(containsTerm("Banks", "bank")).toBe(false);
    expect(containsTerm("Banks", "bank", { plural: true })).toBe(true);
    // a plural ending is not a free suffix
    expect(containsTerm("Bankruptcy advisers", "bank", { plural: true })).toBe(false);
  });

  it("anchors to the start when asked", () => {
    expect(containsTerm("Former CEO", "former", { atStart: true })).toBe(true);
    expect(containsTerm("(Retired) CFO", "retired", { atStart: true })).toBe(true);
    expect(containsTerm("CEO, former VP Sales", "former", { atStart: true })).toBe(false);
  });

  it("matches accent-insensitively both ways", () => {
    expect(containsTerm("Giam doc kinh doanh", "giám đốc")).toBe(true);
    expect(containsTerm("Tổng Giám Đốc", "tong giam doc")).toBe(true);
  });

  it("uses substring matching for scripts written without spaces", () => {
    expect(containsTerm("销售总监", "总监")).toBe(true);
    expect(containsTerm("営業部長", "部長")).toBe(true);
    expect(containsTerm("영업부장", "부장")).toBe(true);
  });

  it("never matches an empty term or text", () => {
    expect(containsTerm("CEO", "")).toBe(false);
    expect(containsTerm("", "ceo")).toBe(false);
  });
});
