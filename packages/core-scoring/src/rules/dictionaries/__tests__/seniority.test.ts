import { describe, expect, it } from "vitest";

import { lookupSeniority, matchesSeniorityKeyword, type Department, type SeniorityTier } from "../seniority";

describe("matchesSeniorityKeyword", () => {
  it("matches 2-3 letter acronyms only as whole words", () => {
    // "cco" must NOT fire inside "account"; "coo" not inside "coordinator".
    expect(matchesSeniorityKeyword("account executive", "cco")).toBe(false);
    expect(matchesSeniorityKeyword("coordinator", "coo")).toBe(false);
    expect(matchesSeniorityKeyword("microsoft director", "cro")).toBe(false);
    // Real acronym titles still match.
    expect(matchesSeniorityKeyword("cco", "cco")).toBe(true);
    expect(matchesSeniorityKeyword("ceo, founder", "ceo")).toBe(true);
    expect(matchesSeniorityKeyword("vp of sales", "vp")).toBe(true);
  });

  it("keeps longer keywords as substrings", () => {
    expect(matchesSeniorityKeyword("chief commercial officer", "chief")).toBe(true);
    expect(matchesSeniorityKeyword("head of sales", "head of")).toBe(true);
    // German compounds are why: "Vertriebsleiter" is "Leiter" of sales.
    expect(matchesSeniorityKeyword("vertriebsleiter", "leiter")).toBe(true);
  });

  it("honours whole-word and start-of-title options", () => {
    expect(matchesSeniorityKeyword("international sales director", "intern", { wholeWord: true })).toBe(false);
    expect(matchesSeniorityKeyword("sales intern", "intern", { wholeWord: true })).toBe(true);
    expect(matchesSeniorityKeyword("founder | ex-google", "ex-", { atStart: true })).toBe(false);
    expect(matchesSeniorityKeyword("ex-ceo", "ex-", { atStart: true })).toBe(true);
  });
});

describe("lookupSeniority C_LEVEL no longer over-matches", () => {
  it("classifies account/coordinator titles below C_LEVEL", () => {
    expect(lookupSeniority("Account Executive").tier).not.toBe("C_LEVEL");
    expect(lookupSeniority("Account Manager").tier).toBe("MANAGER");
    expect(lookupSeniority("Key Account Manager").tier).toBe("MANAGER");
    expect(lookupSeniority("Coordinator").tier).not.toBe("C_LEVEL");
  });

  it("still resolves real C-level titles", () => {
    expect(lookupSeniority("CEO").tier).toBe("C_LEVEL");
    expect(lookupSeniority("Chief Marketing Officer").tier).toBe("C_LEVEL");
    expect(lookupSeniority("CCO").tier).toBe("C_LEVEL");
    expect(lookupSeniority("Chief").tier).toBe("C_LEVEL");
  });
});

type Case = readonly [title: string, tier: SeniorityTier, department?: Department];

const expectTier = (cases: readonly Case[]) => {
  for (const [title, tier, department] of cases) {
    const got = lookupSeniority(title);
    expect(got.tier, `${title} -> ${got.matchedKeyword}`).toBe(tier);
    if (department) expect(got.department, `${title} department`).toBe(department);
  }
};

describe("worldwide decision-maker titles (2026-10 taxonomy)", () => {
  it("English C-suite, including the newer roles and abbreviations", () => {
    expectTier([
      ["C.E.O.", "C_LEVEL", "EXECUTIVE"],
      ["Chief Growth Officer", "C_LEVEL", "GROWTH"],
      ["CGO", "C_LEVEL", "GROWTH"],
      ["Chief Business Officer", "C_LEVEL", "BUSINESS_DEVELOPMENT"],
      ["Cofounder and CBO", "C_LEVEL", "BUSINESS_DEVELOPMENT"],
      ["Chief Sales Officer", "C_LEVEL", "SALES"],
      ["Chief Revenue Officer (CRO)", "C_LEVEL", "SALES"],
      ["Chief Customer Officer", "C_LEVEL", "CUSTOMER"],
      ["Chief People Officer", "C_LEVEL", "HR"],
      ["CHRO", "C_LEVEL", "HR"],
      ["Chief Data Officer", "C_LEVEL", "IT"],
      ["CDO", "C_LEVEL", "IT"],
      ["Chief AI Officer", "C_LEVEL", "IT"],
      ["CAIO", "C_LEVEL", "IT"],
      ["Chief Technical Officer", "C_LEVEL", "ENGINEERING"],
      ["CSO", "C_LEVEL"],
      ["CXO", "C_LEVEL"],
    ]);
  });

  it("president, chairman and board", () => {
    expectTier([
      ["President", "C_LEVEL", "EXECUTIVE"],
      ["Co-President", "C_LEVEL"],
      ["President & CEO", "C_LEVEL"],
      ["Chairman of the Board", "C_LEVEL"],
      ["Executive Chairwoman", "C_LEVEL"],
      ["Board Member", "DIRECTOR", "EXECUTIVE"],
      ["Non-Executive Director", "DIRECTOR", "EXECUTIVE"],
      ["Member of the Supervisory Board", "DIRECTOR"],
    ]);
  });

  it("VP ranks, and the assistant/deputy ranks that sit below them", () => {
    expectTier([
      ["Vice-President, Sales", "VP"],
      ["GVP Sales", "VP"],
      ["RVP, APAC", "VP"],
      ["Assistant Vice President", "MANAGER"],
      ["AVP Operations", "MANAGER"],
      ["Deputy General Manager", "MANAGER"],
    ]);
  });

  it("general and country managers run a P&L", () => {
    expectTier([
      ["General Manager", "DIRECTOR", "EXECUTIVE"],
      ["GM, Vietnam", "DIRECTOR"],
      ["Country Manager - Thailand", "DIRECTOR"],
      ["Country Head", "DIRECTOR"],
    ]);
  });

  it("founders, owners and partners", () => {
    expectTier([
      ["Entrepreneur", "OWNER"],
      ["Co-Owner", "OWNER"],
      ["Managing Partner", "OWNER"],
      ["Partner", "OWNER"],
      ["Partner, Sequoia Capital", "OWNER"],
      ["Self-employed", "OWNER"],
    ]);
  });

  it("European languages", () => {
    expectTier([
      ["Geschäftsführer", "C_LEVEL"],
      ["Geschaftsfuhrer", "C_LEVEL"],
      ["Gründer & Geschäftsführer", "OWNER"],
      ["Inhaber", "OWNER"],
      ["Prokurist", "DIRECTOR"],
      ["Vorstandsvorsitzender", "C_LEVEL"],
      ["Vertriebsleiter DACH", "HEAD", "SALES"],
      ["Teamleiter Kundenservice", "LEAD"],
      ["Projektleiter", "MANAGER"],
      ["PDG", "C_LEVEL"],
      ["Président-Directeur Général", "C_LEVEL"],
      ["Directeur Général", "C_LEVEL"],
      ["Gérant", "C_LEVEL"],
      ["Fondateur", "OWNER"],
      ["Directeur Commercial", "DIRECTOR", "SALES"],
      ["Associé", "OWNER"],
      ["Consejero Delegado", "C_LEVEL"],
      ["Director General", "C_LEVEL"],
      ["Gerente General", "C_LEVEL"],
      ["Gerente de Ventas", "MANAGER"],
      ["Socio Fundador", "OWNER"],
      ["Diretor Comercial", "DIRECTOR", "SALES"],
      ["Amministratore Delegato", "C_LEVEL"],
      ["Titolare", "OWNER"],
      ["VD", "C_LEVEL"],
      ["Administrerende direktør", "C_LEVEL"],
      ["Algemeen directeur", "C_LEVEL"],
      ["Prezes Zarządu", "C_LEVEL"],
      ["Генеральный директор", "C_LEVEL"],
    ]);
  });

  it("Vietnamese, with and without diacritics", () => {
    expectTier([
      ["Tổng Giám Đốc", "C_LEVEL"],
      ["Tong giam doc", "C_LEVEL"],
      ["Giám đốc điều hành", "C_LEVEL"],
      ["Phó Tổng Giám Đốc", "VP"],
      ["Giám đốc kinh doanh", "DIRECTOR", "SALES"],
      ["Giám đốc tài chính", "C_LEVEL", "FINANCE"],
      ["Giám đốc công nghệ thông tin", "DIRECTOR", "IT"],
      ["Giám đốc", "DIRECTOR"],
      ["Chủ tịch HĐQT", "C_LEVEL"],
      ["Nhà sáng lập", "OWNER"],
      ["Trưởng phòng kinh doanh", "HEAD", "SALES"],
      ["Trưởng phòng Marketing", "HEAD"],
      ["Trưởng nhóm", "LEAD"],
      ["Kế toán trưởng", "MANAGER", "FINANCE"],
      ["Nhân viên kinh doanh", "IC"],
    ]);
  });

  it("Asian scripts and Indonesian/Malay", () => {
    expectTier([
      ["总经理", "C_LEVEL"],
      ["副总经理", "VP"],
      ["董事长", "C_LEVEL"],
      ["销售总监", "DIRECTOR", "SALES"],
      ["创始人", "OWNER"],
      ["代表取締役社長", "C_LEVEL"],
      ["営業部長", "HEAD"],
      ["대표이사", "C_LEVEL"],
      ["부사장", "VP"],
      ["영업부장", "HEAD"],
      ["Direktur Utama", "C_LEVEL"],
      ["Presiden Direktur", "C_LEVEL"],
      ["Direktur Pemasaran", "DIRECTOR"],
      ["Pengarah Urusan", "C_LEVEL"],
    ]);
  });

  it("headline-style heads with no 'of'", () => {
    expectTier([
      ["Head, Sales", "HEAD"],
      ["Regional Head - Business Development", "HEAD"],
      ["Acting Head, Enterprise Sales", "HEAD"],
      ["Jefe de Ventas", "HEAD", "SALES"],
    ]);
  });
});

describe("false positives: a senior word in a title that is not senior", () => {
  it("assistants, PAs and secretaries to an executive", () => {
    expectTier([
      ["Assistant to the CEO", "IC", "ADMIN"],
      ["Executive Assistant to the Managing Director", "IC", "ADMIN"],
      ["PA to CEO", "IC", "ADMIN"],
      ["Personal Assistant to the Chairman", "IC", "ADMIN"],
      ["Sales Director Assistant", "IC", "ADMIN"],
      ["CEO Office", "IC", "ADMIN"],
      ["Director's Office Coordinator", "IC", "ADMIN"],
      ["Assistenz der Geschäftsführung", "IC", "ADMIN"],
      ["Assistant de direction", "IC", "ADMIN"],
      ["Trợ lý Tổng Giám Đốc", "IC", "ADMIN"],
      ["总经理助理", "IC", "ADMIN"],
    ]);
  });

  it("interns and trainees, without catching 'international' or 'internal'", () => {
    expectTier([
      ["CEO Intern", "IC"],
      ["Sales Intern", "IC"],
      ["Management Trainee", "IC"],
      ["Werkstudent Vertrieb", "IC"],
      ["Thực tập sinh kinh doanh", "IC"],
      ["International Sales Director", "DIRECTOR", "SALES"],
      ["Internal Audit Manager", "MANAGER"],
    ]);
  });

  it("former and retired executives are not current ones", () => {
    expectTier([
      ["Former CEO", "UNKNOWN"],
      ["Ex-CMO", "UNKNOWN"],
      ["Retired Managing Director", "UNKNOWN"],
      ["Cựu Giám đốc", "UNKNOWN"],
      // ...but a current role with a past employer in the headline is still current
      ["Founder | ex-Google", "OWNER"],
      ["CEO, former VP Sales at Oracle", "C_LEVEL"],
    ]);
  });

  it("'owner' as a process role, 'lead' as the sales object, staff roles near the top", () => {
    expectTier([
      ["Product Owner", "MANAGER", "PRODUCT"],
      ["Customer Experience Owner", "MANAGER"],
      ["Co-founder & Product Owner", "OWNER"],
      ["Business Owner", "OWNER"],
      ["Lead Generation Specialist", "IC", "SALES"],
      ["Lead Generation Manager", "MANAGER", "SALES"],
      ["Team Lead", "LEAD"],
      ["Chief of Staff to the CEO", "DIRECTOR", "EXECUTIVE"],
      ["Bras droit du Président", "DIRECTOR", "EXECUTIVE"],
      ["Secretary General", "C_LEVEL"],
      ["Chief Accountant", "MANAGER", "FINANCE"],
    ]);
  });

  it("partners and principals that are not owners", () => {
    expectTier([
      ["HR Business Partner", "IC", "HR"],
      ["Partner Manager", "MANAGER"],
      ["Partnerships Lead", "LEAD"],
      ["Principal Engineer", "IC", "ENGINEERING"],
      ["Principal Consultant", "IC"],
      ["Principal", "DIRECTOR"],
    ]);
  });

  it("board advisors are advisors, not directors", () => {
    expectTier([
      ["Member, Board of Advisors", "IC"],
      ["Advisory Board Member", "IC"],
      ["Board Member & Investor", "DIRECTOR"],
    ]);
  });

  it("vice ranks never fall through to the bare president/GM entries", () => {
    expectTier([
      ["Vice President", "VP"],
      ["Senior Vice President of Sales", "VP"],
      ["Vizepräsident", "VP"],
      ["Assistant General Manager", "MANAGER"],
    ]);
  });
});
