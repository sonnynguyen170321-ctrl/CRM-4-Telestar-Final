import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';

vi.mock('@/lib/auth', () => ({ getVisibleCampaignIds: vi.fn(async () => null) }));

import type { SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listLeadFilter } from '@/lib/leadFilter/readModel';

/**
 * A prospect retired at the pool level must not be offered as workable pipeline.
 *
 * Marking a pool record `duplicate` (or archiving it) writes only to `LeadPoolItem`. The
 * `CampaignProspect` row that put it in a campaign is untouched, and the Lead Filter read model
 * filtered on `CampaignProspect.status` alone — so a record a manager had just retired kept
 * appearing in the campaign's list, counted in its totals, and could be worked or converted a
 * second time.
 *
 * The repo has already paid for this exact class once. lib/leadgen/poolItemState.ts records a
 * production measurement: six records retired as duplicates still showed "not converted",
 * inviting a second conversion of prospects that were already live pipeline — one of them a
 * closed win. That fix covered the pool browser's derived state; this read model was never
 * given the same treatment.
 */

const TENANT = `lf-retired-${crypto.randomUUID().slice(0, 8)}`;
let campaignId = '';
let liveProspectId = '';
let actor: SessionUser;

async function seedProspect(input: {
  company: string;
  status: 'raw' | 'qualified' | 'assigned_to_campaign' | 'archived' | 'disqualified';
  qualification: 'unreviewed' | 'duplicate' | 'disqualified' | 'out_of_icp';
}) {
  const item = await prisma.leadPoolItem.create({
    data: {
      tenantId: TENANT,
      company: input.company,
      firstName: 'Test',
      lastName: input.company,
      email: `${input.company.toLowerCase()}@${TENANT}.test`,
      status: input.status,
      qualification: input.qualification,
    },
  });
  const prospect = await prisma.campaignProspect.create({
    data: { tenantId: TENANT, campaignId, poolItemId: item.id, status: 'ready' },
  });
  return prospect.id;
}

beforeAll(async () => {
  await prisma.tenant.create({ data: { id: TENANT, name: TENANT } });
  const user = await prisma.user.create({
    data: { email: `dir@${TENANT}.test`, password: 'x', firstName: 'D', lastName: 'R', role: 'director', tenantId: TENANT },
  });
  actor = {
    id: user.id, email: user.email, firstName: 'D', lastName: 'R', role: 'director', tenantId: TENANT,
  } as SessionUser;

  const client = await prisma.client.create({
    data: { name: 'c', industry: 'i', contactName: 'n', contactEmail: `c@${TENANT}.test`, status: 'active', tenantId: TENANT },
  });
  const campaign = await prisma.campaign.create({
    data: { name: 'Filter Q3', clientId: client.id, startDate: new Date(), status: 'active', tenantId: TENANT },
  });
  campaignId = campaign.id;

  liveProspectId = await seedProspect({ company: 'Alive', status: 'assigned_to_campaign', qualification: 'unreviewed' });
  await seedProspect({ company: 'Dup', status: 'archived', qualification: 'duplicate' });
  await seedProspect({ company: 'Rejected', status: 'disqualified', qualification: 'disqualified' });
  await seedProspect({ company: 'Officp', status: 'qualified', qualification: 'out_of_icp' });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
});

describe('Lead Filter excludes prospects retired at the pool level', () => {
  it('lists only the live prospect', async () => {
    const result = await listLeadFilter(actor, TENANT, { campaignId, verdict: 'all' });
    const ids = result.items.map((row) => row.id);
    expect(ids).toEqual([liveProspectId]);
  });

  it('does not count the retired ones in the totals', async () => {
    const result = await listLeadFilter(actor, TENANT, { campaignId, verdict: 'all' });
    expect(result.counts.total).toBe(1);
  });

  it('does not surface them through search either', async () => {
    const result = await listLeadFilter(actor, TENANT, { campaignId, verdict: 'all', search: 'Dup' });
    expect(result.items).toEqual([]);
  });
});
