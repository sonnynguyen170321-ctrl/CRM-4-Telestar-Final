/**
 * An `*Id` column with no `@relation` behind it points wherever it likes.
 *
 * Postgres enforces a declared foreign key and nothing else. A field named `leadId` that is not
 * part of a `@relation(fields: [...])` is a string that happens to look like a reference: it can
 * name a row that was deleted, a row in another tenant, or a row that never existed, and nothing
 * — not the database, not Prisma, not a type — will say so.
 *
 * Measured on production 2026-09-18: `AiCall.userId` had 74 of 106 rows naming Users that no
 * longer exist, and `AiCall.leadId` 5 of 31. All of them dated 2026-08-16..22; the valid rows
 * start 08-25. Users were re-seeded in between, and this table kept the old ids because nothing
 * stopped it. Every hard foreign key in the same database came through that re-seed with zero
 * orphans, because they were constraints rather than conventions.
 *
 * This does not forbid the pattern — the codebase uses it 44 times, some of them deliberately.
 * It freezes the list. A new one has to be added here on purpose, which is the moment to ask
 * whether it wants a real relation instead.
 *
 * Deliberately not a migration. Adding constraints to live columns means DDL that takes
 * ACCESS EXCLUSIVE while it validates and fails outright if a single row dangles, on a database
 * deployed by hand. The damage found was historical and has not recurred; a detector is the
 * proportionate answer, and `scripts/check-relational-integrity.ts` is where it runs against
 * real data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');

/**
 * Ids that are not references into this database at all, so a relation would be meaningless.
 * Each one is somebody else's identifier that we store to look up later.
 */
const EXTERNAL_IDS = new Set([
  'AuditLog.recordId', // polymorphic — names a row in whichever table the entry is about
  'InboundMessage.providerMessageId',
  'OutboundMessage.providerMessageId',
  'JobRun.bullJobId', // a BullMQ job id, which lives in Redis
  'Meeting.externalEventId', // the calendar provider's event
  'Opportunity.externalDealId',
]);

/**
 * Columns that do reference a row in this database with nothing enforcing it.
 *
 * Known, frozen, and each one a candidate for a real relation the next time its table is
 * touched. `Task.sequenceId` is the one to look at first: the whole sequence runtime reads it.
 */
const SOFT_FOREIGN_KEYS = new Set([
  'AccountPainHypothesis.accountResearchRunId',
  'AgentAction.campaignId',
  'AgentAction.leadId',
  'AgentApprovalRequest.campaignId',
  'AgentApprovalRequest.leadId',
  'AiCall.leadId',
  'AiCall.userId',
  'AutonomyPolicy.updatedById',
  'CampaignPlaybook.createdById',
  'CampaignPlaybookVersion.approvedById',
  'CampaignPlaybookVersion.createdById',
  'CompanySignal.accountResearchRunId',
  'ContactEvidence.clientId',
  'ContactEvidence.sourceId',
  'EmailAccount.sendPausedById',
  'EmailHealthAlert.acknowledgedById',
  'EmailHealthAlert.resolvedById',
  'Lead.archivedById',
  // Mirror pointer to the latest ICP assessment, soft by the same reasoning as
  // LeadPoolItem.latestAssessmentId: the assessment row holds the hard relation to the lead,
  // and a circular hard FK would make the pair un-deletable in either order.
  'Lead.latestIcpAssessmentId',
  'LeadPoolItem.latestAssessmentId',
  'OutboundMessage.sequenceId',
  'OutcomeSignal.abVariantId',
  'OutcomeSignal.actorUserId',
  'OutcomeSignal.campaignId',
  'OutcomeSignal.leadId',
  'OutcomeSignal.playbookVersionId',
  'OutcomeSignal.sequenceId',
  'PersonalizationHook.contactResearchRunId',
  'PlaybookProposal.campaignId',
  'PlaybookProposal.reviewedById',
  'ProspectTransition.actorUserId',
  'ResearchProspect.lastRunId',
  'ResearchProspect.promotedAccountId',
  'ResearchProspect.promotedContactId',
  'SequenceDraftRecord.aiCallId',
  'SequenceDraftRecord.workOrderId',
  'SequenceLaunch.enrollmentId',
  'SequenceLaunch.taskId',
  'Task.sequenceId',
]);

/** Every `<Model>.<field>Id` in the schema that no `@relation` claims. */
function unconstrainedIdFields(): string[] {
  const found: string[] = [];
  for (const model of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const [, name, body] = model;
    const claimed = new Set<string>();
    // The relation name is optional — `@relation("LeadAssignee", fields: [...])` is the same
    // declaration as `@relation(fields: [...])`, and a pattern that misses it reports real
    // foreign keys as unconstrained. It did, the first time this was written.
    for (const rel of body.matchAll(/@relation\([^)]*fields:\s*\[([^\]]*)\]/g)) {
      for (const field of rel[1].split(',')) claimed.add(field.trim());
    }
    for (const field of body.matchAll(/^\s{2}(\w*Id)\s+\S/gm)) {
      if (!claimed.has(field[1])) found.push(`${name}.${field[1]}`);
    }
  }
  return found.sort();
}

describe('unconstrained id columns', () => {
  const found = unconstrainedIdFields();

  it('parses the schema at all', () => {
    // A guard on the guard: a broken pattern finds nothing and every assertion below passes
    // while checking nothing.
    expect(found.length).toBeGreaterThan(20);
    expect(schema).toContain('model Lead {');
  });

  it('does not see a declared relation as unconstrained', () => {
    // `Lead.assignedToId` is a composite relation with a relation name. If it shows up here the
    // pattern has regressed and the whole list below is noise.
    expect(found).not.toContain('Lead.assignedToId');
    expect(found).not.toContain('Lead.campaignId');
  });

  it('has no unconstrained id that this file does not know about', () => {
    const unknown = found.filter((f) => !SOFT_FOREIGN_KEYS.has(f) && !EXTERNAL_IDS.has(f));
    expect(
      unknown,
      'a new `*Id` column with no `@relation`: give it a real relation, or add it to ' +
        'SOFT_FOREIGN_KEYS (or EXTERNAL_IDS) with a reason'
    ).toEqual([]);
  });

  it('lists nothing that has since been given a relation', () => {
    // The mirror. A stale entry here reads as a known gap that was actually closed, and hides
    // the fact that the list is no longer describing the schema.
    const known = [...SOFT_FOREIGN_KEYS, ...EXTERNAL_IDS];
    const fixed = known.filter((f) => !found.includes(f));
    expect(fixed, 'these now have a relation (or were renamed) — remove them from this file').toEqual([]);
  });
});
