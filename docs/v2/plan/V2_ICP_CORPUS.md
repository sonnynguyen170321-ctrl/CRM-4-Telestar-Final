# V2 Multi-ICP Requirement Corpus (18 real client ICPs)

Status: requirement + golden-fixture source for the multi-ICP scoring engine (see
`V2_MASTER_IMPLEMENTATION_PLAN_WORKFLOW_FIRST.md` §4c). These are **real client ICPs** captured verbatim-normalized
so SC2's fixtures have a canonical source (chat is ephemeral). Each entry is normalized into the v2 rule dimensions.
Where a dimension is vague in the source ("exclude too small", "Medium to Medium Well"), it is marked `~` and must be
pinned during SC1/SC2 with the business owner — do not silently invent thresholds.

Legend: Geo · Industry · Type/Vertical · Persona(+include / −exclude / tiers) · Size · Disqualifiers · Notes.

---

## 1. Stormwall (DDoS / network protection)
- Geo: Saudi Arabia, UAE, Turkey, Egypt, Oman, Indonesia, Singapore, Hong Kong, Malaysia, Thailand, Philippines, Vietnam, Laos, India, Pakistan, Bangladesh, North Africa (e.g. Morocco) + Central Africa, **Europe as a whole**. Priority: **richer countries first** (priority tiers).
- Industry: ISP/Telecom, Cloud Hosting, Retail, Banking, E-Commerce, Entertainment, Media, Gaming, IP Telephony. (Any big company with **its own internal network to protect**.)
- Persona +: CISO, CTO, security engineer, system admin, network engineer/operator, general manager.
- Size: exclude too-small `~`.
- Notes: geo includes IN/PK/BD as TARGETS here (contrast with TeleStar where they are excluded) → geo is per-ICP, never global.

## 2. 1CloudHub (cloud / infra services)
- Geo: **Singapore only**.
- Persona +: IT Manager, Head of IT, CTO, CIO, Director of IT, or highest position in Transformation/Infrastructure/Cloud/Digitalization/Migration. Also: System & Infra Lead, Director of Infra Systems & DevOps, Head of Infrastructure, Chief Architect, Lead of DevOps & Cloud Infrastructure, Head of Infrastructure & Solutions Architecture.
- Persona −: **no "engineer" titles**.

## 3. Saigon Technology (software/tech outsourcing)
- Geo: New Zealand, Germany, Australia.
- Industry: Bank, Healthcare, Finance services.
- Persona +: C-level (CEO/COO/CTO…) + strongly tech (or marketing). Keywords: AI, IT, technical, tech lead, information, engineer, software.
- Size: 2–500 (SMEs).

## 4. Dpoint (CDP / loyalty)
- Geo: Vietnam.
- Industry (mainly): Retail, F&B, FMCG.
- Persona +: C-levels (CEO/COO/CMO/founder…) + marketing & customer-oriented. Keywords: Marketing, partnerships, customer experience, alliances, customer success, channel, omnichannel.
- Size: ~Medium → Enterprise.
- Disqualifier (company denylist): **Vinamilk** (avoid).

## 5. STS (Epicor ERP for Manufacturing)
- Geo: **has a FACTORY in Vietnam** (office/factory-location, not HQ).
- Persona +: C-levels, IT Director, Factory Director, Plant Director, Chief Accountant — **production-leaning only** (no logistics, no warehouse). Keywords: Craft, Furniture & Fixture, Plastics & Rubber, Industrial Machinery, Electronics & High-tech, Fabricated Metals.
- Size: ~Medium.

## 6. TeleStar (BPO / B2B outbound) — the primary house ICP
- Geo: Australia, Singapore, Hong Kong, Vietnam, Japan, Ireland, Norway, Switzerland, Denmark, Netherlands, Iceland, Sweden, Finland, UK, Canada, USA, Israel.
- Industry: ALL. Verticals: Tech, Software, SaaS (**exclude services & consulting**).
- Persona +: Founder, CEO, COO, CRO, VP Sales, Head of Sales Dev, Head of Growth, VP Business Development, VP Growth, Head of Growth, Head of Sales, Head of Business Development, Director of Sales, Director of Business Development.
- Size: min 3 employees.
- Disqualifiers (terminal): one-person company · **prospect uses Gmail account** · company has **offices in India/Pakistan/Bangladesh/Philippines** · website offline · services/consulting-based product **EXCEPT Vietnam market only** (conditional exception).

## 7. TeleStar for Design
- Geo: Singapore, Malaysia, Australia, Israel, EU, Canada, Japan.
- Industry: Advertising, Marketing, Media, Software Development, App Development.
- Persona +: CEO, COO, Head/Director of Operations, Head of HR, HR Director, Creative Director, Marketing Director.
- Size: 11–200.

## 8. Cyberstash (cybersecurity)
- Geo: New Zealand, Australia, Singapore, Malaysia (expansion: ANZ, APAC, SEA).
- Persona +: C-levels + tech (IT, CTO, CRO, CISO, SOC, CIO). Keywords: Technology, IT, security, risk, MSP.
- Size: 25–500.
- Special target list (shared-internet facility types): Retirement Communities, Residential Complexes, Educational Institutions, Health & Wellness Centers, Private Libraries/Museums, Community Centers, Vacation Resorts, Religious Institutions, Co-Working Spaces, Specialized Housing, Student Dormitories, Group Homes, Rehabilitation Centers, Large Conference Centers, Publicly-Funded Shelters, Campgrounds, Vacation Rentals, Independent Living Communities, Foster Care Facilities. (Facility-type targeting, not classic industry.)

## 9. Alison (online courses)
- Geo: North America (US, Canada, Mexico), **exclude India**.
- Persona tiers: Tier 1 — CMO, marketing, CEO, founder, creative. Tier 2 — performance, user acquisition, growth, advertising, analytics, media.
- Persona −: Associate, Assistant, Product marketing, Direct marketing, Event marketing, Email marketing, Lifecycle, CRM marketing, Marketing operations, Trade marketing, Content marketing, Integrated marketing, Sales marketing. **No "manager".**
- Company denylist: **Google, Meta, TikTok**.

## 10. Cloudian (data / cloud storage)
- Geo: Vietnam.
- Industry: Banking, Finance, Insurance, Government, Manufacturing, Media & Entertainment, University.
- Persona +: IT/tech. Keywords: CEO, founder, CTO, CIO, IT, Infrastructure, cloud, cybersecurity, information, data, CISO, storage, backup.
- Size: Large → Enterprise (in Vietnam).

## 11. FlexEnergy (utility / electricity distribution)
- Account-supplied: **company list provided by the account** (preapproved; not scored from scratch).
- Industry: Utility, particularly electricity distribution.
- Geo: Switzerland, **German-speaking part** (sub-national).
- Persona + (German): Direktor, Mitglied der Geschäftsleitung, Digital Manager, Innovation Manager, Produktmanager, Leiter Inkasso.

## 12. CoreAI (project-based IT/software)
- Geo: Japan, Singapore, Hong Kong, Switzerland, Germany, Dubai.
- Industry: IT company & Software Development.
- Persona +: C-level (CEO/COO/CTO…), partnerships. Persona −: technical lead, owner.
- Size: min 20 employees.
- Notes: #project #projectbased flag.

## 13. Chainwire (two sub-ICPs)
### 13a Crypto market
- Geo: US. Size: all. Keywords: crypto, cryptocurrency, NFT, DeFi, GameFi, digital assets, decentralized finance, web3.
- Persona +: Marketing dept, content (NOT content writer/creator), community, branding, PR, Communications.
- Industry −: avoid Marketing & Media (competitors), Hospitality, Insurance, Education.
### 13b Cyber market
- Region: APAC, South America. Industry: Computer & Network Security. Size: >50.
- Keywords: cyber, security, DevOps, AI, SSPM, IDS/IPS, protection, antivirus, DDoS (exclude media, healthcare, supply chain).
- Persona +: Marketing/content/community/branding/PR/Communications. Persona −: titles with sales, growth, affiliate, designer.

## 14. 1C (business solutions; per-product personas)
- 1C:Document Management → Trưởng phòng tổ chức hành chính, IT Manager/Director, CEO, COO, CCO, CFO, CMO, CTO.
- 1C:Company Management (mini-ERP) → Sales, Procurement, Manufacturing, IT Manager/Director, CEO, COO, CCO, CFO, CMO, CTO, Chief Accountant.
- 1C:ERP → companies >200 employees, group-type.

## 15. Cosmose (AI-powered shopping / media)
- Geo: Mexico, Spain, Chile.
- Persona tiers (content/media producers, **include managers**): Tier 1 — partnership, VP, editor, content. Tier 2 — sales, BD, CEO, managing director, COO. Keywords: media, publisher, content creator, CEO, founder.

## 16. BiziTrip (corporate travel/mobility)
- Geo: Vietnam. Size: 50+.
- Industry: IT, Software development, Logistics, Financial services, Manufacturing, Transportation.
- Persona +: CEO, CFO, Director (big CXO), HR, Admin — **HR/Admin: any level OK (non-manager allowed)**.

## 17. Antsomi (CDP)
- Industry: Retail, e-commerce (expandable to F&B, Manufacturing like Dpoint/1C).
- Size/Rev: revenue >$1M OR size >50.
- Persona +: CMO, Retail Director/Head, Growth Marketing (Head/VP), Omnichannel. Persona −: **design-related titles**. Keywords: Growth Marketing, Retail.

## 18. Camelo (shift/workforce scheduling)
- Geo: APAC.
- Industry: Hospitality (Restaurants/Cafes/Hotels), Retail, Healthcare, Cleaning Services, Logistics & Warehousing, Manufacturing.
- Size: Enterprise, S&MEs, multi-location businesses.
- Persona +: Owner, CEO, COO, HR Manager, Operations Manager, Workforce/Staffing Manager, Store Manager, Restaurant Manager.

---

## Cross-corpus invariants this proves (feed §4c)
- **Geo is per-ICP, never global**: IN/PK/BD are TARGETS for Stormwall but TERMINAL EXCLUSIONS for TeleStar.
- **Office/factory location ≠ HQ**: STS ("factory in Vietnam"), TeleStar/Stormwall ("offices in …").
- **Persona needs allowlist + denylist + tiers + seniority floor + department overrides + language variants + per-product sets**: Alison, Chainwire, 1C, FlexEnergy, BiziTrip, Cosmose.
- **Conditional market exception**: TeleStar services/consulting OK only in Vietnam.
- **Company denylist (competitors)**: Alison (Google/Meta/TikTok), Dpoint (Vinamilk).
- **Account-supplied lists**: FlexEnergy.
- **Sub-ICPs**: Chainwire (crypto/cyber), 1C (3 products).
- **Qualitative size + revenue**: Dpoint/STS ("Medium…"), Antsomi (rev >$1M), Camelo (multi-location).
