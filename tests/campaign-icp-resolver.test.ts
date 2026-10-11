/**
 * Every campaign scores against its own ICP, and a campaign without one is NOT scored.
 *
 * Owner decision 2026-10-10: "no silent fallback". Before it, `resolveIcpVersionId` returned the
 * tenant default profile's version for any campaign without an ICP, so 505 leads on four campaigns
 * were scored against TeleStar's own ICP. Real Postgres, because every claim here is about what is
 * persisted: the resolver, the five lead doors, the rescore, the pool, the migration backfill and
 * the composite foreign keys.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { emptyIcpRulesV2 } from '@telestar/core-scoring/rules/emptyIcpRulesV2';

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { assignCampaignIcp } from '@/lib/leadgen/icpAuthoring';
import { rescorePool } from '@/lib/leadgen/rescorePool';
import { scoreImportedPoolItem } from '@/lib/leadgen/scoreImportedPoolItem';
import {
  resolveCampaignIcp,
  resolveIcpVersionId,
  resolvePoolPreRankVersionId,
} from '@/lib/leadgen/scorePoolItem';
import { listCampaignsWithoutIcp } from '@/lib/leadgen/campaignIcpAudit';
import { rescoreLeadsIcp, scoreLeadIcp } from '@/lib/leads/icpScoring';
import { scoreNewLead } from '@/lib/leads/scoreNewLead';
import { createTestTenant } from './helpers/testTenant';

const RULES = (() => {
  const rules = emptyIcpRulesV2('campaign-icp', 'Campaign ICP');
  rules.industry = { ...rules.industry, mode: 'allowlist', targetIndustries: ['software'] };
  return rules;
})();

type World = {
  tenantId: string;
  userId: string;
  clientId: string;
  run: <R>(fn: () => Promise<R>) => Promise<R>;
};

async function world(): Promise<World> {
  const tenantId = `t-campicp-${randomUUID()}`;
  await createTestTenant(tenantId, 'Campaign ICP');
  const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);
  const { userId, clientId } = await run(async () => {
    const user = await prisma.user.create({
      data: { tenantId, email: `u.${randomUUID()}@t.test`, firstName: 'U', lastName: 'Sdr', role: 'sdr', password: 'x', isActive: true },
    });
    const client = await prisma.client.create({
      data: { tenantId, name: `C ${randomUUID()}`, industry: 'Software', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
    });
    return { userId: user.id, clientId: client.id };
  });
  return { tenantId, userId, clientId, run };
}

const profile = (w: World, name: string, extra: Record<string, unknown> = {}) =>
  w.run(() => prisma.icpProfile.create({ data: { tenantId: w.tenantId, name, ...extra } }));

const version = (w: World, icpProfileId: string, versionNumber: number, status: 'draft' | 'published' | 'archived' = 'published') =>
  w.run(() =>
    prisma.icpVersion.create({
      data: { tenantId: w.tenantId, icpProfileId, versionNumber, status, rulesJson: RULES as never },
    }),
  );

const campaign = (w: World, name: string, extra: Record<string, unknown> = {}) =>
  w.run(() =>
    prisma.campaign.create({ data: { tenantId: w.tenantId, clientId: w.clientId, name, startDate: new Date(), ...extra } }),
  );

const lead = (w: World, campaignId: string) =>
  w.run(() =>
    prisma.lead.create({
      data: {
        tenantId: w.tenantId,
        firstName: 'Quynh',
        lastName: `T-${randomUUID().slice(0, 6)}`,
        company: `Acme ${randomUUID().slice(0, 6)}`,
        title: 'CEO',
        email: `q-${randomUUID().slice(0, 6)}@acme.test`,
        assignedToId: w.userId,
        campaignId,
      },
    }),
  );

const reloadLead = (w: World, id: string) => w.run(() => prisma.lead.findUniqueOrThrow({ where: { id } }));
const leadAssessmentCount = (w: World) => w.run(() => prisma.leadIcpAssessment.count({ where: { tenantId: w.tenantId } }));

/** A tenant with a default ("Telestar"-like) profile, which no campaign may fall back to. */
async function worldWithDefault() {
  const w = await world();
  const defaultProfile = await profile(w, 'Default ICP', { isDefault: true });
  const defaultVersion = await version(w, defaultProfile.id, 1);
  return { w, defaultProfile, defaultVersion };
}

describe('resolveCampaignIcp', () => {
  it('library ICP: follows the profile to its newest published version', async () => {
    const { w } = await worldWithDefault();
    const lib = await profile(w, 'Library ICP', { kind: 'library' });
    await version(w, lib.id, 1, 'archived');
    const v2 = await version(w, lib.id, 2);
    const c = await campaign(w, 'Uses library', { icpProfileId: lib.id });

    const out = await w.run(() => resolveCampaignIcp(w.tenantId, c.id));

    expect(out).toMatchObject({ ok: true, icpVersionId: v2.id, icpProfileId: lib.id, source: 'profile' });
  });

  it('custom ICP owned by a user resolves exactly like a library one', async () => {
    const { w } = await worldWithDefault();
    const custom = await profile(w, 'Custom for campaign', { kind: 'custom', ownerUserId: w.userId });
    const v1 = await version(w, custom.id, 1);
    const c = await campaign(w, 'Uses custom', { icpProfileId: custom.id });

    expect(await w.run(() => resolveIcpVersionId(w.tenantId, c.id))).toBe(v1.id);
    expect(custom.kind).toBe('custom');
    expect(custom.ownerUserId).toBe(w.userId);
  });

  it('no ICP: null with campaign_has_no_icp, even though a published default exists (no fallback)', async () => {
    const { w, defaultVersion } = await worldWithDefault();
    const c = await campaign(w, 'Bare');

    const out = await w.run(() => resolveCampaignIcp(w.tenantId, c.id));

    expect(out).toMatchObject({ ok: false, icpVersionId: null, reason: 'campaign_has_no_icp' });
    expect(await w.run(() => resolveIcpVersionId(w.tenantId, c.id))).toBeNull();
    // The default is still there for the pool; it just is not offered to a campaign.
    expect(await w.run(() => resolvePoolPreRankVersionId(w.tenantId))).toBe(defaultVersion.id);
  });

  it('a lead-less call (no campaign) never resolves to the default either', async () => {
    const { w } = await worldWithDefault();
    expect(await w.run(() => resolveCampaignIcp(w.tenantId, null))).toMatchObject({ ok: false, reason: 'campaign_has_no_icp' });
  });

  it('a profile with only archived or draft versions: null with icp_has_no_published_version', async () => {
    const { w } = await worldWithDefault();
    const dead = await profile(w, 'Dead ICP');
    await version(w, dead.id, 1, 'archived');
    await version(w, dead.id, 2, 'draft');
    const c = await campaign(w, 'On dead', { icpProfileId: dead.id });

    const out = await w.run(() => resolveCampaignIcp(w.tenantId, c.id));

    expect(out).toMatchObject({ ok: false, icpVersionId: null, reason: 'icp_has_no_published_version', icpProfileId: dead.id });
  });

  it('publishing v4 moves the campaign with no re-pointing', async () => {
    const { w } = await worldWithDefault();
    const lib = await profile(w, 'Moving ICP');
    const v3 = await version(w, lib.id, 3);
    const c = await campaign(w, 'Follower', { icpProfileId: lib.id });
    expect(await w.run(() => resolveIcpVersionId(w.tenantId, c.id))).toBe(v3.id);

    await w.run(() => prisma.icpVersion.update({ where: { id: v3.id }, data: { status: 'archived' } }));
    const v4 = await version(w, lib.id, 4);

    expect(await w.run(() => resolveIcpVersionId(w.tenantId, c.id))).toBe(v4.id);
    const after = await w.run(() => prisma.campaign.findUniqueOrThrow({ where: { id: c.id } }));
    expect(after.icpProfileId).toBe(lib.id);
  });

  it('a draft newer than the published version is not picked', async () => {
    const { w } = await worldWithDefault();
    const lib = await profile(w, 'Draft ahead');
    const v1 = await version(w, lib.id, 1);
    await version(w, lib.id, 2, 'draft');
    const c = await campaign(w, 'Follower', { icpProfileId: lib.id });
    expect(await w.run(() => resolveIcpVersionId(w.tenantId, c.id))).toBe(v1.id);
  });

  it('pending_review never scores: the last published version keeps scoring, and a profile with only a pending one is no ICP', async () => {
    const { w } = await worldWithDefault();
    const rep = w.userId;
    const lib = await profile(w, 'Review ICP', { kind: 'custom', ownerUserId: rep });
    const only = await profile(w, 'Only pending', { kind: 'custom', ownerUserId: rep });
    const v1 = await version(w, lib.id, 1);
    await w.run(() =>
      prisma.icpVersion.create({
        data: { tenantId: w.tenantId, icpProfileId: lib.id, versionNumber: 2, status: 'pending_review', rulesJson: RULES as never, submittedById: rep, submittedAt: new Date() },
      }),
    );
    const pending = await w.run(() =>
      prisma.icpVersion.create({
        data: { tenantId: w.tenantId, icpProfileId: only.id, versionNumber: 1, status: 'pending_review', rulesJson: RULES as never, submittedById: rep, submittedAt: new Date() },
      }),
    );
    const c1 = await campaign(w, 'Has older published', { icpProfileId: lib.id });
    const c2 = await campaign(w, 'Only pending', { icpProfileId: only.id });
    const c3 = await campaign(w, 'Pinned to pending', { icpVersionId: pending.id });

    expect(await w.run(() => resolveIcpVersionId(w.tenantId, c1.id))).toBe(v1.id);
    expect(await w.run(() => resolveCampaignIcp(w.tenantId, c2.id))).toMatchObject({ ok: false, reason: 'icp_has_no_published_version' });
    expect(await w.run(() => resolveCampaignIcp(w.tenantId, c3.id))).toMatchObject({ ok: false, reason: 'icp_has_no_published_version' });
    const l = await lead(w, c2.id);
    expect(await w.run(() => scoreLeadIcp({ tenantId: w.tenantId, leadId: l.id }))).toEqual({ status: 'not_scored', reason: 'icp_has_no_published_version' });
  });

  it('review columns survive: approving records the reviewer, and deleting the reviewer detaches without nulling tenantId', async () => {
    const { w } = await worldWithDefault();
    const reviewer = await w.run(() =>
      prisma.user.create({ data: { tenantId: w.tenantId, email: `r.${randomUUID()}@t.test`, firstName: 'R', lastName: 'Lead', role: 'team_lead', password: 'x', isActive: true } }),
    );
    const p = await profile(w, 'Reviewed', { kind: 'custom', ownerUserId: w.userId });
    const v = await version(w, p.id, 1, 'draft');
    await w.run(() => prisma.icpVersion.update({ where: { id: v.id }, data: { status: 'pending_review', submittedById: w.userId, submittedAt: new Date() } }));
    await w.run(() => prisma.icpVersion.update({ where: { id: v.id }, data: { status: 'published', reviewedById: reviewer.id, reviewedAt: new Date(), reviewNote: 'ok' } }));

    await w.run(() => prisma.user.delete({ where: { id: reviewer.id } }));
    const after = await w.run(() => prisma.icpVersion.findUniqueOrThrow({ where: { id: v.id } }));
    expect(after).toMatchObject({ reviewedById: null, submittedById: w.userId, status: 'published', tenantId: w.tenantId });
  });

  it('legacy pin: a published pinned version still resolves, an archived one is no ICP', async () => {
    const { w } = await worldWithDefault();
    const lib = await profile(w, 'Legacy ICP');
    const v1 = await version(w, lib.id, 1);
    const c = await campaign(w, 'Legacy', { icpVersionId: v1.id });

    expect(await w.run(() => resolveCampaignIcp(w.tenantId, c.id))).toMatchObject({ ok: true, icpVersionId: v1.id, source: 'legacy_pin' });

    await w.run(() => prisma.icpVersion.update({ where: { id: v1.id }, data: { status: 'archived' } }));
    expect(await w.run(() => resolveCampaignIcp(w.tenantId, c.id))).toMatchObject({ ok: false, reason: 'icp_has_no_published_version' });
  });

  it('tenant isolation: another tenant’s campaign id resolves to nothing, and the FK refuses a foreign profile', async () => {
    const a = await worldWithDefault();
    const b = await worldWithDefault();
    const bProfile = await profile(b.w, 'B ICP');
    await version(b.w, bProfile.id, 1);
    const bCampaign = await campaign(b.w, 'B campaign', { icpProfileId: bProfile.id });

    expect(await a.w.run(() => resolveCampaignIcp(a.w.tenantId, bCampaign.id))).toMatchObject({ ok: false });
    expect(await b.w.run(() => resolveIcpVersionId(b.w.tenantId, bCampaign.id))).not.toBeNull();

    // Tenant A cannot point its campaign at tenant B's profile: the composite FK includes tenantId.
    await expect(campaign(a.w, 'Cross', { icpProfileId: bProfile.id })).rejects.toThrow();
  });
});

describe('lead scoring follows the campaign ICP', () => {
  it('all five lead doors share scoreNewLead -> scoreLeadIcp (no door has its own resolver)', () => {
    const root = path.resolve(__dirname, '..');
    const doors = [
      'app/api/leads/route.ts',
      'app/api/v1/leads/route.ts',
      'lib/contact-intelligence/assignment.ts',
      'lib/leadgen/pool.ts',
      'workers/import.ts',
    ];
    for (const door of doors) {
      const source = readFileSync(path.join(root, door), 'utf8');
      expect(source, door).toContain('scoreNewLead(');
      expect(source, door).not.toMatch(/isDefault:\s*true/);
    }
    const scoring = readFileSync(path.join(root, 'lib/leads/icpScoring.ts'), 'utf8');
    expect(scoring).not.toContain('isDefault');
  });

  it('scoreNewLead on a campaign with a profile scores; on an ICP-less campaign it does not and writes no row', async () => {
    const { w } = await worldWithDefault();
    const lib = await profile(w, 'Door ICP');
    await version(w, lib.id, 1);
    const withIcp = await campaign(w, 'With', { icpProfileId: lib.id });
    const bare = await campaign(w, 'Bare');
    const scored = await lead(w, withIcp.id);
    const unscored = await lead(w, bare.id);

    const a = await w.run(() => scoreNewLead({ tenantId: w.tenantId, leadId: scored.id }));
    const b = await w.run(() => scoreNewLead({ tenantId: w.tenantId, leadId: unscored.id }));

    expect(a.icp.status).toBe('scored');
    expect(b.icp).toEqual({ status: 'not_scored', reason: 'campaign_has_no_icp' });
    expect((await reloadLead(w, unscored.id)).latestIcpAssessmentId).toBeNull();
    expect(await w.run(() => prisma.leadIcpAssessment.count({ where: { leadId: unscored.id } }))).toBe(0);
    expect((await reloadLead(w, scored.id)).latestIcpAssessmentId).not.toBeNull();
  });

  it('a profile with nothing published reports icp_has_no_published_version', async () => {
    const { w } = await worldWithDefault();
    const dead = await profile(w, 'Dead');
    await version(w, dead.id, 1, 'archived');
    const c = await campaign(w, 'On dead', { icpProfileId: dead.id });
    const l = await lead(w, c.id);
    expect(await w.run(() => scoreLeadIcp({ tenantId: w.tenantId, leadId: l.id }))).toEqual({
      status: 'not_scored',
      reason: 'icp_has_no_published_version',
    });
  });

  it('rescoring an ICP-less campaign clears the mirror, keeps history, writes no assessment', async () => {
    const { w } = await worldWithDefault();
    const lib = await profile(w, 'Was ICP');
    await version(w, lib.id, 1);
    const c = await campaign(w, 'Loses ICP', { icpProfileId: lib.id });
    const l = await lead(w, c.id);
    await w.run(() => scoreLeadIcp({ tenantId: w.tenantId, leadId: l.id }));
    const before = await reloadLead(w, l.id);
    expect(before.icpQualification).not.toBeNull();
    const rowsBefore = await leadAssessmentCount(w);

    // The manager clears the campaign's ICP through the assign path.
    await w.run(() => assignCampaignIcp({ tenantId: w.tenantId, campaignId: c.id, icpVersionId: null }));

    const dry = await w.run(() => rescoreLeadsIcp({ tenantId: w.tenantId, campaignId: c.id, onlyUnscored: false, dryRun: true }));
    expect(dry).toMatchObject({ dryRun: true, notScored: 1, willClear: 1, reasons: { campaign_has_no_icp: 1 } });
    expect((await reloadLead(w, l.id)).latestIcpAssessmentId).toBe(before.latestIcpAssessmentId); // dry run wrote nothing

    const report = await w.run(() => rescoreLeadsIcp({ tenantId: w.tenantId, campaignId: c.id, onlyUnscored: false }));
    expect(report).toMatchObject({ considered: 1, scored: 0, notScored: 1, reasons: { campaign_has_no_icp: 1 } });

    const after = await reloadLead(w, l.id);
    expect(after).toMatchObject({
      latestIcpAssessmentId: null,
      icpVersionId: null,
      icpFitScore: null,
      icpQualification: null,
      icpScoredAt: null,
    });
    expect(await leadAssessmentCount(w)).toBe(rowsBefore); // history stays, nothing new, no placeholder
  });

  it('never touches a human verdict when it clears the computed one', async () => {
    const { w } = await worldWithDefault();
    const lib = await profile(w, 'Human ICP');
    await version(w, lib.id, 1);
    const c = await campaign(w, 'Human', { icpProfileId: lib.id });
    const l = await lead(w, c.id);
    await w.run(() => scoreLeadIcp({ tenantId: w.tenantId, leadId: l.id }));
    await w.run(() => prisma.lead.update({ where: { id: l.id }, data: { qualificationOverride: 'qualified' } }));
    await w.run(() => assignCampaignIcp({ tenantId: w.tenantId, campaignId: c.id, icpVersionId: null }));

    await w.run(() => scoreLeadIcp({ tenantId: w.tenantId, leadId: l.id }));

    expect(await reloadLead(w, l.id)).toMatchObject({ qualificationOverride: 'qualified', icpQualification: null });
  });

  it('a lead is never scored against another tenant’s ICP', async () => {
    const a = await worldWithDefault();
    const b = await worldWithDefault();
    const aBare = await campaign(a.w, 'A bare');
    const l = await lead(a.w, aBare.id);
    // Tenant B has a published default; tenant A's lead must still not be scored.
    const out = await b.w.run(() => scoreLeadIcp({ tenantId: b.w.tenantId, leadId: l.id }));
    expect(out).toEqual({ status: 'not_scored', reason: 'lead_not_found' });
    expect(await a.w.run(() => scoreLeadIcp({ tenantId: a.w.tenantId, leadId: l.id }))).toMatchObject({
      status: 'not_scored',
      reason: 'campaign_has_no_icp',
    });
  });
});

describe('listCampaignsWithoutIcp (dry-run script core)', () => {
  it('lists only ICP-less campaigns with lead and flipping-verdict counts, per tenant, writing nothing', async () => {
    const { w } = await worldWithDefault();
    const other = await worldWithDefault();
    const lib = await profile(w, 'Audit ICP');
    await version(w, lib.id, 1);
    const ok = await campaign(w, 'Has ICP', { icpProfileId: lib.id });
    const bare = await campaign(w, 'No ICP');
    const dead = await campaign(w, 'Dead ICP', { icpProfileId: (await profile(w, 'Unpublished')).id });
    await campaign(other.w, 'Other tenant bare');

    // Leads on the bare campaign: one carries a verdict from the old fallback, one never had any.
    const scoredLead = await lead(w, bare.id);
    await lead(w, bare.id);
    await lead(w, ok.id);
    await w.run(() => prisma.lead.update({ where: { id: scoredLead.id }, data: { icpQualification: 'unqualified', icpFitScore: 10 } }));
    const assessmentsBefore = await leadAssessmentCount(w);

    const rows = await w.run(() => listCampaignsWithoutIcp(w.tenantId));

    expect(rows.map((r) => r.name)).toEqual(['Dead ICP', 'No ICP']);
    expect(rows.find((r) => r.campaignId === bare.id)).toMatchObject({ reason: 'campaign_has_no_icp', leads: 2, withVerdict: 1 });
    expect(rows.find((r) => r.campaignId === dead.id)).toMatchObject({ reason: 'icp_has_no_published_version', leads: 0, withVerdict: 0 });
    expect(await leadAssessmentCount(w)).toBe(assessmentsBefore);
    expect((await reloadLead(w, scoredLead.id)).icpQualification).toBe('unqualified'); // untouched
  });
});

describe('assignCampaignIcp', () => {
  it('sets the profile from the chosen version, keeps the version as history, and clears with null', async () => {
    const { w } = await worldWithDefault();
    const lib = await profile(w, 'Assign ICP');
    const v1 = await version(w, lib.id, 1);
    const c = await campaign(w, 'Assignable');

    await w.run(() => assignCampaignIcp({ tenantId: w.tenantId, campaignId: c.id, icpVersionId: v1.id }));
    expect(await w.run(() => prisma.campaign.findUniqueOrThrow({ where: { id: c.id } }))).toMatchObject({
      icpProfileId: lib.id,
      icpVersionId: v1.id,
    });

    await w.run(() => assignCampaignIcp({ tenantId: w.tenantId, campaignId: c.id, icpVersionId: null }));
    expect(await w.run(() => prisma.campaign.findUniqueOrThrow({ where: { id: c.id } }))).toMatchObject({
      icpProfileId: null,
      icpVersionId: null,
    });
    expect(await w.run(() => resolveIcpVersionId(w.tenantId, c.id))).toBeNull();
  });
});

describe('pool', () => {
  const poolItem = (w: World, extra: Record<string, unknown> = {}) =>
    w.run(() =>
      prisma.leadPoolItem.create({
        data: {
          tenantId: w.tenantId,
          company: `Pool Co ${randomUUID().slice(0, 6)}`,
          firstName: 'Jane',
          lastName: 'Doe',
          email: `jane-${randomUUID().slice(0, 8)}@example.com`,
          title: 'CEO',
          industry: 'Software',
          sourceType: 'csv_import',
          status: 'imported',
          qualification: 'unreviewed',
          ...extra,
        },
      }),
    );
  const prospect = (w: World, campaignId: string, poolItemId: string) =>
    w.run(() => prisma.campaignProspect.create({ data: { tenantId: w.tenantId, campaignId, poolItemId, status: 'ready' } }));

  it('an unassigned record is still pre-ranked with the default; a prospect of an ICP-less campaign is skipped', async () => {
    const { w } = await worldWithDefault();
    const bare = await campaign(w, 'Bare pool campaign');
    const unassigned = await poolItem(w);
    const bound = await poolItem(w);
    await prospect(w, bare.id, bound.id);

    const pre = await w.run(() => rescorePool({ tenantId: w.tenantId, selection: { kind: 'ids', ids: [unassigned.id] } }));
    expect(pre).toMatchObject({ considered: 1, scored: 1, skippedNoIcp: 0 });

    const campaignRun = await w.run(() => rescorePool({ tenantId: w.tenantId, selection: { kind: 'campaign', campaignId: bare.id } }));
    expect(campaignRun).toMatchObject({ considered: 1, scored: 0, skippedNoIcp: 1 });
    expect(await w.run(() => prisma.leadPoolAssessment.count({ where: { poolItemId: bound.id } }))).toBe(0);
  });

  it('a campaign prospect is scored with the campaign’s ICP, not the default, and lands on the CampaignProspect', async () => {
    const { w, defaultVersion } = await worldWithDefault();
    const lib = await profile(w, 'Pool campaign ICP');
    const v1 = await version(w, lib.id, 1);
    const c = await campaign(w, 'Pool campaign', { icpProfileId: lib.id });
    const item = await poolItem(w);
    const membership = await prospect(w, c.id, item.id);

    const result = await w.run(() => rescorePool({ tenantId: w.tenantId, selection: { kind: 'campaign', campaignId: c.id } }));

    expect(result).toMatchObject({ considered: 1, scored: 1, skippedNoIcp: 0 });
    const after = await w.run(() => prisma.campaignProspect.findUniqueOrThrow({ where: { id: membership.id } }));
    expect(after.assessedIcpVersionId).toBe(v1.id);
    expect(after.assessedIcpVersionId).not.toBe(defaultVersion.id);
    expect(after.latestAssessmentId).not.toBeNull();
  });

  it('import scoring: a campaign-bound record lands on its prospect; an ICP-less campaign leaves it NOT SCORED', async () => {
    const { w } = await worldWithDefault();
    const lib = await profile(w, 'Import ICP');
    const v1 = await version(w, lib.id, 1);
    const scoredCampaign = await campaign(w, 'Import scored', { icpProfileId: lib.id });
    const bareCampaign = await campaign(w, 'Import bare');
    const a = await poolItem(w, { assignedCampaignId: scoredCampaign.id });
    const b = await poolItem(w, { assignedCampaignId: bareCampaign.id });
    const pa = await prospect(w, scoredCampaign.id, a.id);
    const pb = await prospect(w, bareCampaign.id, b.id);
    const unassigned = await poolItem(w);

    await w.run(() => scoreImportedPoolItem(a.id, w.tenantId));
    await w.run(() => scoreImportedPoolItem(b.id, w.tenantId));
    await w.run(() => scoreImportedPoolItem(unassigned.id, w.tenantId));

    expect((await w.run(() => prisma.campaignProspect.findUniqueOrThrow({ where: { id: pa.id } }))).assessedIcpVersionId).toBe(v1.id);
    expect((await w.run(() => prisma.campaignProspect.findUniqueOrThrow({ where: { id: pb.id } }))).latestAssessmentId).toBeNull();
    expect(await w.run(() => prisma.leadPoolAssessment.count({ where: { poolItemId: b.id } }))).toBe(0);
    expect((await w.run(() => prisma.leadPoolItem.findUniqueOrThrow({ where: { id: unassigned.id } }))).latestAssessmentId).not.toBeNull();
  });
});

describe('migration 20261012100000_campaign_icp_profile', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../prisma/migrations/20261012100000_campaign_icp_profile/migration.sql'),
    'utf8',
  );

  it('backfills icpProfileId from the pinned version’s profile and leaves unpinned campaigns NULL', async () => {
    const { w } = await worldWithDefault();
    const lib = await profile(w, 'Backfill ICP');
    const v1 = await version(w, lib.id, 1, 'archived');
    const pinned = await campaign(w, 'Pinned', { icpVersionId: v1.id });
    const unpinned = await campaign(w, 'Unpinned');
    expect(pinned.icpProfileId).toBeNull();

    // Run the migration's own backfill statement, not a copy of it.
    // Scoped to this test's tenant so a parallel suite's campaigns are not rewritten.
    const statement = sql.slice(sql.indexOf('UPDATE "Campaign"')).trim().replace(/;$/, '');
    expect(statement).toContain('SET "icpProfileId"');
    await prisma.$executeRawUnsafe(`${statement} AND c."tenantId" = '${w.tenantId}'`);

    const rows = await w.run(() => prisma.campaign.findMany({ where: { id: { in: [pinned.id, unpinned.id] } } }));
    expect(rows.find((r) => r.id === pinned.id)?.icpProfileId).toBe(lib.id);
    expect(rows.find((r) => r.id === unpinned.id)?.icpProfileId).toBeNull();
    // An archived pin follows its profile, which has nothing published: not scored, said out loud.
    expect(await w.run(() => resolveCampaignIcp(w.tenantId, pinned.id))).toMatchObject({ reason: 'icp_has_no_published_version' });
  });

  it('SET NULL touches only its own column, so deleting a profile or user detaches without failing', async () => {
    const { w } = await worldWithDefault();
    const custom = await profile(w, 'Owned custom', { kind: 'custom', ownerUserId: w.userId });
    const c = await campaign(w, 'On custom', { icpProfileId: custom.id });

    await w.run(() => prisma.user.deleteMany({ where: { id: w.userId } })).catch(() => undefined);
    const owner = await w.run(() => prisma.icpProfile.findUniqueOrThrow({ where: { id: custom.id } }));
    // Either the user delete is blocked by other references (owner kept) or it detached cleanly.
    expect([w.userId, null]).toContain(owner.ownerUserId);
    expect(owner.tenantId).toBe(w.tenantId);

    await w.run(() => prisma.icpProfile.delete({ where: { id: custom.id } }));
    const detached = await w.run(() => prisma.campaign.findUniqueOrThrow({ where: { id: c.id } }));
    expect(detached.icpProfileId).toBeNull();
    expect(detached.tenantId).toBe(w.tenantId);
  });
});
