import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
const migration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260906010000_campaign_prospect_memberships',
    'migration.sql'
  ),
  'utf8'
);

describe('CampaignProspect schema foundation', () => {
  it('models campaign membership separately from the reusable pool identity', () => {
    expect(schema).toContain('model CampaignProspect {');
    expect(schema).toContain('poolItem   LeadPoolItem @relation');
    expect(schema).toContain('campaign   Campaign @relation');
    expect(schema).toContain('@@unique([tenantId, campaignId, poolItemId])');
  });

  it('allows one pool identity to participate in multiple campaigns', () => {
    expect(schema).toContain('campaignProspects CampaignProspect[]');
    expect(schema).not.toContain('@@unique([tenantId, poolItemId])');
  });

  it('keeps ICP truth on the campaign membership', () => {
    expect(schema).toContain('assessedIcpVersionId String?');
    expect(schema).toContain('latestAssessmentId   String?');
    expect(schema).toContain(
      'fields: [latestAssessmentId, tenantId, poolItemId, assessedIcpVersionId], references: [id, tenantId, poolItemId, icpVersionId], onDelete: SetNull'
    );
    expect(migration).toContain(
      'FOREIGN KEY ("latestAssessmentId", "tenantId", "poolItemId", "assessedIcpVersionId")'
    );
    expect(migration).toContain(
      'CHECK ("latestAssessmentId" IS NULL OR "assessedIcpVersionId" IS NOT NULL)'
    );
  });

  it('documents stale ICP semantics when a campaign changes configuration', () => {
    expect(schema).toContain('This is the version used by latestAssessment');
    expect(schema).toContain('a mismatch means stale/Review until rescore updates both');
  });

  it('prevents a campaign membership from linking an execution lead from another campaign', () => {
    expect(schema).toContain('references: [id, tenantId, campaignId]');
    expect(migration).toContain(
      'FOREIGN KEY ("leadId", "tenantId", "campaignId") REFERENCES "Lead"("id", "tenantId", "campaignId")'
    );
  });

  it('nulls optional references without nulling tenant or campaign keys', () => {
    expect(migration).toContain('ON DELETE SET NULL ("assignedSdrId")');
    expect(migration).toContain('ON DELETE SET NULL ("createdById")');
    expect(migration).toContain('ON DELETE SET NULL ("leadId")');
    expect(migration).toContain('ON DELETE SET NULL ("latestAssessmentId")');
    expect(migration).not.toMatch(/ON DELETE SET NULL ON UPDATE/);
  });

  it('keeps the migration additive and tenant-safe', () => {
    expect(migration).toContain('CREATE TABLE "CampaignProspect"');
    expect(migration).toContain(
      'FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId")'
    );
    expect(migration).toContain(
      'FOREIGN KEY ("poolItemId", "tenantId") REFERENCES "LeadPoolItem"("id", "tenantId")'
    );
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/i);
  });
});
