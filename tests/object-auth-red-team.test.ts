import { describe, it, expect, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const { prisma, tenantStorage } = await import('@/lib/prisma');
const { canAccessLead, getVisibleCampaignIds } = await import('@/lib/auth');

const TENANT_VICTIM = 'tenant-victim-corp';
const TENANT_ATTACKER = 'tenant-attacker-corp';

const runVictim = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: TENANT_VICTIM, bypassRls: false }, fn);
const runAttacker = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: TENANT_ATTACKER, bypassRls: false }, fn);
const runSystem = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

let hasDb = false;
try {
  if (process.env.DATABASE_URL) {
    await prisma.$queryRaw`SELECT 1`;
    hasDb = true;
  }
} catch {
  hasDb = false;
}

describe.skipIf(!hasDb)('SEC-004 / SEC-005: Cross-Tenant & Cross-Role Object Authorization Red Team', () => {
  const setupBase = async () => {
    await runSystem(async () => {
      // Clean up previous test fixtures
      await prisma.activity.deleteMany({ where: { tenantId: { in: [TENANT_VICTIM, TENANT_ATTACKER] } } });
      await prisma.task.deleteMany({ where: { tenantId: { in: [TENANT_VICTIM, TENANT_ATTACKER] } } });
      await prisma.lead.deleteMany({ where: { tenantId: { in: [TENANT_VICTIM, TENANT_ATTACKER] } } });
      await prisma.contact.deleteMany({ where: { tenantId: { in: [TENANT_VICTIM, TENANT_ATTACKER] } } });
      await prisma.account.deleteMany({ where: { tenantId: { in: [TENANT_VICTIM, TENANT_ATTACKER] } } });
      await prisma.campaign.deleteMany({ where: { tenantId: { in: [TENANT_VICTIM, TENANT_ATTACKER] } } });
      await prisma.client.deleteMany({ where: { tenantId: { in: [TENANT_VICTIM, TENANT_ATTACKER] } } });
      await prisma.opportunity.deleteMany({ where: { tenantId: { in: [TENANT_VICTIM, TENANT_ATTACKER] } } });
      await prisma.user.deleteMany({ where: { tenantId: { in: [TENANT_VICTIM, TENANT_ATTACKER] } } });
      await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_VICTIM, TENANT_ATTACKER] } } });

      // Create tenants
      await prisma.tenant.create({ data: { id: TENANT_VICTIM, name: 'Victim Corp' } });
      await prisma.tenant.create({ data: { id: TENANT_ATTACKER, name: 'Attacker Corp' } });

      // Create victim user & data
      await prisma.user.create({
        data: { id: 'usr-victim-1', tenantId: TENANT_VICTIM, email: 'vic@victim.test', password: 'x', firstName: 'Vic', lastName: 'T', role: 'sdr' },
      });
      await prisma.client.create({
        data: { id: 'client-victim-1', tenantId: TENANT_VICTIM, name: 'Victim Client', industry: 'Finance', contactName: 'V', contactEmail: 'vc@victim.test' },
      });
      await prisma.campaign.create({
        data: { id: 'camp-victim-1', tenantId: TENANT_VICTIM, clientId: 'client-victim-1', name: 'Victim Campaign', startDate: new Date('2026-08-01') },
      });
      await prisma.account.create({
        data: { id: 'acc-victim-1', tenantId: TENANT_VICTIM, name: 'Victim Account' },
      });
      await prisma.contact.create({
        data: { id: 'cnt-victim-1', tenantId: TENANT_VICTIM, firstName: 'Victim', lastName: 'Contact', email: 'c@victim.test', company: 'Victim Account' },
      });
      await prisma.lead.create({
        data: {
          id: 'lead-victim-secret',
          tenantId: TENANT_VICTIM,
          campaignId: 'camp-victim-1',
          contactId: 'cnt-victim-1',
          accountId: 'acc-victim-1',
          firstName: 'Secret',
          lastName: 'Executive',
          company: 'Victim Account',
          email: 'secret@victim.test',
          stage: 'new',
          assignedToId: 'usr-victim-1',
        },
      });

      // Create attacker user
      await prisma.user.create({
        data: { id: 'usr-attacker-1', tenantId: TENANT_ATTACKER, email: 'att@attacker.test', password: 'x', firstName: 'Att', lastName: 'K', role: 'sdr' },
      });
    });
  };

  it('SEC-004: Attacker tenant cannot read victim lead by direct ID lookup', async () => {
    await setupBase();

    const victimLead = await runAttacker(async () => {
      return prisma.lead.findUnique({ where: { id: 'lead-victim-secret' } });
    });

    expect(victimLead).toBeNull();
  });

  it('SEC-004: Attacker tenant cannot mutate victim lead by direct ID lookup', async () => {
    await setupBase();

    const updateAttempt = await runAttacker(async () => {
      return prisma.lead.updateMany({
        where: { id: 'lead-victim-secret' },
        data: { firstName: 'Hacked' },
      });
    });

    expect(updateAttempt.count).toBe(0);

    // Verify victim lead is unchanged
    const originalLead = await runVictim(async () => {
      return prisma.lead.findUnique({ where: { id: 'lead-victim-secret' } });
    });
    expect(originalLead?.firstName).toBe('Secret');
  });

  it('SEC-004: Attacker tenant cannot delete victim lead by direct ID lookup', async () => {
    await setupBase();

    const deleteAttempt = await runAttacker(async () => {
      return prisma.lead.deleteMany({
        where: { id: 'lead-victim-secret' },
      });
    });

    expect(deleteAttempt.count).toBe(0);

    const leadCount = await runVictim(async () => {
      return prisma.lead.count({ where: { id: 'lead-victim-secret' } });
    });
    expect(leadCount).toBe(1);
  });

  it('SEC-005: SDR cannot access unassigned campaign or foreign rep leads', async () => {
    await setupBase();

    const attackerSdrSession = {
      id: 'usr-attacker-1',
      tenantId: TENANT_ATTACKER,
      role: 'sdr' as const,
      email: 'att@attacker.test',
      firstName: 'Att',
      lastName: 'K',
    };

    const hasAccessToVictim = await canAccessLead(attackerSdrSession, {
      assignedToId: 'usr-victim-1',
      campaignId: 'camp-victim-1',
    });
    expect(hasAccessToVictim).toBe(false);

    const visibleCampaigns = await getVisibleCampaignIds(attackerSdrSession);
    expect(visibleCampaigns).not.toContain('camp-victim-1');
  });
});
