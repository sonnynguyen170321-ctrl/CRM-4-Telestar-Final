import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GET as getOverview } from '@/app/api/admin/overview/route';
import { prisma, tenantStorage } from '@/lib/prisma';
import { auth } from '@/auth';
import type { SessionUser } from '@/lib/auth';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const tenantId = 'admin-overview-tenant';

const director: SessionUser = {
  id: 'ov-director',
  email: 'ov-director@telestar.vn',
  firstName: 'Dean',
  lastName: 'Director',
  role: 'director',
  tenantId,
};
const fm: SessionUser = {
  id: 'ov-fm',
  email: 'ov-fm@telestar.vn',
  firstName: 'Frank',
  lastName: 'Manager',
  role: 'floor_manager',
  tenantId,
};
const tl: SessionUser = {
  id: 'ov-tl',
  email: 'ov-tl@telestar.vn',
  firstName: 'Tim',
  lastName: 'Lead',
  role: 'team_lead',
  tenantId,
};
const sdr1: SessionUser = {
  id: 'ov-sdr-1',
  email: 'ov-sdr-1@telestar.vn',
  firstName: 'Sara',
  lastName: 'One',
  role: 'sdr',
  tenantId,
};
const sdr2: SessionUser = {
  id: 'ov-sdr-2',
  email: 'ov-sdr-2@telestar.vn',
  firstName: 'Sam',
  lastName: 'Two',
  role: 'sdr',
  tenantId,
};
const sdr3: SessionUser = {
  id: 'ov-sdr-3',
  email: 'ov-sdr-3@telestar.vn',
  firstName: 'Sue',
  lastName: 'Three',
  role: 'sdr',
  tenantId,
};
const sdr4: SessionUser = {
  id: 'ov-sdr-4',
  email: 'ov-sdr-4@telestar.vn',
  firstName: 'Sly',
  lastName: 'Four',
  role: 'sdr',
  tenantId,
};
const sdr5: SessionUser = {
  id: 'ov-sdr-5',
  email: 'ov-sdr-5@telestar.vn',
  firstName: 'Sia',
  lastName: 'Five',
  role: 'sdr',
  tenantId,
};
const leadgen: SessionUser = {
  id: 'ov-leadgen',
  email: 'ov-leadgen@telestar.vn',
  firstName: 'Lena',
  lastName: 'Gen',
  role: 'leadgen',
  tenantId,
};

let campaignA = '';
let campaignB = '';
let campaignC = '';
let campaignD = '';
let campaignE = '';

const hasDb = Boolean(process.env.DATABASE_URL);

type Card = {
  key: string;
  title: string;
  severity: string;
  count: number;
  items: { id: string; label: string; detail: string; href: string }[];
};

const cardOf = (body: { cards: Card[] }, key: string): Card => {
  const card = body.cards.find((c) => c.key === key);
  if (!card) throw new Error(`card ${key} not found in overview response`);
  return card;
};

beforeAll(async () => {
  if (!hasDb) return;

  (auth as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
    user: director,
    expires: '',
  });

  await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    await prisma.opportunity.deleteMany({ where: { tenantId } });
    await prisma.meeting.deleteMany({ where: { tenantId } });
    await prisma.task.deleteMany({ where: { tenantId } });
    await prisma.lead.deleteMany({ where: { tenantId } });
    await prisma.activity.deleteMany({ where: { tenantId } });
    await prisma.campaignSdr.deleteMany({ where: { tenantId } });
    await prisma.campaign.deleteMany({ where: { tenantId } });
    await prisma.client.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({
      where: {
        id: { in: [director.id, fm.id, tl.id, sdr1.id, sdr2.id, sdr3.id, sdr4.id, sdr5.id, leadgen.id] },
      },
    });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });

    await prisma.tenant.create({ data: { id: tenantId, name: 'Admin Overview Tenant' } });

    const users: { u: SessionUser; managerId?: string }[] = [
      { u: director },
      { u: fm },
      { u: tl, managerId: fm.id },
      { u: sdr1, managerId: tl.id },
      { u: sdr2, managerId: tl.id },
      { u: sdr3, managerId: fm.id },
      { u: sdr4, managerId: fm.id },
      { u: sdr5 },
      { u: leadgen },
    ];
    for (const { u, managerId } of users) {
      await prisma.user.create({
        data: {
          id: u.id,
          email: u.email,
          password: 'hashed-pwd',
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          managerId,
          tenantId,
        },
      });
    }

    const clientActive = await prisma.client.create({
      data: {
        name: 'Active Co',
        industry: 'SaaS',
        contactName: 'Amy Buyer',
        contactEmail: 'amy@active.co',
        status: 'active',
        tenantId,
      },
    });
    const clientPaused = await prisma.client.create({
      data: {
        name: 'Paused Co',
        industry: 'Retail',
        contactName: 'Pat Buyer',
        contactEmail: 'pat@paused.co',
        status: 'paused',
        tenantId,
      },
    });

    const mkCampaign = (name: string, clientId: string, status: string) =>
      prisma.campaign.create({
        data: { name, clientId, startDate: new Date(), status: status as 'active', tenantId },
      });

    const a = await mkCampaign('Campaign A', clientActive.id, 'active');
    const b = await mkCampaign('Campaign B', clientActive.id, 'active');
    const c = await mkCampaign('Campaign C', clientPaused.id, 'active');
    const d = await mkCampaign('Campaign D', clientActive.id, 'paused');
    const e = await mkCampaign('Campaign E', clientActive.id, 'completed');
    campaignA = a.id;
    campaignB = b.id;
    campaignC = c.id;
    campaignD = d.id;
    campaignE = e.id;

    // Memberships: A has SDRs, B has only the FM, C has sdr3, D has sdr1,
    // E has a leadgen (invisible to the FM).
    await prisma.campaignSdr.createMany({
      data: [
        { campaignId: a.id, userId: sdr1.id, tenantId },
        { campaignId: a.id, userId: sdr2.id, tenantId },
        { campaignId: b.id, userId: fm.id, tenantId },
        { campaignId: c.id, userId: sdr3.id, tenantId },
        { campaignId: d.id, userId: sdr1.id, tenantId },
        { campaignId: e.id, userId: leadgen.id, tenantId },
      ],
    });

    // sdr4 (deactivated below) owns exactly one of each open work type.
    const orphanLead = await prisma.lead.create({
      data: {
        firstName: 'Left',
        lastName: 'Behind',
        company: 'Ghost Co',
        email: 'ghost@lead.test',
        stage: 'new',
        assignedToId: sdr4.id,
        campaignId: a.id,
        tenantId,
      },
    });
    await prisma.task.create({
      data: {
        leadId: orphanLead.id,
        userId: sdr4.id,
        type: 'email',
        title: 'Orphaned task',
        dueDate: new Date(),
        status: 'pending',
        tenantId,
      },
    });
    await prisma.meeting.create({
      data: {
        leadId: orphanLead.id,
        campaignId: a.id,
        clientId: clientActive.id,
        sdrId: sdr4.id,
        title: 'Orphaned meeting',
        scheduledAt: new Date(Date.now() + 86_400_000),
        status: 'scheduled',
        tenantId,
      },
    });
    await prisma.opportunity.create({
      data: {
        leadId: orphanLead.id,
        campaignId: a.id,
        clientId: clientActive.id,
        ownerId: sdr4.id,
        createdById: director.id,
        title: 'Orphaned deal',
        company: 'Ghost Co',
        status: 'open',
        tenantId,
      },
    });

    // One live sequence enrollment under the paused campaign D.
    await prisma.lead.create({
      data: {
        firstName: 'Seq',
        lastName: 'Lead',
        company: 'Seq Co',
        email: 'seq@lead.test',
        stage: 'sequence_active',
        sequenceStatus: 'active',
        assignedToId: sdr1.id,
        campaignId: d.id,
        tenantId,
      },
    });

    await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      await prisma.user.update({
        where: { id: sdr4.id },
        data: { isActive: false },
      });
    });
  });
}, 60_000);

afterAll(async () => {
  if (!hasDb) return;
  await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    await prisma.opportunity.deleteMany({ where: { tenantId } });
    await prisma.meeting.deleteMany({ where: { tenantId } });
    await prisma.task.deleteMany({ where: { tenantId } });
    await prisma.lead.deleteMany({ where: { tenantId } });
    await prisma.activity.deleteMany({ where: { tenantId } });
    await prisma.campaignSdr.deleteMany({ where: { tenantId } });
    await prisma.campaign.deleteMany({ where: { tenantId } });
    await prisma.client.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({
      where: {
        id: { in: [director.id, fm.id, tl.id, sdr1.id, sdr2.id, sdr3.id, sdr4.id, sdr5.id, leadgen.id] },
      },
    });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });
}, 60_000);

describe.skipIf(!hasDb)('GET /api/admin/overview — director (org-wide)', () => {
  it('blocks 401/403 and returns 200 for a floor manager or above', async () => {
    const unauth = (auth as unknown as { mockResolvedValueOnce: (v: unknown) => void });
    unauth.mockResolvedValueOnce(null);
    expect((await getOverview()).status).toBe(401);

    unauth.mockResolvedValueOnce({ user: sdr1, expires: '' });
    expect((await getOverview()).status).toBe(403);
  });

  it('renders all six cards with the seeded counts', async () => {
    const res = await tenantStorage.run({ tenantId }, () => getOverview());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.totals).toEqual({ activeUsers: 8, inactiveUsers: 1, activeCampaigns: 3, totalCampaigns: 5 });

    const noSdr = cardOf(body, 'campaigns_without_sdr');
    expect(noSdr).toBeDefined();
    expect(noSdr.count).toBe(1);
    expect(noSdr.items[0].id).toBe(campaignB);

    const orphaned = cardOf(body, 'orphaned_work');
    expect(orphaned.count).toBe(1);
    expect(orphaned.items[0].id).toBe(sdr4.id);
    expect(orphaned.items[0].detail).toContain('1 lead(s), 1 task(s), 1 meeting(s), 1 opportunity(ies)');

    const pausedClient = cardOf(body, 'client_paused_campaign_active');
    expect(pausedClient.count).toBe(1);
    expect(pausedClient.items[0].id).toBe(campaignC);
    expect(pausedClient.items[0].detail).toContain('is paused');

    const sequences = cardOf(body, 'sequences_under_paused_campaign');
    expect(sequences.count).toBe(1);
    expect(sequences.items[0].id).toBe(campaignD);
    expect(sequences.items[0].detail).toContain('1 lead(s) still enrolled');

    const noManager = cardOf(body, 'users_without_manager');
    expect(noManager.count).toBe(3);
    const noManagerIds = noManager.items.map((i: { id: string }) => i.id);
    expect(noManagerIds).toContain(fm.id);
    expect(noManagerIds).toContain(sdr5.id);
    expect(noManagerIds).toContain(leadgen.id);
    expect(noManagerIds).not.toContain(director.id);

    const noCampaign = cardOf(body, 'users_without_campaign');
    expect(noCampaign.count).toBe(1);
    const noCampaignIds = noCampaign.items.map((i: { id: string }) => i.id);
    expect(noCampaignIds).toContain(sdr5.id);
    expect(noCampaignIds).not.toContain(leadgen.id);
  });
});

describe.skipIf(!hasDb)('GET /api/admin/overview — floor manager scoping', () => {
  it('sees only their own floor and accounts', async () => {
    (auth as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      user: fm,
      expires: '',
    });

    const res = await tenantStorage.run({ tenantId }, () => getOverview());
    expect(res.status).toBe(200);
    const body = await res.json();

    // FM sees their floor (fm, tl, sdr1-3) — sdr4 is inactive + outside view,
    // sdr5/leadgen/director are outside the BFS tree, campaign E is invisible.
    expect(body.totals).toEqual({ activeUsers: 5, inactiveUsers: 0, activeCampaigns: 3, totalCampaigns: 4 });

    const noSdr = cardOf(body, 'campaigns_without_sdr');
    expect(noSdr.count).toBe(1);
    expect(noSdr.items[0].id).toBe(campaignB);

    // No orphaned work — sdr4 is not in the FM's visible set.
    const orphaned = cardOf(body, 'orphaned_work');
    expect(orphaned.count).toBe(0);

    const pausedClient = cardOf(body, 'client_paused_campaign_active');
    expect(pausedClient.count).toBe(1);
    expect(pausedClient.items[0].id).toBe(campaignC);

    const sequences = cardOf(body, 'sequences_under_paused_campaign');
    expect(sequences.count).toBe(1);
    expect(sequences.items[0].id).toBe(campaignD);

    const noManager = cardOf(body, 'users_without_manager');
    expect(noManager.count).toBe(1);
    expect(noManager.items[0].id).toBe(fm.id);

    const noCampaign = cardOf(body, 'users_without_campaign');
    expect(noCampaign.count).toBe(0);

    // None of the FM's cards may leak out-of-floor data.
    const allItemIds = body.cards.flatMap((c: { items: { id: string }[] }) => c.items.map((i) => i.id));
    expect(allItemIds).not.toContain(sdr4.id);
    expect(allItemIds).not.toContain(sdr5.id);
    expect(allItemIds).not.toContain(leadgen.id);
    expect(allItemIds).not.toContain(campaignE);
  });
});
