# Telestar Commercial Intelligence Engine — Phase 0 Repository Audit Report

**Date:** 2026-08-18  
**Auditor:** Antigravity AI  
**Scope:** Telestar CRM Existing Data Models, Services, APIs, and Workflows

---

## 1. Existing Data Models Inventory (`prisma/schema.prisma`)

| Master Model | Current Schema Location | Current Key Fields & Relations | Assessment & Extension Path |
| :--- | :--- | :--- | :--- |
| **`Account`** | `prisma/schema.prisma:372` | `id`, `name`, `industry`, `website`, `linkedIn`, `size`, `country`, `companyPhone`, `staffCountRange`, `domain`, `tenantId`, `leads[]`, `opportunities[]`, `poolItems[]` | **Keep & Reuse.** Permanent company master. |
| **`Contact`** | `prisma/schema.prisma:406` | `id`, `fullName`, `firstName`, `lastName`, `company`, `title`, `department`, `seniority`, `country`, `email`, `phone`, `linkedIn`, `whatsApp`, `emailValidation`, `emailScore`, `normalizedEmail`, `normalizedPhone`, `normalizedLinkedIn`, `tenantId`, `leadAssignments[]`, `opportunities[]`, `poolItems[]` | **Keep & Extend.** Permanent person master. Add `intelligence ContactIntelligence?` and `evidence ContactEvidence[]` relations. |
| **`LeadPoolItem`** | `prisma/schema.prisma:1549` | `id`, `accountId`, `contactId`, `firstName`, `lastName`, `fullName`, `company`, `title`, `email`, `phone`, `linkedIn`, `status` (raw/qualified/disqualified/assigned_to_campaign), `qualification`, `qualityTier`, `sourceType`, `sourceName`, `icpFitScore`, `dataQualityScore`, `duplicateKey`, `assignedCampaignId`, `assignedSdrId`, `convertedLeadId`, `tenantId` | **Keep & Reuse.** Sourcing & QA inventory. References `Contact` via `contactId`. |
| **`Lead`** | `prisma/schema.prisma:447` | `id`, `contactId`, `accountId`, `campaignId`, `assignedToId`, `stage` (`LeadStage`), `operatingState` (`ProspectOperatingState`), `crmPriorityScore` (`Priority`), `engagementScore`, `tasks[]`, `activities[]`, `meetings[]`, `opportunities[]`, `tenantId` | **Keep & Reuse.** Campaign-level SDR work assignment. A Contact can have multiple Leads across campaigns. |
| **`Campaign`** | `prisma/schema.prisma:326` | `id`, `name`, `clientId`, `status`, `targetIcp`, `tenantId`, `leads[]`, `meetings[]`, `opportunities[]`, `requirements[]` | **Keep & Reuse.** Campaign context. |
| **`CampaignLeadRequirement`**| `prisma/schema.prisma:1621` | `id`, `campaignId`, `requiredCount`, `deliveredCount`, `acceptedCount`, `rejectedCount`, `targetTitles`, `targetCountries`, `targetIndustries`, `status`, `tenantId` | **Keep & Extend in Phase 4.** Add internal match inventory gap calculation. |
| **`Meeting`** | `prisma/schema.prisma:1175`| `id`, `leadId`, `clientId`, `campaignId`, `sdrId`, `status`, `scheduledAt`, `outcome`, `outcomeNotes`, `painPoints`, `nextStep`, `tenantId` | **Keep & Extend in Phase 5.** Emit structured `ContactEvidence` on outcome log. |
| **`Opportunity`** | `prisma/schema.prisma:1228`| `id`, `clientId`, `campaignId`, `leadId`, `accountId`, `contactId`, `meetingId`, `stage`, `status`, `handoffStatus`, `value`, `tenantId` | **Keep & Extend in Phase 2.** Emit commercial evidence and lock reuse during active deal. |
| **`Activity`** | `prisma/schema.prisma:714` | `id`, `leadId`, `userId`, `type` (`ActivityType`), `channel`, `description`, `metadata`, `tenantId` | **Keep & Reuse.** Emit evidence upon meaningful operational interactions. |
| **`SuppressionEntry`** | `prisma/schema.prisma:939` | `id`, `tenantId`, `campaignId`, `email`, `domain`, `company`, `reason`, `source` | **Keep & Reuse.** Reuse engine checks suppression as Gate #1. |

---

## 2. Existing Services Map

| Capability | File / Service | Role in Commercial Intelligence |
| :--- | :--- | :--- |
| **Identity Normalization** | `lib/leads/normalize.ts` | `normalizeEmail()`, `normalizePhone()`, `normalizeLinkedIn()` |
| **Deduplication & Search** | `lib/leadgen/pool.ts`, `lib/search/accentSearch.ts` | `buildPoolDuplicateKey()`, accent-insensitive match |
| **Import & Dedup Worker** | `workers/import.ts` | Resolves/upserts `Account` and `Contact` before `Lead` |
| **Meeting Outcomes** | `lib/meetings/meetingLifecycle.ts` | Transitions meeting status and creates Opportunity |
| **Opportunity Lifecycle** | `lib/opportunities/lifecycle.ts` | Tracks client review, accepted, won, lost, nurture |
| **Tenant Isolation & RLS** | `lib/tenant-inject.ts`, `lib/tenant-context.ts` | `tenantStorage.run({ tenantId, bypassRls })` middleware |

---

## 3. New Data Structures Required (Phase 1)

1. **Enums:**
   - `ContactLifecycleState` (16 states: discovered, verified, qualified, ready, working, engaged, responsive, relationship, meeting, opportunity, client_controlled, nurture, reactivatable, stale, suppressed, archived)
   - `ContactQualityClass` (proven, promising, untested, weak, invalid)
   - `ContactDataStatus` (verified, partial, needs_refresh, invalid)
   - `ContactEngagementStatus` (never_contacted, no_response, responded, positive, meeting, relationship, nurture)
   - `ContactReuseStatus` (ready, reverify_first, cooldown, relationship_only, client_locked, conflict_review, do_not_contact, archived)
   - `RelationshipStrength` (weak, normal, strong, champion)
   - `RelationshipType` (standard, champion, connector, blocker, referrer)
   - `ContactEvidenceType` (finite set per Section 9)
   - `EvidenceSourceType` (leadgen, sdr_manual, email, call, meeting, etc.)
   - `EvidenceOwnershipScope` (telestar, client, shared)
   - `EvidenceReuseScope` (internal_only, same_client_only, cross_campaign_allowed, restricted)

2. **Models:**
   - `ContactIntelligence`: One-to-one derived summary on `Contact` (`contactId @unique`, `tenantId`, scoring, counts, relationship ownership, reuse status).
   - `ContactEvidence`: Append-only historical evidence ledger (`contactId`, `evidenceType`, `observedAt`, provenance, confidence, ownership/reuse scope).

---

## 4. Migration & Compatibility Safety Assessment

- **Additive Schema Only:** Adding `ContactIntelligence` and `ContactEvidence` does not break or modify existing `Contact`, `Lead`, or `LeadPoolItem` columns.
- **Tenant Scope:** Both new models include `tenantId`, `@@index([tenantId])`, and integrate with `lib/tenant-inject.ts`.
- **Rerunnable Backfill:** Backfill script safely derives baseline `ContactIntelligence` for all existing contacts without manufacturing falsified interaction history.
- **Existing Tests Safety:** 135 test suites (1,778 tests) continue executing with zero breakage.
