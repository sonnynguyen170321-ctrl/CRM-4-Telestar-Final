// SC1 reference dictionary: title -> seniority tier + department.
//
// Worldwide (EN, DE, FR, ES, PT, IT, NL, Nordic, PL, RU, TR, ID/MS, VI, ZH, JA, KO). Powers persona
// seniority floors, seniority exclusions ("no manager" / "no engineer"), and department overrides
// ("HR/Admin: any level OK"). Versioned data — bump SENIORITY_DICTIONARY_VERSION on change.
// Sources and every judgement call: docs/scoring/TAXONOMY_2026-10.md. Pure data + pure helpers only.

import { containsFoldedTerm, foldForMatch, stripFoldedTerm } from "./termMatch";

export const SENIORITY_TIERS = [
  "C_LEVEL",
  "OWNER",
  "VP",
  "DIRECTOR",
  "HEAD",
  "LEAD",
  "MANAGER",
  "IC",
  "UNKNOWN",
] as const;

export type SeniorityTier = (typeof SENIORITY_TIERS)[number];

// Higher rank = more senior. seniorityFloor comparisons use this ordering.
// OWNER ranks alongside C_LEVEL (founder/owner). UNKNOWN is the floor.
export const SENIORITY_RANK: Record<SeniorityTier, number> = {
  C_LEVEL: 7,
  OWNER: 7,
  VP: 6,
  DIRECTOR: 5,
  HEAD: 4,
  LEAD: 3,
  MANAGER: 2,
  IC: 1,
  UNKNOWN: 0,
};

export const DEPARTMENTS = [
  "EXECUTIVE",
  "SALES",
  "MARKETING",
  "GROWTH",
  "BUSINESS_DEVELOPMENT",
  "PARTNERSHIPS",
  "IT",
  "ENGINEERING",
  "SECURITY",
  "PRODUCT",
  "OPERATIONS",
  "PRODUCTION",
  "HR",
  "FINANCE",
  "ADMIN",
  "CUSTOMER",
  "LEGAL",
  "UNKNOWN",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

type SeniorityEntry = {
  // Lowercase keywords; first matching entry wins (ordered most-specific first). Matching is
  // accent-folded ("giam doc" meets "giám đốc"). Substring by default, so German compounds work
  // ("Vertriebsleiter" contains "leiter"); 2-3 letter acronyms are always whole words.
  match: readonly string[];
  tier: SeniorityTier;
  department: Department;
  /** Whole words only: "intern" must not fire inside "international", "partner" inside "partnerships". */
  wholeWord?: boolean;
  /** Only at the start of the title: "Former CEO" is not a CEO, "CEO, ex-Google" is. */
  atStart?: boolean;
};

// Order matters. Read top to bottom:
//   1. guards — titles that CONTAIN a senior word without BEING senior (former, intern, assistant to…)
//   2. C-level, founders, owners, VPs, CEO-equivalents, president/chairman, board
//   3. director / head / lead / manager, each with its specific forms first
//   4. individual contributors, then whole-word fallbacks that only apply when nothing else did.
export const SENIORITY_TAXONOMY: readonly SeniorityEntry[] = [
  // ── 1. Guards ───────────────────────────────────────────────────────────────────────────────
  // Not a current role. Anchored to the start: a headline "Founder | ex-Google" is still a founder.
  { match: ["former", "formerly", "ex-", "retired", "fmr", "ehemaliger", "ehemalige", "ancien", "ancienne", "antiguo", "cựu", "aspiring", "open to work", "seeking"], tier: "UNKNOWN", department: "UNKNOWN", wholeWord: true, atStart: true },
  // Learners.
  { match: ["intern", "internship", "trainee", "apprentice", "working student", "werkstudent", "werkstudentin", "praktikant", "praktikantin", "stagiaire", "alternant", "alternante", "becario", "becaria", "estagiário", "estagiária", "tirocinante", "phd student", "graduate student", "thực tập sinh", "sinh viên", "实习生", "インターン", "인턴"], tier: "IC", department: "UNKNOWN", wholeWord: true },
  // Staff to the top: senior, but not an officer of the company.
  { match: ["chief of staff", "right hand", "right-hand", "bras droit", "chief representative", "trưởng đại diện"], tier: "DIRECTOR", department: "EXECUTIVE", wholeWord: true },
  // Working FOR an executive: the senior word names the boss, not the person.
  { match: ["secretary general", "secretary-general", "general secretary", "tổng thư ký", "秘书长", "秘書長"], tier: "C_LEVEL", department: "EXECUTIVE", wholeWord: true },
  { match: ["assistant to", "assistant of", "assistant for", "executive assistant", "personal assistant", "administrative assistant", "pa to", "pa for", "ea to", "ea for", "secretary to", "ceo assistant", "director assistant", "manager assistant", "president assistant", "chairman assistant", "founder assistant", "owner assistant", "md assistant", "gm assistant", "ceo secretary", "director secretary", "assistent", "assistentin", "assistenz", "vorstandsassistent", "vorstandsassistentin", "assistant de direction", "assistante de direction", "asistente de dirección", "asistente de gerencia", "assistente di direzione", "trợ lý", "thư ký", "助理", "秘書"], tier: "IC", department: "ADMIN", wholeWord: true },

  // ── 2. C-level ──────────────────────────────────────────────────────────────────────────────
  { match: ["chief executive", "ceo", "c.e.o", "首席执行官", "最高経営責任者"], tier: "C_LEVEL", department: "EXECUTIVE" },
  { match: ["chief operating", "coo"], tier: "C_LEVEL", department: "OPERATIONS" },
  { match: ["chief revenue", "cro", "chief sales"], tier: "C_LEVEL", department: "SALES" },
  { match: ["chief marketing", "cmo"], tier: "C_LEVEL", department: "MARKETING" },
  { match: ["chief growth", "cgo"], tier: "C_LEVEL", department: "GROWTH" },
  { match: ["chief business", "cbo"], tier: "C_LEVEL", department: "BUSINESS_DEVELOPMENT" },
  { match: ["chief partnership"], tier: "C_LEVEL", department: "PARTNERSHIPS" },
  { match: ["chief technology", "chief technical", "cto"], tier: "C_LEVEL", department: "ENGINEERING" },
  { match: ["chief information security", "chief security"], tier: "C_LEVEL", department: "SECURITY" },
  { match: ["ciso"], tier: "C_LEVEL", department: "SECURITY", wholeWord: true },
  { match: ["chief information", "cio"], tier: "C_LEVEL", department: "IT" },
  { match: ["chief data", "chief analytics", "chief ai", "chief artificial intelligence", "cdo"], tier: "C_LEVEL", department: "IT" },
  { match: ["caio"], tier: "C_LEVEL", department: "IT", wholeWord: true },
  { match: ["chief financial", "cfo"], tier: "C_LEVEL", department: "FINANCE" },
  { match: ["chief commercial", "cco"], tier: "C_LEVEL", department: "SALES" },
  { match: ["chief customer", "chief experience", "chief client"], tier: "C_LEVEL", department: "CUSTOMER" },
  { match: ["chief product", "cpo"], tier: "C_LEVEL", department: "PRODUCT" },
  { match: ["chief people", "chief human resources", "chief hr", "chief talent"], tier: "C_LEVEL", department: "HR" },
  { match: ["chro"], tier: "C_LEVEL", department: "HR", wholeWord: true },
  { match: ["chief legal", "chief compliance"], tier: "C_LEVEL", department: "LEGAL" },
  { match: ["cxo", "cso", "c-level", "c-suite"], tier: "C_LEVEL", department: "EXECUTIVE", wholeWord: true },
  // A statutory head of accounting (VN "kế toán trưởng"), not an officer of the company.
  { match: ["chief accountant", "kế toán trưởng"], tier: "MANAGER", department: "FINANCE" },
  { match: ["chief"], tier: "C_LEVEL", department: "EXECUTIVE" },

  // ── Founders ────────────────────────────────────────────────────────────────────────────────
  { match: ["founder", "co-founder", "cofounder", "gründer", "gründerin", "mitgründer", "mitbegründer", "fondateur", "fondatrice", "cofondateur", "co-fondateur", "fundador", "fundadora", "cofundador", "fondatore", "cofondatore", "oprichter", "grundare", "grundlægger", "założyciel", "основатель", "kurucu", "pendiri", "người sáng lập", "nhà sáng lập", "đồng sáng lập", "sáng lập viên", "创始人", "創辦人", "創業者", "창업자", "창립자", "entrepreneur"], tier: "OWNER", department: "EXECUTIVE" },
  // Owners and partners of the firm.
  { match: ["owner", "co-owner", "proprietor", "proprietress", "inhaber", "inhaberin", "propriétaire", "propietario", "propietaria", "proprietário", "proprietária", "titolare", "dueño", "dueña", "właściciel", "владелец", "chủ sở hữu", "chủ doanh nghiệp", "pemilik", "老板", "オーナー", "self-employed", "self employed", "sole proprietor", "chef d'entreprise"], tier: "OWNER", department: "EXECUTIVE" },
  { match: ["eigenaar", "ägare", "ejer", "eier", "associé", "associée", "socio", "socia", "sócio", "sócia"], tier: "OWNER", department: "EXECUTIVE", wholeWord: true },
  { match: ["managing partner", "founding partner", "senior partner", "equity partner", "general partner", "name partner", "associate partner", "audit partner", "tax partner", "advisory partner", "deal partner", "practice partner", "salaried partner", "venture partner", "operating partner"], tier: "OWNER", department: "EXECUTIVE" },
  // German executive (FlexEnergy). "Geschäftsführung" alone is not here: "Assistenz der Geschäftsführung".
  { match: ["geschäftsleitung", "geschaeftsleitung", "geschäftsführer", "geschaeftsfuehrer", "mitglied der geschäftsführung", "vorstand"], tier: "C_LEVEL", department: "EXECUTIVE" },

  // ── VP ──────────────────────────────────────────────────────────────────────────────────────
  // Assistant / deputy VP and GM ranks (banking, India, APAC) sit at manager level.
  { match: ["assistant vice president", "assistant vice-president", "avp", "assistant general manager", "deputy general manager", "agm", "dgm", "assistant gm", "deputy gm", "assistant country manager", "deputy country manager", "assistant country head", "deputy country head"], tier: "MANAGER", department: "UNKNOWN" },
  { match: ["vice president", "vice-president", "vicepresident", "vicepresidente", "vizepräsident", "vizepraesident", "vp ", "vp of", "vp,", "svp", "evp", "gvp", "rvp", "phó tổng giám đốc", "副总裁", "副總裁", "副总经理", "副總經理", "副社長", "執行役員", "부사장", "전무", "상무"], tier: "VP", department: "UNKNOWN" },

  // ── CEO equivalents, president, chairman ────────────────────────────────────────────────────
  { match: ["managing director", "general director", "director general", "director-general", "directeur général", "directrice générale", "direttore generale", "direttrice generale", "diretor geral", "diretor-geral", "diretora geral", "directora general", "director ejecutivo", "directora ejecutiva", "consejero delegado", "consejera delegada", "amministratore delegato", "verkställande direktör", "administrerende direktør", "adm. direktør", "toimitusjohtaja", "algemeen directeur", "zaakvoerder", "daglig leder", "gerente general", "gerente geral", "président-directeur général", "presidente ejecutivo", "prezes zarządu", "generaldirektor", "генеральный директор", "genel müdür", "direktur utama", "presiden direktur", "pengarah urusan", "ketua pegawai eksekutif", "tổng giám đốc", "giám đốc điều hành", "总经理", "總經理", "代表取締役", "대표이사", "กรรมการผู้จัดการ"], tier: "C_LEVEL", department: "EXECUTIVE" },
  { match: ["pdg", "vd", "cmd", "gérant", "gérante", "jednatel"], tier: "C_LEVEL", department: "EXECUTIVE", wholeWord: true },
  { match: ["president", "presidente", "präsident", "prezes", "总裁", "總裁", "社長", "사장"], tier: "C_LEVEL", department: "EXECUTIVE" },
  { match: ["chairman", "chairwoman", "chairperson", "chair of the board", "board chair", "executive chair", "vorsitzende", "chủ tịch", "董事长", "董事長", "会長", "회장"], tier: "C_LEVEL", department: "EXECUTIVE" },

  // ── Board ───────────────────────────────────────────────────────────────────────────────────
  { match: ["board of advisors", "board of advisers", "advisory board", "advisory council"], tier: "IC", department: "UNKNOWN" },
  { match: ["board member", "member of the board", "board of directors", "board director", "supervisory board", "non-executive director", "non executive director", "non-exec director", "independent director", "aufsichtsrat", "komisaris", "thành viên hđqt", "thành viên hội đồng quản trị", "取締役"], tier: "DIRECTOR", department: "EXECUTIVE" },

  // ── 3. Director ─────────────────────────────────────────────────────────────────────────────
  { match: ["director of sales", "sales director", "commercial director", "directeur commercial", "directrice commerciale", "director comercial", "directora comercial", "diretor comercial", "diretora comercial", "direttore commerciale", "vertriebsdirektor", "verkaufsdirektor", "giám đốc kinh doanh", "giám đốc thương mại", "销售总监"], tier: "DIRECTOR", department: "SALES" },
  { match: ["director of business development", "business development director", "giám đốc phát triển kinh doanh"], tier: "DIRECTOR", department: "BUSINESS_DEVELOPMENT" },
  { match: ["it director", "director of it", "giám đốc it", "giám đốc công nghệ thông tin"], tier: "DIRECTOR", department: "IT" },
  // VN functional "giám đốc" read as the C-suite role (after IT director: "công nghệ thông tin").
  { match: ["giám đốc tài chính"], tier: "C_LEVEL", department: "FINANCE" },
  { match: ["giám đốc công nghệ"], tier: "C_LEVEL", department: "ENGINEERING" },
  { match: ["giám đốc vận hành"], tier: "C_LEVEL", department: "OPERATIONS" },
  { match: ["creative director"], tier: "DIRECTOR", department: "MARKETING" },
  { match: ["marketing director", "director of marketing", "directeur marketing", "giám đốc marketing", "giám đốc tiếp thị"], tier: "DIRECTOR", department: "MARKETING" },
  { match: ["hr director", "director of hr", "giám đốc nhân sự"], tier: "DIRECTOR", department: "HR" },
  { match: ["factory director", "plant director", "production director", "giám đốc nhà máy", "giám đốc sản xuất"], tier: "DIRECTOR", department: "PRODUCTION" },
  // Prokurist: statutory authorised signatory, the rank below the Geschäftsführer.
  { match: ["direktor", "direktorin", "prokurist", "prokuristin"], tier: "DIRECTOR", department: "EXECUTIVE" },
  { match: ["direktör", "direktør", "directeur", "directrice", "direttore", "direttrice", "diretor", "diretora", "dyrektor", "директор", "direktur", "müdür", "giám đốc", "总监", "總監", "董事", "이사"], tier: "DIRECTOR", department: "UNKNOWN" },
  { match: ["director"], tier: "DIRECTOR", department: "UNKNOWN" },

  // ── Head ────────────────────────────────────────────────────────────────────────────────────
  { match: ["head of sales development", "head of sales dev"], tier: "HEAD", department: "SALES" },
  { match: ["head of growth", "head of business development"], tier: "HEAD", department: "GROWTH" },
  { match: ["head of sales", "vertriebsleiter", "vertriebsleiterin", "leiter vertrieb", "verkaufsleiter", "jefe de ventas", "jefa de ventas", "trưởng phòng kinh doanh"], tier: "HEAD", department: "SALES" },
  { match: ["head of marketing"], tier: "HEAD", department: "MARKETING" },
  { match: ["head of it", "head of infrastructure", "head of infra"], tier: "HEAD", department: "IT" },
  { match: ["head of hr", "head of people"], tier: "HEAD", department: "HR" },
  { match: ["head of", "trưởng phòng", "trưởng bộ phận", "trưởng ban", "chef de service", "chef de département", "afdelingshoofd", "部長", "부장", "실장"], tier: "HEAD", department: "UNKNOWN" },
  // German/Dutch team and project leads before the bare "leiter" (Head).
  { match: ["teamleiter", "teamleiterin", "teamleider", "gruppenleiter", "gruppenleiterin", "chef d'équipe"], tier: "LEAD", department: "UNKNOWN" },
  { match: ["projektleiter", "projektleiterin", "projectleider", "projektledare"], tier: "MANAGER", department: "UNKNOWN" },
  { match: ["leiter", "leiterin"], tier: "HEAD", department: "UNKNOWN" }, // German "Leiter X"

  // ── Lead ────────────────────────────────────────────────────────────────────────────────────
  // "Lead" as the sales object, not the rank.
  { match: ["lead generation manager", "lead gen manager", "leadgen manager"], tier: "MANAGER", department: "SALES" },
  { match: ["lead generation", "lead gen", "leadgen"], tier: "IC", department: "SALES" },
  { match: ["tech lead", "technical lead", "team lead", "lead of"], tier: "LEAD", department: "ENGINEERING" },
  { match: ["supervisor", "superviseur", "supervisora", "foreman", "forewoman", "trưởng nhóm", "giám sát", "係長", "팀장", "主管", "组长", "組長"], tier: "LEAD", department: "UNKNOWN" },
  { match: ["lead"], tier: "LEAD", department: "UNKNOWN" },

  // ── Manager ─────────────────────────────────────────────────────────────────────────────────
  // A general / country manager runs a P&L (the top local executive in most APAC subsidiaries).
  { match: ["general manager", "gm", "country manager", "country head"], tier: "DIRECTOR", department: "EXECUTIVE" },
  { match: ["company secretary"], tier: "MANAGER", department: "LEGAL" },
  { match: ["hr manager", "people manager"], tier: "MANAGER", department: "HR" },
  { match: ["operations manager", "ops manager"], tier: "MANAGER", department: "OPERATIONS" },
  { match: ["store manager", "restaurant manager", "workforce manager", "staffing manager"], tier: "MANAGER", department: "OPERATIONS" },
  { match: ["it manager"], tier: "MANAGER", department: "IT" },
  { match: ["digital manager", "innovation manager", "product manager", "produktmanager", "chef de produit"], tier: "MANAGER", department: "PRODUCT" },
  { match: ["manager", "gerente", "manajer", "pengurus", "quản lý", "phó phòng", "经理", "經理", "課長", "과장", "차장", "kierownik", "менеджер", "responsable", "responsabile", "chef de projet", "encargado", "encargada"], tier: "MANAGER", department: "UNKNOWN" },

  // ── 4. Individual contributors ──────────────────────────────────────────────────────────────
  { match: ["software engineer", "engineer", "developer", "ingenieur", "ingénieur", "ingeniero", "ingeniera", "engenheiro", "ingegnere", "entwickler", "développeur", "desarrollador", "kỹ sư", "lập trình viên"], tier: "IC", department: "ENGINEERING" },
  { match: ["system admin", "network engineer", "network operator", "sysadmin"], tier: "IC", department: "IT" },
  { match: ["security engineer", "soc analyst"], tier: "IC", department: "SECURITY" },
  { match: ["accountant", "kế toán", "buchhalter", "buchhalterin", "comptable", "contador", "contadora", "contable"], tier: "IC", department: "FINANCE" },
  { match: ["hr executive", "human resources executive", "people executive"], tier: "IC", department: "HR" },
  { match: ["hr business partner", "hrbp", "people partner", "talent partner", "talent acquisition partner"], tier: "IC", department: "HR", wholeWord: true },
  { match: ["business partner"], tier: "IC", department: "UNKNOWN", wholeWord: true },
  // "Partner <function>" is a partnerships role, not a partner of the firm.
  { match: ["partner success", "partner development", "partner marketing", "partner enablement", "partner relations", "partner sales", "partner account", "partner program", "partner ecosystem", "partner operations", "partner solutions", "partner technology", "partner integrations", "partner support", "partner channel"], tier: "IC", department: "PARTNERSHIPS", wholeWord: true },
  { match: ["admin executive", "administrative executive"], tier: "IC", department: "ADMIN" },
  { match: ["admin", "administrative", "administration"], tier: "IC", department: "ADMIN" },
  { match: ["consultant", "consultor", "consultora", "berater", "beraterin", "conseiller", "conseillère", "advisor", "adviser", "analyst", "analyste", "analista", "architect", "designer", "scientist", "researcher", "representative", "sales rep", "officer", "clerk", "secretary", "staff", "referent", "referentin", "sachbearbeiter", "sachbearbeiterin", "mitarbeiter", "mitarbeiterin", "nhân viên", "chuyên viên", "担当", "담당", "사원"], tier: "IC", department: "UNKNOWN", wholeWord: true },
  { match: ["specialist", "associate", "assistant", "coordinator", "executive", "especialista", "asistente", "assistente", "coordinador", "coordinadora", "coordenador", "coordenadora"], tier: "IC", department: "UNKNOWN" },

  // ── Whole-word fallbacks: only when nothing above matched ───────────────────────────────────
  // "Head, Sales" / "Regional Head - BD"; "Partner, Sequoia" / "Partner at McKinsey" (the title must
  // open with it: "Channel Partner", "Technology Partner" are not partners of the firm); "Principal".
  { match: ["head", "kepala", "jefe", "jefa"], tier: "HEAD", department: "UNKNOWN", wholeWord: true },
  { match: ["partner"], tier: "OWNER", department: "EXECUTIVE", wholeWord: true, atStart: true },
  { match: ["principal"], tier: "DIRECTOR", department: "UNKNOWN", wholeWord: true },
];

/**
 * Phrases that contain a rank word without naming the person's rank. They are removed from the title
 * before the taxonomy runs, so a real rank elsewhere wins ("Director, Office of the CEO" is a
 * director; "Owner / Product Owner" is an owner), and they classify the title only when nothing else
 * does ("CEO Office" alone is staff; "Product Owner" alone is a manager).
 */
export const SENIORITY_MASKS: readonly SeniorityEntry[] = [
  { match: ["office of the ceo", "office of the president", "office of the chairman", "office of the managing director", "ceo office", "ceo's office", "president's office", "chairman's office", "director's office", "md office"], tier: "IC", department: "ADMIN" },
  { match: ["product owner"], tier: "MANAGER", department: "PRODUCT" },
  { match: ["process owner", "experience owner", "service owner", "system owner", "data owner", "application owner", "platform owner", "risk owner", "control owner", "content owner", "budget owner", "technical owner", "feature owner", "account owner"], tier: "MANAGER", department: "UNKNOWN" },
];

// v2 (2026-10-10): worldwide titles, accent folding, guards for former/intern/assistant-to,
// president/chairman/board, GM/country manager. See docs/scoring/TAXONOMY_2026-10.md.
export const SENIORITY_DICTIONARY_VERSION = "seniority-v2";

export type SeniorityLookup = {
  tier: SeniorityTier;
  department: Department;
  matchedKeyword: string | null;
};

type MatchOptions = { wholeWord?: boolean; atStart?: boolean };

/**
 * Match a taxonomy keyword against a title. Both sides are accent-folded.
 * 2-3 letter acronyms (ceo, coo, cco, vp, cto…) always match as a WHOLE WORD — otherwise
 * they false-fire as substrings: "cco" inside "a-cco-unt", "coo" inside "co-o-rdinator",
 * "cro" inside "mi-cro-soft" — which mis-classified Account Executives / Managers as
 * C_LEVEL. Other keywords are substrings unless the entry asks for whole words or the title start.
 */
export function matchesSeniorityKeyword(lowerTitle: string, keyword: string, options: MatchOptions = {}): boolean {
  return matchesFolded(foldForMatch(lowerTitle), foldForMatch(keyword), options);
}

function matchesFolded(foldedTitle: string, foldedKeyword: string, options: MatchOptions): boolean {
  if (!foldedKeyword) return false;
  if (options.atStart) return containsFoldedTerm(foldedTitle, foldedKeyword, { atStart: true });
  if (options.wholeWord || /^[a-z]{2,3}$/.test(foldedKeyword)) return containsFoldedTerm(foldedTitle, foldedKeyword);
  return foldedTitle.includes(foldedKeyword);
}

// Keywords folded once, at load.
const compile = (entries: readonly SeniorityEntry[]) =>
  entries.flatMap((entry) => entry.match.map((keyword) => ({ entry, keyword, folded: foldForMatch(keyword) })));
const COMPILED = compile(SENIORITY_TAXONOMY);
const COMPILED_MASKS = compile(SENIORITY_MASKS);

/**
 * Resolve a raw title into a seniority tier + department.
 * Ordered taxonomy, first hit wins (see matchesSeniorityKeyword).
 * Returns UNKNOWN/UNKNOWN with matchedKeyword=null when nothing matches.
 */
export function lookupSeniority(rawTitle: string): SeniorityLookup {
  const title = foldForMatch(String(rawTitle ?? ""));

  if (!title) {
    return { tier: "UNKNOWN", department: "UNKNOWN", matchedKeyword: null };
  }

  // Remove mask phrases first; the first one found is the answer only if nothing else matches.
  let masked = title;
  let maskHit: SeniorityLookup | null = null;
  for (const { entry, keyword, folded } of COMPILED_MASKS) {
    if (!containsFoldedTerm(masked, folded)) continue;
    maskHit ??= { tier: entry.tier, department: entry.department, matchedKeyword: keyword };
    masked = stripFoldedTerm(masked, folded);
  }

  for (const { entry, keyword, folded } of COMPILED) {
    if (matchesFolded(masked, folded, entry)) {
      return { tier: entry.tier, department: entry.department, matchedKeyword: keyword };
    }
  }

  return maskHit ?? { tier: "UNKNOWN", department: "UNKNOWN", matchedKeyword: null };
}

/** True when `candidate` is at least as senior as `floor`. */
export function meetsSeniorityFloor(
  candidate: SeniorityTier,
  floor: SeniorityTier
): boolean {
  return SENIORITY_RANK[candidate] >= SENIORITY_RANK[floor];
}
