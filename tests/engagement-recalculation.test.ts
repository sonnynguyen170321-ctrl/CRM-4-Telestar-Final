import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recalculateTenantEngagement } from "@/lib/leads/recalculateEngagement";

const hasDb = Boolean(process.env.DATABASE_URL);
const prisma = new PrismaClient();
const tenantId = "engagement-recalc-tenant";
const otherTenantId = "engagement-recalc-other";

async function deleteTenant(id: string) {
  await prisma.meeting.deleteMany({ where: { tenantId: id } });
  await prisma.lead.deleteMany({ where: { tenantId: id } });
  await prisma.campaign.deleteMany({ where: { tenantId: id } });
  await prisma.client.deleteMany({ where: { tenantId: id } });
  await prisma.user.deleteMany({ where: { tenantId: id } });
  await prisma.tenant.deleteMany({ where: { id } });
}

async function seedTenant(id: string) {
  await prisma.tenant.create({ data: { id, name: id } });
  const user = await prisma.user.create({
    data: {
      id: `${id}-user`,
      tenantId: id,
      email: `${id}@example.test`,
      password: "x",
      firstName: "Test",
      lastName: "User",
    },
  });
  const client = await prisma.client.create({
    data: {
      id: `${id}-client`,
      tenantId: id,
      name: "Client",
      industry: "Software",
      contactName: "Owner",
      contactEmail: `owner-${id}@example.test`,
    },
  });
  const campaign = await prisma.campaign.create({
    data: {
      id: `${id}-campaign`,
      tenantId: id,
      clientId: client.id,
      name: "Campaign",
      startDate: new Date("2026-09-01"),
    },
  });
  return { user, client, campaign };
}

describe.skipIf(!hasDb)("atomic engagement recalculation", () => {
  beforeAll(async () => {
    await deleteTenant(tenantId);
    await deleteTenant(otherTenantId);

    const own = await seedTenant(tenantId);
    const other = await seedTenant(otherTenantId);
    const base = {
      tenantId,
      campaignId: own.campaign.id,
      assignedToId: own.user.id,
      firstName: "Test",
      lastName: "Lead",
      company: "Acme",
      tags: [] as string[],
    };
    await prisma.lead.createMany({
      data: [
        { ...base, id: "engagement-cold", email: "cold@example.test" },
        {
          ...base,
          id: "engagement-warm",
          email: "warm@example.test",
          emailOpenCount: 9,
        },
        {
          ...base,
          id: "engagement-reply",
          email: "reply@example.test",
          emailReplyCount: 1,
        },
        { ...base, id: "engagement-meeting", email: "meeting@example.test" },
        {
          ...base,
          id: "engagement-archived",
          email: "archived@example.test",
          emailReplyCount: 1,
          archivedAt: new Date("2026-09-02"),
        },
      ],
    });
    await prisma.meeting.create({
      data: {
        id: "engagement-meeting-row",
        tenantId,
        leadId: "engagement-meeting",
        clientId: own.client.id,
        campaignId: own.campaign.id,
        sdrId: own.user.id,
        title: "Demo",
      },
    });
    await prisma.lead.create({
      data: {
        id: "engagement-other-lead",
        tenantId: otherTenantId,
        campaignId: other.campaign.id,
        assignedToId: other.user.id,
        firstName: "Other",
        lastName: "Lead",
        company: "Other",
        email: "other@example.test",
        emailReplyCount: 1,
        tags: [],
      },
    });
  });

  afterAll(async () => {
    if (hasDb) {
      await deleteTenant(tenantId);
      await deleteTenant(otherTenantId);
    }
    await prisma.$disconnect();
  });

  it("updates the full active tenant in one statement and leaves other/archived rows alone", async () => {
    expect(await recalculateTenantEngagement(tenantId)).toEqual({
      updatedCount: 4,
      hotCount: 2,
      warmCount: 1,
      coldCount: 1,
    });

    const rows = await prisma.lead.findMany({
      where: { tenantId },
      orderBy: { id: "asc" },
      select: { id: true, engagementScore: true, crmPriorityScore: true },
    });
    expect(rows).toEqual([
      {
        id: "engagement-archived",
        engagementScore: null,
        crmPriorityScore: "warm",
      },
      { id: "engagement-cold", engagementScore: 0, crmPriorityScore: "cold" },
      {
        id: "engagement-meeting",
        engagementScore: 100,
        crmPriorityScore: "hot",
      },
      { id: "engagement-reply", engagementScore: 80, crmPriorityScore: "hot" },
      { id: "engagement-warm", engagementScore: 40, crmPriorityScore: "warm" },
    ]);

    const other = await prisma.lead.findUniqueOrThrow({
      where: { id: "engagement-other-lead" },
    });
    expect(other.engagementScore).toBeNull();
    expect(other.crmPriorityScore).toBe("warm");
  });
});
