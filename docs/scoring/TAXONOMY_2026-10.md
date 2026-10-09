---
classification: CURRENT_REFERENCE
---

# Title, industry and niche taxonomy — 2026-10 update

Owner request (2026-10-10): "do a worldwide market research to update the tool intelligence for
title, industry, niche, vertical". This records what the research found, what changed in the scoring
dictionaries, the judgement calls, and the measured effect. The dictionaries themselves are the truth:
`packages/core-scoring/src/rules/dictionaries/` (`seniority.ts`, `industry.ts`, `servedVertical.ts`,
`termMatch.ts`). If this page and the code disagree, the code wins.

## After deploying: rescore

Verdicts move for existing leads (same evidence, new dictionaries), so the verdict versions were
bumped and every lead needs a fresh assessment. The owner runs, after the deploy:

- **Leads → Rescore all**, or
- `npx tsx scripts/backfill-lead-icp.ts --all` (preview: counts and the verdict moves), then
  `npx tsx scripts/backfill-lead-icp.ts --all --apply`.

Until then the stored verdicts are the old ones. A rep's own verdict still wins over a rescore.

## Versions

| Constant | Before | After |
|---|---|---|
| `ICP_VERDICT_VERSION` (`lib/leadgen/weightedQualification.ts`) | `weighted-v2` | `weighted-v3` |
| `POINTS_VERDICT_VERSION` (`lib/leadgen/pointsQualification.ts`) | `points-v2` | `points-v3` |
| `SENIORITY_DICTIONARY_VERSION` | `seniority-v1` | `seniority-v2` |
| `INDUSTRY_DICTIONARY_VERSION` | `industry-v1` | `industry-v2` |
| `SERVED_VERTICAL_VERSION` | `served-vertical-v3` | `served-vertical-v4` |

The verdict versions are hashed into the assessment fingerprint; without the bump a rescore would
find the old assessment (evidence and ICP unchanged) and hand back the old verdict.

## Sources

Title conventions and seniority ladders:

- LinkedIn Sales Navigator seniority levels (Owner/Partner, CXO, VP, Director, Experienced/Entry
  Manager, Senior, Entry, In Training) — https://skylead.io/blog/sales-navigator-account-filters/ ,
  https://expandi.io/blog/linkedin-sales-navigator-filters/
- Apollo seniority values (owner, founder, c_suite, partner, vp, head, director, manager, senior,
  entry, intern) — https://docs.nexla.com/user-guides/connectors/apollo_api/apollo_api_data_source ,
  https://knowledge.apollo.io/hc/en-us/articles/4409500253837-Create-a-Persona
- Corporate titles across countries (Korea, Japan, Germany, Nordics) — https://en.wikipedia.org/wiki/Corporate_title
- Germany: Geschäftsführer / Vorstand / Prokurist / Bereichs- and Abteilungsleiter —
  https://proz.com/kudoz/german-to-english/law-general/1558316-gesch%C3%A4ftsf%C3%BChrer-of-a-gmbh.html ,
  https://www.justiz.nrw/BS/recht_a_z/P/Prokura ,
  https://stepstone.de/magazin/artikel/unterschied-geschaeftsfuehrung-und-geschaeftsleitung
- France: PDG, directeur général, gérant (SARL), président (SAS) —
  https://en.wikipedia.org/wiki/Pr%C3%A9sident-directeur_g%C3%A9n%C3%A9ral_(France) ,
  https://vitrinelinguistique.oqlf.gouv.qc.ca/21481/les-emprunts-a-langlais/emprunts-integraux/les-equivalents-francais-de-chief-executive-officer
- Spain / Italy: consejero delegado, amministratore delegato —
  https://www.mariscal-abogados.com/tag/roles-spanish-companies/ ,
  https://www.money.it/ceo-significato-acronimo-chi-e-cosa-fa-amministratore-delegato
- Vietnam: Tổng giám đốc, Giám đốc điều hành, Phó tổng giám đốc, Trưởng phòng —
  https://www.worldtraderef.com/vietnam/business-culture/business-titles.html ,
  https://theleader.vn/phan-biet-cac-thuat-ngu-danh-xung-trong-quan-tri-doanh-nghiep-d25517.html
- Japan: 代表取締役, 社長, 執行役員, 部長, 課長 —
  https://japan-dev.com/blog/company-positions-and-job-titles-in-japanese
- Korea: 대표이사, 사장, 부사장, 전무, 상무, 이사, 부장, 팀장, 과장 —
  https://www.kellerexecutivesearch.com/insight/korean-job-titles-explained , https://linguasia.com/korean-job-titles
- China: 董事长, 总经理, 总裁, 副总裁, 总监, 经理, 创始人 —
  https://www.bluente.com/blog/decoding-chinese-business-titles-the-ultimate-list-of-corporate-hierarchy-and-functional-roles
- Indonesia: Direktur Utama, Presiden Direktur, Komisaris —
  https://news.republika.co.id/berita/rbgjvf380/ceo-dan-direktur-apakah-sama

Industry taxonomies:

- LinkedIn Industry Codes V2 (434 industries, 6-level hierarchy) —
  https://learn.microsoft.com/en-ca/linkedin/shared/references/reference-tables/industry-codes-v2 ;
  flat list used for the fixture: https://jobspipe.dev/blog/linkedin-industries-list
- GICS 2023 structure (11 sectors, 25 groups, 74 industries, 163 sub-industries; payment processing
  moved to Financials) — https://press.spglobal.com/2022-03-31-S-P-DOW-JONES-INDICES-AND-MSCI-ANNOUNCE-REVISIONS-TO-THE-GLOBAL-INDUSTRY-CLASSIFICATION-STANDARD-GICS-R-STRUCTURE-IN-2023 ,
  https://msci.com/gics
- NAICS (used for sector boundaries: printing and shipbuilding are manufacturing, postal and courier
  are transportation/warehousing).

The LinkedIn V2 label list (plus the common V1 labels still on older pages) is committed as a test
fixture: `packages/core-scoring/src/rules/dictionaries/__tests__/__fixtures__/linkedin-industries-v2.txt`.
It is public taxonomy, not production data.

## What changed

### Matching (`termMatch.ts`, new)

- **Accent folding** for titles and industries: "Giam doc" meets "giám đốc", "Geschaftsfuhrer" meets
  "geschäftsführer". Letters NFD does not decompose (`đ ł ø æ œ ß ı`) are mapped explicitly.
- **Whole-word industry matching** (Unicode letter/number edges, plural `s`/`es` accepted). v1 matched
  by substring, and the LinkedIn fixture showed what that did: "Hospitality" → HEALTHCARE ("hospital"),
  "Urban Transit Services" → IT_SERVICES ("it services"), "Credit Intermediation" → MEDIA,
  "Alternative Dispute Resolution" and "Waste … Disposal" → ISP, "Golf Courses" → EDUCATION.
- Chinese, Japanese, Korean, Thai, Lao, Khmer and Myanmar terms match as substrings — those scripts
  have no word edges ("영업부장" contains "부장").
- Seniority keywords stay **substring by default** — German compounds depend on it ("Vertriebsleiter"
  contains "Leiter") — with two per-entry options: `wholeWord` (for "intern", "partner", "socio"…)
  and `atStart` (for "former", "ex-", "retired").

### Industry dimension (`industryScore.ts`) — matcher fix

The known defect from the 2026-10-08 session log ("display" → ISP) is fixed in all three places:

- ICP target / sub-industry / excluded entries and industry keywords match the evidence text at the
  **start of a word**: an entry of 4+ letters matches any word that begins with it ("tech" →
  "technology", "health" → "healthcare", "educat" → "educational"; a final "e" is optional, so
  "finance" → "financial"), a shorter entry only as a whole word (plural allowed). An excluded "bet" no
  longer zeroes every company that writes "alphabet", "ISP" no longer matches "display", "AI" is not in
  "email" or "airline", and "tech" is never found mid-word ("biotech"). The evidence text is folded once
  per lead.
- ICP shorthand (`INDUSTRY_SHORTHANDS`): "Tech" / "Technology" / "High-tech" name SOFTWARE, SAAS,
  IT_SERVICES, CLOUD_HOSTING and CYBERSECURITY; "IT" names IT_SERVICES, CLOUD_HOSTING and
  CYBERSECURITY; "Security" names CYBERSECURITY. Keywords get the same canonical rescue.
- New: an entry that names a canonical industry matches a company of that industry ("Bank" → BANKING,
  "Clinics" → HEALTHCARE). **Targets** accept the company's key or any parent ("IT services" admits a
  cybersecurity vendor); **exclusions** match the company's own key only, so excluding "IT services"
  does not exclude every CYBERSECURITY / CLOUD_HOSTING company that sits under IT_SERVICES.

### Seniority (`seniority.ts`)

Read the taxonomy top to bottom; first match wins.

1. **Guards** — titles that contain a senior word without being senior:
   - former / ex- / retired / aspiring / open to work → `UNKNOWN`, only at the start of the title, so
     a headline "Founder | ex-Google" is still a founder;
   - interns, trainees, apprentices, working students (EN, DE, FR, ES, PT, IT, VI, ZH, JA, KO) → `IC`,
     whole word, so "International" and "Internal" are untouched;
   - assistant to / PA to / EA to / secretary to / "<role> assistant", plus DE "Assistenz der
     Geschäftsführung", FR "assistant(e) de direction", VI "trợ lý", ZH "助理" → `IC` / ADMIN;
   - **masks** (`SENIORITY_MASKS`): "office of the CEO", "CEO office", "director's office", "product
     owner" and other process owners are removed from the title before the taxonomy runs, so a real
     rank elsewhere wins ("Director, Office of the CEO" → DIRECTOR, "Owner / Product Owner" → OWNER);
     they decide only when nothing else matches ("CEO Office" → IC/ADMIN, "Product Owner" → MANAGER);
   - chief of staff, "right hand" / "bras droit", chief representative → `DIRECTOR` / EXECUTIVE;
   - "lead generation" → `IC` / SALES ("Lead Generation Manager" → MANAGER).
2. **C-suite**: added CGO, CBO, chief sales/customer/people/data/AI/legal, CHRO, CDO, CAIO, CSO, CXO,
   "C.E.O". "Chief accountant" / "kế toán trưởng" → `MANAGER` / FINANCE (v1 intended IC but its entry
   sat behind the bare "chief").
3. **Founders / owners / partners** in 15+ languages; managing / founding / senior / equity / general
   / audit / tax / venture / operating partner → `OWNER`; "partner success / development / marketing…"
   are partnerships roles → `IC`.
4. **VP**: vice-president spellings, GVP, RVP, Vizepräsident, Phó tổng giám đốc, 副总裁, 副总经理,
   執行役員, 부사장, 전무, 상무. Assistant VP, assistant / deputy GM and country manager → `MANAGER`.
5. **CEO equivalents** → `C_LEVEL`: managing / general director, director general, directeur général,
   PDG, gérant, consejero delegado, amministratore delegato, VD, administrerende direktør,
   toimitusjohtaja, algemeen directeur, gerente general, prezes zarządu, генеральный директор, genel
   müdür, direktur utama, presiden direktur, pengarah urusan, tổng giám đốc, giám đốc điều hành, 总经理,
   代表取締役, 대표이사.
6. **President, chairman** → `C_LEVEL`; **board member / non-executive director / supervisory board /
   komisaris / 取締役** → `DIRECTOR` / EXECUTIVE; board **of advisors** → `IC`.
7. **Director / head / lead / manager** translations, and VN functional directors (giám đốc kinh
   doanh → SALES director; giám đốc tài chính / công nghệ / vận hành → the C-suite role).
8. **General manager, GM, country manager / head** → `DIRECTOR` / EXECUTIVE (was `MANAGER`).
9. **Whole-word fallbacks**, only when nothing else matched: "head" (headline style "Head, Sales") →
   `HEAD`, "partner" only when the title opens with it ("Partner at McKinsey"; "Channel Partner" is not)
   → `OWNER`, "principal" → `DIRECTOR`.

Persona synonyms (`personaScore.ts`): CGO ↔ chief growth officer, CBO ↔ chief business officer.

### Industry (`industry.ts`)

- No new `INDUSTRY_KEYS` (see proposals below). LinkedIn V2 labels, NAICS/GICS sector names and
  Vietnamese aliases were mapped onto the existing 33 keys.
- Bare nouns that name more than one industry were removed: "security" (guards and patrols — LinkedIn
  "Security and Investigations"), "property" (intellectual property), "production" (film/media),
  "water" (bottled drinks), "infrastructure" (civil), "courses" (golf), "hotels" on FNB (moved to
  HOSPITALITY).
- CYBERSECURITY is checked before SOFTWARE ("Data Security Software Products"), CRYPTO before FINANCE
  ("decentralized finance" was unreachable in v1).
- Test invariant: every alias canonicalises to its own key — no alias is dead behind an earlier entry.

### Niche verticals (`servedVertical.ts`)

Fifteen leaves for the niches B2B outbound prospects most: CX & contact-center tech (CCaaS,
conversational AI), sales tech & CRM, ERP & business apps, communications platforms (CPaaS/UCaaS),
RegTech/KYC/fraud, veterinary, fitness & wellness, auto dealers & aftermarket, consumer electronics,
coworking, courier & parcel, accounting & audit firms, market research, facilities & security
services, language schools — with Vietnamese aliases where the market uses them.

## Measured before / after

`scripts/taxonomy-coverage.ts` (no DB, no network) runs the real `lookupSeniority` /
`canonicalizeIndustry` over a "value | count" file and diffs against a saved run.

**Production titles** (2026-10 export; 496 distinct titles, 1,956 leads; aggregates only — the export
is not committed):

| Tier | Before (titles / leads) | After (titles / leads) |
|---|---|---|
| C_LEVEL | 144 / 979 | 151 / 997 |
| OWNER | 74 / 346 | 69 / 336 |
| VP | 58 / 143 | 58 / 143 |
| DIRECTOR | 96 / 241 | 102 / 256 |
| HEAD | 60 / 153 | 65 / 161 |
| LEAD | 9 / 9 | 8 / 8 |
| MANAGER | 25 / 36 | 27 / 38 |
| IC | 12 / 13 | 14 / 15 |
| unmatched | **18 / 36 (1.8%)** | **2 / 2 (0.1%)** |

- Newly matched: 16 titles / 34 leads (president, chairman, board member, headline-style "Head, …",
  "c.e.o", entrepreneur).
- Moved up or sideways: 5 titles / 10 leads (a CBO/CSO/CDO abbreviation now read as C-level where the
  founder word used to win — same rank; a general manager MANAGER → DIRECTOR; one two-role title now
  read by its "president" half).
- **Lost seniority: 7 titles / 9 leads**, every one by a guard written for it: an assistant to the CEO
  (C_LEVEL → IC); a "right hand of the CEO" role (C_LEVEL → DIRECTOR, 3 leads); a chief of staff
  (C_LEVEL → DIRECTOR); three "experience owner" process roles (OWNER → MANAGER, or DIRECTOR where the
  title also says "principal"); a lead-generation
  representative (LEAD → IC). None of them is the decision-maker the old tier claimed.

This export is a curated decision-maker list (two-thirds C-level or owner), so its unmatched rate was
already low. The larger gains are in uploads the export does not contain — junior and assistant titles
(now caught by the guards) and non-English titles (previously almost all unmatched); the unit tests
carry those cases.

**LinkedIn industry labels** (fixture, 450 labels): unmapped **227 (50.4%) → 116 (25.8%)**; 115 newly
mapped; 20 moved to a better key (the substring defects above); 4 deliberately unmapped (three
physical-security labels that v1 called CYBERSECURITY, and "Alternative Dispute Resolution" that v1
called ISP).

## Impact on the two live ICPs

Measured old (origin/main) against new code, dimension by dimension, over the production lead
industries (66 LinkedIn labels, 2,408 lead-label rows) and titles (496 titles, 1,956 leads). Only the
industry label was used as evidence; descriptions and research text were not part of the export
(see the caveat below).

**"TeleStar ICP v3"** (titles + excluded countries, no industry rules) and **"Telestar v2"** titles:
**0 leads** flip between allowlisted and not, in either direction.

**"Telestar v2" industry** (targets Tech / Software / SaaS; excludes service / bpo / consultant):

| Industry label | Leads | Target match old → new | Score old → new |
|---|---|---|---|
| computer & network security / computer and network security | 63 | no → **yes** | 20 → 95 |
| biotechnology | 11 | yes → **no** | 95 → 20 |

All other labels: no change in target match or score. **Exclusion flips: 0.** "service" excludes the
same labels under both versions: information technology & services (354 leads), financial services
(46), information services (12), environmental services (5), consumer services (2).

- The 11 biotechnology leads matched "Tech" in v1 only through the substring "bio-**tech**-nology".
  Biotech is life sciences, not the software/IT market the ICP names, so the loss is accepted.
- "Tech" did not match software and IT labels by itself in v1 either ("computer software" matched
  through "Software"). Whole-word matching alone would have made "Tech" match nothing, so ICP
  shorthand was added (`INDUSTRY_SHORTHANDS`): "Tech", "Technology", "High-tech" name SOFTWARE, SAAS,
  IT_SERVICES, CLOUD_HOSTING and CYBERSECURITY; "IT" names IT_SERVICES, CLOUD_HOSTING and
  CYBERSECURITY. That is where the 63 cybersecurity leads come from.
- "internet" (110 leads) has no key and stays unmatched under both versions.
- **Verdict effect** (default weights industry 15 / persona 30, thresholds 75 / 45, computed with the
  real verdict code): each of the 74 leads moves **one step**, never Fit ↔ No fit. With an allowlisted
  title the industry moving 20 → 95 takes the fit score 73 → 98 (Review → Fit; biotechnology goes
  back, Fit → Review); with a title off the allowlist it is 23 → 48 (No fit → Review, and back for
  biotechnology). Exclusions, the only fatal industry rule, did not move for any lead.

**Caveat — description text.** In scoring, the industry lists also run against the company
description and research text. v1 matched "Tech" anywhere inside a word; v2 matches at the start of a
word, so "technology" and "technical" still count and "fintech" / "biotech" no longer do. That
cannot be measured from this export. The rescore preview
(`scripts/backfill-lead-icp.ts --all` without `--apply`) shows the real moves before anything is
written.

**For the owner, not caused by this change:** the v2 exclusion "service" removes every "information
technology & services" company (354 leads) — the label LinkedIn gives most software firms — and,
through the description text, any company that writes "services". An exclusion is fatal to the
verdict. That ICP probably needs "IT services" / "service" taken off its exclusion list.

## Decisions and judgement calls

- **General / country manager → DIRECTOR**, not MANAGER: they run a P&L and are the top local
  executive in most APAC subsidiaries. Assistant / deputy GM stays MANAGER.
- **President, chairman → C_LEVEL; board member → DIRECTOR**. There is no BOARD tier and adding one
  would change the ICP schema; v1 already read "member of the board of directors" as DIRECTOR.
- **Bare "Giám đốc" → DIRECTOR**, mirroring bare "Director". In a Vietnamese SME the unqualified
  "Giám đốc" is often the company head; "Tổng giám đốc" / "Giám đốc điều hành" are C-level.
- **"Former …" → UNKNOWN only at the start** of a title. Anywhere else it usually describes a past
  employer in a headline.
- **Gérant → C_LEVEL** (legal head of a SARL); **Prokurist → DIRECTOR** (authorised signatory, one
  rank below the Geschäftsführer); **"Associé" → OWNER** in French (partner), whole word so the English
  "associate" is untouched.
- **"Health" → HEALTHCARE**, and "Wellness" / "Fitness" with it (LinkedIn V1 "Health, Wellness and
  Fitness"; research splits that label into single words). The side effect: LinkedIn "Retail Health and
  Personal Care Products" reads as HEALTHCARE rather than RETAIL.
- **Gambling stays unmapped** rather than GAMING: an ICP that targets video games must not start
  matching casinos.
- **Wholesale has no key.** "Wholesale Machinery" / "Wholesale Chemical…" now map by the goods
  (MANUFACTURING), as "Wholesale Food and Beverage" → FNB already did in v1.

## Known limitations

- "Director General Affairs" (Japanese/Korean/Vietnamese "General Affairs") reads as C-level via
  "director general".
- Titles naming two roles resolve by the taxonomy order, not by which role is current.
- Department stays UNKNOWN for generic tier matches ("VP of Sales" → VP / UNKNOWN). Inferring it would
  change department-allowlist behaviour and is a separate change.

## Proposed next: new industry keys (not done here)

Adding a key changes more than this dictionary: the research classifier's closed list
(`packages/core-research/src/classifyPrompt.ts`, `companyClassification.ts`), the research sector
families (`lib/research/verifyScoring.ts` `SECTOR_FAMILIES`) and target policy
(`packages/core-research/src/targetPolicy.ts`) — and a target that becomes canonical can start
rejecting research candidates. Each should land with those updates and a research re-run:

| Proposed key | Would cover (LinkedIn V2 labels now unmapped) |
|---|---|
| `PROFESSIONAL_SERVICES` | Business Consulting and Services, Accounting, Engineering Services, Design Services |
| `LEGAL` | Legal Services, Law Practice, Alternative Dispute Resolution |
| `STAFFING_HR` | Staffing and Recruiting, Executive Search, Temporary Help, Human Resources Services |
| `BPO_OUTSOURCING` | Telephone Call Centers, Outsourcing and Offshoring Consulting, Translation and Localization |
| `WHOLESALE_DISTRIBUTION` | Wholesale *, Wholesale Import and Export |
| `NONPROFIT` | Non-profit Organizations, Civic and Social, Professional Organizations, Philanthropic Fundraising |
| `SECURITY_SERVICES` | Security and Investigations, Guards and Patrol, Security Systems Services |
| `AUTOMOTIVE` / `AEROSPACE` | today folded into MANUFACTURING |
