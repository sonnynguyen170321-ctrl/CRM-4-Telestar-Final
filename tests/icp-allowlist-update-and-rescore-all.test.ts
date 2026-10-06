import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Two things the owner's 2026-10-07 request needed, against a real database:
 *
 *  - adding accepted titles to an ICP and moving campaigns onto the result, through the builder's
 *    own path (new published version, old one archived, nothing edited in place);
 *  - a full rescore that actually reaches every lead. "Run again" used to re-read the same first
 *    batch, so a 1,692-lead campaign never got past lead 500.
 */

import { emptyIcpRulesV2 } from '@telestar/core-scoring/rules/emptyIcpRulesV2';

import { AllowlistUpdateError, updateIcpAllowlist } from '@/lib/leadgen/icpAllowlistUpdate';
import { rescoreLeadsIcp } from '@/lib/leads/icpScoring';
import { rescoreAllLeads } from '@/lib/leads/rescoreAllClient';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { createTestTenant } from './helpers/testTenant';

const RULES = (() => {
  const rules = emptyIcpRulesV2('owner-titles', 'TeleStar ICP');
  rules.persona = { ...rules.persona, titleAllowlist: ['Founder', 'CEO', 'VP sales'] };
  return rules;
})();

let tenantId: string;
let otherTenantId: string;
const ids = { profile: '', archived: '', published: '', alpha: '', floor: '', onPublished: '', untouched: '', otherProfile: '' };
const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

async function seed(t: string) {
  return inTenant(async () => {
    const client = await prisma.client.create({ data: { tenantId: t, name: 'C', industry: 'Software', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } });
    const profile = await prisma.icpProfile.create({ data: { tenantId: t, name: 'TeleStar ICP' } });
    const archived = await prisma.icpVersion.create({ data: { tenantId: t, icpProfileId: profile.id, versionNumber: 1, status: 'archived', rulesJson: RULES as never } });
    const published = await prisma.icpVersion.create({ data: { tenantId: t, icpProfileId: profile.id, versionNumber: 2, status: 'published', rulesJson: RULES as never } });
    const campaign = (name: string, icpVersionId: string | null) =>
      prisma.campaign.create({ data: { tenantId: t, clientId: client.id, name, startDate: new Date(), icpVersionId } });
    const alpha = await campaign('Tele Campaign Alpha', archived.id);
    const floor = await campaign('Telestar - 2nd Floor campaign test', archived.id);
    const onPublished = await campaign('Already on v2', published.id);
    const untouched = await campaign('No ICP', null);
    return { profile: profile.id, archived: archived.id, published: published.id, alpha: alpha.id, floor: floor.id, onPublished: onPublished.id, untouched: untouched.id };
  }, t);
}

const versions = () => inTenant(() => prisma.icpVersion.findMany({ where: { icpProfileId: ids.profile }, orderBy: { versionNumber: 'asc' } }));
const campaign = (id: string) => inTenant(() => prisma.campaign.findUniqueOrThrow({ where: { id } }));
const update = (apply: boolean, over: Partial<Parameters<typeof updateIcpAllowlist>[0]> = {}) =>
  inTenant(() =>
    updateIcpAllowlist({
      tenantId,
      profileId: ids.profile,
      addTitles: ['Managing Director', 'Owner', 'President', 'Sales Director', 'CSO', 'VP Sales'],
      campaignIds: [ids.alpha, ids.floor],
      apply,
      ...over,
    })
  );

beforeEach(async () => {
  tenantId = `t-owner-titles-${randomUUID()}`;
  otherTenantId = `t-owner-titles-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'Owner titles');
  await createTestTenant(otherTenantId, 'Owner titles other');
  Object.assign(ids, await seed(tenantId));
  ids.otherProfile = (await seed(otherTenantId)).profile;
});

describe('updateIcpAllowlist', () => {
  it('plans without writing: the new titles, the ones already there, and every campaign to move', async () => {
    const plan = await update(false);
    expect(plan.titlesToAdd).toEqual(['Managing Director', 'Owner', 'President', 'Sales Director', 'CSO']);
    expect(plan.titlesAlreadyThere).toEqual(['VP Sales']);
    expect(plan.campaignsToMove.map((c) => c.name).sort()).toEqual(['Already on v2', 'Tele Campaign Alpha', 'Telestar - 2nd Floor campaign test']);
    expect(plan.publishedVersionId).toBeUndefined();
    expect((await versions()).map((v) => v.status)).toEqual(['archived', 'published']);
    expect((await campaign(ids.alpha)).icpVersionId).toBe(ids.archived);
  });

  it('publishes a new version, archives the old one untouched, and moves the campaigns onto it', async () => {
    const plan = await update(true);
    const [v1, v2, v3] = await versions();
    expect([v1.status, v2.status, v3.status]).toEqual(['archived', 'archived', 'published']);
    expect(plan.publishedVersionId).toBe(v3.id);
    expect((v2.rulesJson as typeof RULES).persona.titleAllowlist).toEqual(['Founder', 'CEO', 'VP sales']);
    expect((v3.rulesJson as typeof RULES).persona.titleAllowlist).toEqual(['Founder', 'CEO', 'VP sales', 'Managing Director', 'Owner', 'President', 'Sales Director', 'CSO']);
    for (const id of [ids.alpha, ids.floor, ids.onPublished]) expect((await campaign(id)).icpVersionId).toBe(v3.id);
    expect((await campaign(ids.untouched)).icpVersionId).toBeNull();
  });

  it('is a no-op the second time', async () => {
    await update(true);
    const again = await update(true);
    expect(again.titlesToAdd).toEqual([]);
    expect(again.campaignsToMove).toEqual([]);
    expect(await versions()).toHaveLength(3);
  });

  it('still moves a campaign off an old version when there is no title to add', async () => {
    const plan = await update(true, { addTitles: ['CEO'] });
    expect(plan.publishedVersionId).toBe(ids.published);
    expect((await campaign(ids.alpha)).icpVersionId).toBe(ids.published);
    expect(await versions()).toHaveLength(2);
  });

  it('refuses an open draft, a missing campaign, and another tenant’s profile — and writes nothing', async () => {
    await inTenant(() => prisma.icpVersion.create({ data: { tenantId, icpProfileId: ids.profile, versionNumber: 3, status: 'draft', rulesJson: RULES as never } }));
    await expect(update(true)).rejects.toThrow(/open draft/);
    await inTenant(() => prisma.icpVersion.deleteMany({ where: { icpProfileId: ids.profile, status: 'draft' } }));

    await inTenant(() => prisma.icpVersion.update({ where: { id: ids.published }, data: { status: 'archived' } }));
    await expect(update(true)).rejects.toThrow(/0 published versions/);
    await inTenant(() => prisma.icpVersion.update({ where: { id: ids.published }, data: { status: 'published' } }));

    await expect(update(true, { campaignIds: [ids.alpha, 'missing-campaign'] })).rejects.toThrow(AllowlistUpdateError);
    await expect(update(true, { profileId: ids.otherProfile })).rejects.toThrow(/not found/);
    expect(await versions()).toHaveLength(2);
    expect((await campaign(ids.alpha)).icpVersionId).toBe(ids.archived);
  });
});

describe('rescoreLeadsIcp: cursor', () => {
  async function leads(n: number, createdAt?: Date, idsDescending = false) {
    const made: string[] = [];
    const owner = await inTenant(() => prisma.user.create({ data: { tenantId, email: `sdr.${randomUUID()}@t.test`, firstName: 'U', lastName: 'S', password: 'x', role: 'sdr' } }));
    for (let i = 0; i < n; i++) {
      const lead = await inTenant(() =>
        prisma.lead.create({ data: { tenantId, firstName: `L${i}`, lastName: 'X', email: `l${i}.${randomUUID()}@acme.test`, company: 'Acme', title: 'CEO', campaignId: ids.onPublished, assignedToId: owner.id, ...(createdAt ? { createdAt } : {}), ...(idsDescending ? { id: `${tenantId}-lead-${n - i}` } : {}) } })
      );
      made.push(lead.id);
    }
    return made;
  }

  async function walk(params: { onlyUnscored: boolean; dryRun?: boolean }) {
    const seen: number[] = [];
    let cursor: string | undefined;
    let calls = 0;
    do {
      const report = await inTenant(() => rescoreLeadsIcp({ tenantId, limit: 2, cursor, ...params }));
      seen.push(report.considered);
      cursor = report.nextCursor ?? undefined;
      calls += 1;
    } while (cursor && calls < 10);
    return { seen, calls };
  }

  it('reaches every lead once on a full rescore, instead of the first batch again', async () => {
    const made = await leads(5);
    expect(await walk({ onlyUnscored: false })).toEqual({ seen: [2, 2, 1], calls: 3 });
    const scored = await inTenant(() => prisma.lead.count({ where: { id: { in: made }, latestIcpAssessmentId: { not: null } } }));
    expect(scored).toBe(5);
  });

  it('does not skip or repeat leads created in the same millisecond', async () => {
    // Inserted in descending id order, so only an explicit id tie-break walks them correctly.
    const made = await leads(5, new Date('2026-10-07T00:00:00.000Z'), true);
    expect(await walk({ onlyUnscored: false })).toEqual({ seen: [2, 2, 1], calls: 3 });
    const scored = await inTenant(() => prisma.lead.count({ where: { id: { in: made }, latestIcpAssessmentId: { not: null } } }));
    expect(scored).toBe(5);
  });

  it('refuses a cursor it did not make', async () => {
    await expect(inTenant(() => rescoreLeadsIcp({ tenantId, onlyUnscored: false, cursor: 'not-a-cursor' }))).rejects.toThrow(/Invalid rescore cursor/);
    await expect(inTenant(() => rescoreLeadsIcp({ tenantId, onlyUnscored: false, cursor: 'garbage|cuid' }))).rejects.toThrow(/Invalid rescore cursor/);
  });

  it('walks a dry run the same way and writes nothing', async () => {
    await leads(3);
    expect(await walk({ onlyUnscored: false, dryRun: true })).toEqual({ seen: [2, 1], calls: 2 });
    expect(await inTenant(() => prisma.leadIcpAssessment.count({ where: { tenantId } }))).toBe(0);
  });

  it('gets past leads that stay NOT SCORED when only unscored leads are asked for', async () => {
    await leads(3);
    // No ICP at all: every lead stays unscored, and used to be re-read forever.
    await inTenant(() => prisma.campaign.update({ where: { id: ids.onPublished }, data: { icpVersionId: null } }));
    await inTenant(() => prisma.icpVersion.updateMany({ where: { tenantId }, data: { status: 'archived' } }));
    expect(await walk({ onlyUnscored: true })).toEqual({ seen: [2, 1], calls: 2 });
  });
});

describe('rescoreAllLeads (browser loop)', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('follows the cursor to the end and adds the batches up', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ scored: 2, notScored: 0, reasons: {}, transitions: { 'qualified→needs_review': 1 }, unchanged: 1, pinned: 0, nextCursor: 'c1' }))
      .mockResolvedValueOnce(ok({ scored: 1, notScored: 1, reasons: { no_icp_configured: 1 }, transitions: { 'qualified→needs_review': 1 }, unchanged: 0, pinned: 1, nextCursor: null }));
    const result = await rescoreAllLeads({ onlyUnscored: false, dryRun: true }, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({
      ok: true,
      totals: { scored: 3, notScored: 1, reasons: { no_icp_configured: 1 }, transitions: { 'qualified→needs_review': 2 }, unchanged: 1, pinned: 1, stoppedEarly: false },
    });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ onlyUnscored: false, dryRun: true, cursor: 'c1' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('cursor');
  });

  it('stops on the first error and hands the response back', async () => {
    const failed = new Response('{}', { status: 403 });
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok({ scored: 1, nextCursor: 'c1' })).mockResolvedValueOnce(failed);
    const result = await rescoreAllLeads({}, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, response: failed });
  });

  it('stops at the safety cap and says so', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => ok({ scored: 1, nextCursor: 'again' }));
    const result = await rescoreAllLeads({}, fetchImpl as unknown as typeof fetch);
    expect(result.ok && result.totals.stoppedEarly).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(200);
  });
});
