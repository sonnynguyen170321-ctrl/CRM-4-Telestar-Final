# Product

## Register

product

## Users

Mixed go-to-market team, **SDR-led** — design decisions break ties in favor of the daily rep.

- **SDRs (primary):** live in the leads workspace and Unibox all day. Import lists, work qualified leads, research prospects, compose + send outreach, read replies. Value density, speed, keyboard-first flow, and the fewest possible route-hops between "here's a lead" and "message sent."
- **Sales managers:** review, qualify/approve, and read pipeline + outreach dashboards. Value clarity and decision-support over raw density.
- **Ops / admins:** configure ICPs, senders, ingestion, and the AI engine. Value correctness, guardrails, and honest system state.

Context: a B2B lead-generation intelligence platform (TeleStar SDR OS V2) used during focused prospecting and outreach sessions, often for Vietnamese + English markets (identity matching normalizes Vietnamese company forms). Users are business people, not engineers.

## Product Purpose

Turn a raw company list into qualified, contactable pipeline and booked meetings — ingest → enrich → score against an ICP → review → outreach → reply — inside one operating system. The scoring/intelligence engine ranks and explains fit; the workspace lets a rep act on it without leaving the flow. Success = a rep can go from import to a sent, on-brand, personalized email (and see the reply) with minimal navigation, and trust every number the UI shows.

## Brand Personality

Premium, confident, and modern — **and** calm, clear, and approachable. Apollo/Clay-grade craft without the coldness: a serious sales tool that a non-technical business user finds legible and even pleasant. Voice is plain-spoken and human ("Find email + phone", "Why this prospect", "Seen before"), never a database dump. Confident enough to commit to strong defaults; calm enough to never overwhelm.

## Anti-references

- **Engineer UI / IT jargon.** No raw enum labels, `Code: X` error dumps, internal field names, or unit-of-record leakage in the business surfaces. Every state gets a human label and, on failure, a next action.
- **Generic SaaS-cream / AI slop.** No warm-neutral near-white "paper/sand" body, identical icon-heading-text card grids, or tracked-uppercase eyebrows on every section.
- **Cluttered enterprise (SAP-like).** No dense grey grids with no hierarchy, endless toolbars, or joyless walls of fields. Density must always come with hierarchy and breathing room.
- **Toy / consumer-cute.** No pastel rounded-everything, playful mascots, or illustration-led whimsy that undercuts B2B trust.

## Design Principles

1. **Speak business, not schema.** The interface talks like a salesperson. Resolve human names (never an email as a name), translate every status to plain language, and turn errors into a fix ("Missing provider key → add it"), not a code. If a business user would need a glossary, it's wrong.
2. **Dense, but with hierarchy.** It's an SDR power tool: pack information where that earns throughput, keyboard-drive the tables. But rhythm, grouping, and one clear primary action per surface keep it calm — density is never an excuse for clutter.
3. **One unit, one truth.** The `LeadAssignment` (Company × Project × ICP) is the spine — the same company can be worked for many ICPs/offers, and there is no global company score. The UI reflects real, persisted state (counts, qualification, NOT_SCORED) and never invents a status or number to fill a space.
4. **Premium through restraint.** Polish comes from a consistent semantic-token system with full light/dark parity, considered spacing, and purposeful motion — not decoration. When a choice risks reading as "AI made this," pick the less obvious, more committed one.
5. **Act in place.** Minimize route-hopping. Surface the next step where the user already is — the pipeline cockpit runs enrichment inline, the drawer composes without leaving the record, the Unibox threads sent + received together. The tool comes to the work, not the other way around.

## Accessibility & Inclusion

Target **WCAG 2.1 AA** with full **light + dark-mode parity**. Body text ≥ 4.5:1 (large text ≥ 3:1) against its background in both themes; status colors carry a non-color cue (label/icon), not hue alone. Keyboard navigation on every table and drawer (j/k, Enter, Cmd+K); visible focus. Respect `prefers-reduced-motion` with a crossfade/instant fallback for every animation. Copy and identity handling account for Vietnamese diacritics and English side by side.
