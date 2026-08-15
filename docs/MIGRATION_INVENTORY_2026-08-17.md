# Migration inventory — generated from the current schema, 2026-08-17

Source of truth: `prisma/schema.prisma` at `release/internal-cutover-2026-08-17`.
**62 models**, of which **60 carry `tenantId`**. Regenerate this file if the schema changes.

> `docs/MIGRATION_RUNBOOK.md` is stale and must not be followed mechanically. This file replaces
> its entity list. It describes *what must be reconciled and in what order*; it does not assume a
> particular source export, because the Telestar source data was not available to this session.

## Two models carry no `tenantId`

| Model | Why | Consequence |
| --- | --- | --- |
| `Tenant` | it *is* the tenant | never filtered; correct |
| `PlaybookProposalEvidence` | child of `PlaybookProposal`, inherits tenancy through the parent | the tenant-injection layer derives its model list from DMMF `tenantId` presence, so this table is **not** filtered directly — reachable only through a scoped parent. Verify any new direct query on it scopes via the parent. |

## Load order

Foreign keys make this order mandatory. Each tier depends only on tiers above it.

```
1  Tenant
2  User (self-referencing managerId — insert, then patch managerId in a second pass)
3  Client
4  Campaign
5  CampaignSdr · CampaignLeadRequirement · CampaignPlaybook → CampaignPlaybookVersion
6  Account → Contact
7  LeadPoolItem          (pool — NOT working leads)
8  Template · Sequence → SequenceStep → AbTestVariant
9  Lead                  (needs Campaign, User, Account, Contact)
10 SequenceEnrollment · SequenceStepCopy
11 Task · Note · Reminder · Activity · LeadgenActivity
12 EmailAccount · SuppressionEntry
13 OutboundMessage · InboundMessage
14 BookingLink → Meeting → Opportunity → OpportunityActivity
15 ClientReport → ClientReportRecipient · ClientReportExport · ClientReportShareLink
16 AuditLog · Attachment · Notification
```

`User.managerId` is self-referencing: insert every user with `managerId = null`, then apply the
hierarchy in a second pass. A single-pass insert ordered by role happens to work only while the
hierarchy is strictly Director → Floor Manager → Team Lead → SDR, and silently drops edges the
moment it is not.

## Per-entity reconciliation

Record every row of this table for every entity. A blank cell is an unfinished migration.

| # | Source table/file | Target model | Source count | Target count | Created | Updated | Skipped | Duplicate | Invalid | Unresolved FK | Tenant mapping | Owner mapping | Campaign mapping | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | `Tenant` | | | | | | | | | — | — | — | one row expected |
| 2 | | `User` | | | | | | | | | | `managerId` 2nd pass | — | role must map to the enum, not a title |
| 3 | | `Client` | | | | | | | | | | — | — | |
| 4 | | `Campaign` | | | | | | | | | | — | — | needs `clientId` |
| 5 | | `CampaignSdr` | | | | | | | | | | | | **membership gates import** — see below |
| 6 | | `CampaignLeadRequirement` | | | | | | | | | | — | | ICP lives here, never in the playbook |
| 7 | | `Account` | | | | | | | | | | — | | |
| 8 | | `Contact` | | | | | | | | | | — | | needs `accountId` |
| 9 | | `LeadPoolItem` | | | | | | | | | | | | **must not be mixed with `Lead`** |
| 10 | | `Lead` | | | | | | | | | | `assignedToId` | | `normalizedEmail` uniqueness |
| 11 | | `Template` | | | | | | | | | | — | — | |
| 12 | | `Sequence` | | | | | | | | | | — | | |
| 13 | | `SequenceStep` | | | | | | | | | | — | — | **keep step ids stable** — see below |
| 14 | | `SequenceEnrollment` | | | | | | | | | | | | authoritative execution state |
| 15 | | `Activity` | | | | | | | | | | | | leaderboard/report source of truth |
| 16 | | `LeadgenActivity` | | | | | | | | | | | | |
| 17 | | `Task` | | | | | | | | | | | | |
| 18 | | `Note` | | | | | | | | | | | | |
| 19 | | `Reminder` | | | | | | | | | | | | |
| 20 | | `SuppressionEntry` | | | | | | | | | | — | | **never drop a row** |
| 21 | | `EmailAccount` | | | | | | | | | | | | credentials re-encrypt via `lib/crypto.ts` |
| 22 | | `OutboundMessage` | | | | | | | | | | | | send ledger |
| 23 | | `InboundMessage` | | | | | | | | | | | | reply detection depends on it |
| 24 | | `BookingLink` | | | | | | | | | | — | | |
| 25 | | `Meeting` | | | | | | | | | | | | outcomes must survive |
| 26 | | `Opportunity` | | | | | | | | | | | | stage + value reconcile |
| 27 | | `OpportunityActivity` | | | | | | | | | | | | pipeline history |
| 28 | | `ClientReport` (+ recipients, exports, share links) | | | | | | | | | | | | |
| 29 | | `AuditLog` | | | | | | | | | | | | continuity of record |
| 30 | | `Attachment` | | | | | | | | | | | | |

## Traps specific to this schema

**`CampaignSdr` membership is not cosmetic.** `getVisibleCampaignIds` returns unrestricted (`null`)
only for **director** and **leadgen manager**. Every other role resolves to the campaigns its
visible users are assigned to. A campaign migrated without its membership rows is a campaign that
floor managers, team leads and SDRs cannot file leads or imports against — `POST /api/leads` and,
as of this release, `POST /api/leads/import` both return 403. Migrate `CampaignSdr` **with** its
campaign, never as a later clean-up pass.

**`SequenceStep` ids must be preserved.** Jitter and A/B variant selection are seeded from
`tenantId + sequenceId + stepId + leadId`. New step ids re-roll every send time and re-bucket every
in-flight lead. Migrate steps with their ids; never delete-and-recreate.

**`LeadPoolItem` is not `Lead`.** The pool is pre-qualification inventory; a `Lead` is working
pipeline. Collapsing them inflates the pipeline and corrupts every funnel metric. Reconcile the two
counts separately and assert no source row produced both.

**`Lead.sequenceStatus` is a legacy cache, not truth.** `SequenceEnrollment` is authoritative.
Migrate enrollment state from enrollment data; if the two disagree in the source, the enrollment
wins. Add no new reader or writer of `sequenceStatus`.

**Normalized email uniqueness.** `Lead.normalizedEmail` / `normalizedPhone` / `normalizedLinkedIn`
drive dedupe. Populate them through `lib/leads/normalize.ts`, not by hand — a source row normalized
differently from the app's function is a duplicate that dedupe will not catch.

**Five FK-less attribution columns** (`LeadPoolItem.qualifiedById`, `Lead.archivedById`,
`EmailAccount.sendPausedById`, `EmailHealthAlert.acknowledgedById` / `resolvedById`) reference users
without a foreign key. The database will not keep them consistent. Map them through the same user
mapping as everything else and list unmapped values as exceptions rather than leaving dangling ids.

## Exception report — required output

Never silently discard an invalid row. Every rejected row goes to
`migration-exceptions-<timestamp>.csv`:

```csv
source_table,source_row_id,target_model,reason,field,raw_value,tenant,resolution
```

`reason` is one of: `invalid` · `duplicate` · `unresolved_fk` · `tenant_unmapped` ·
`owner_unmapped` · `campaign_unmapped` · `skipped_by_rule`.

The exception file is a deliverable. Reconciliation reads:

```
source_count == target_count + exceptions_count
```

If that does not hold exactly, the migration has not reconciled — regardless of importer exit code.

## Post-migration invariants

Run `npm run check:relational-integrity`, then confirm:

- every tenant-owned record carries the correct tenant
- no cross-tenant foreign-key relationship exists anywhere
- no orphan user assignment, campaign, lead, account, contact, enrollment, meeting or opportunity
- suppression data survived in full
- lead stages, campaign membership, meeting outcomes and pipeline values reconcile
- `LeadPoolItem` and `Lead` were not mixed
- campaign requirements and leadgen attribution survived
- normalized emails are unique where required

Then sample records **manually** from every major model and read them. Counts reconciling is
necessary, not sufficient.
