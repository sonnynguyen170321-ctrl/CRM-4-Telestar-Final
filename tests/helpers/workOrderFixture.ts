import { prisma, tenantStorage } from '@/lib/prisma';
import { activateVersion, approveVersion, createDraftVersion } from '@/lib/playbooks/versions';

/**
 * The two-tenant fixture the Phase 6a suites share.
 *
 * **Parameterised by prefix, deliberately.** Several database-backed suites run in parallel
 * against one database and clear their own rows in `beforeEach`; two files sharing a tenant id
 * would wipe each other's fixtures and fail in whichever order the scheduler picked. Each suite
 * passes its own prefix and therefore owns its own tenants, users, campaign and leads.
 */

export interface WorkOrderFixture {
  tenantId: string;
  otherTenantId: string;
  directorId: string;
  sdrId: string;
  otherDirectorId: string;
  campaignId: string;
  sequenceId: string;
  playbookId: string;
  versionOneId: string;
  versionTwoId: string;
  /** No enrollment, no transitions — the clean lead. */
  idleLeadId: string;
  /** Carries an `active` SequenceEnrollment at step 2. */
  enrolledLeadId: string;
  /** `operatingState = human_managed`. */
  humanManagedLeadId: string;
  /** Belongs to `otherTenantId`. */
  otherTenantLeadId: string;
}

export const FIXTURE_RULES = {
  personas: ['VP Sales'],
  valueProposition: 'Outsourced SDR capacity without hiring.',
  allowedCtas: ['Book 15 minutes'],
  researchDepth: 'standard' as const,
  allowedChannels: ['email' as const],
  ghostThresholdsBusinessDays: {
    positive_reply_waiting: 3,
    proposal_sent: 5,
    meeting_no_show: 2,
    post_demo: 5,
  },
  handoffSlaMinutes: 60,
  sendWindow: null,
  replyHandling: { autoHandleAdministrative: true, oooResumeBufferDays: 2 },
};

export const runAs = <T>(tenantId: string, fn: () => Promise<T>) =>
  tenantStorage.run({ tenantId, bypassRls: true }, fn);

const runSystem = <T>(fn: () => Promise<T>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

export async function setupWorkOrderFixture(prefix: string): Promise<WorkOrderFixture> {
  const tenantId = `${prefix}-tenant`;
  const otherTenantId = `${prefix}-other-tenant`;
  const directorId = `${prefix}-director`;
  const sdrId = `${prefix}-sdr`;
  const otherDirectorId = `${prefix}-other-director`;

  const ids = await runSystem(async () => {
    for (const t of [tenantId, otherTenantId]) {
      await prisma.workOrderLease.deleteMany({ where: { tenantId: t } });
      await prisma.workOrder.deleteMany({ where: { tenantId: t } });
      await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: t } });
      await prisma.campaignPlaybookVersion.deleteMany({ where: { tenantId: t } });
      await prisma.campaignPlaybook.deleteMany({ where: { tenantId: t } });
      await prisma.sequence.deleteMany({ where: { tenantId: t } });
      await prisma.lead.deleteMany({ where: { tenantId: t } });
      await prisma.campaign.deleteMany({ where: { tenantId: t } });
      await prisma.client.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.deleteMany({ where: { id: t } });
    }

    await prisma.tenant.createMany({
      data: [
        { id: tenantId, name: `${prefix} Tenant` },
        { id: otherTenantId, name: `${prefix} Other Tenant` },
      ],
    });

    // `User.email` is globally unique, so fixture addresses use a reserved domain rather than
    // plausible ones the demo seed already owns.
    await prisma.user.createMany({
      data: [
        {
          id: directorId,
          email: `${directorId}@session-fixture.test`,
          password: 'hashed',
          firstName: 'Dee',
          lastName: 'Rector',
          role: 'director',
          tenantId,
        },
        {
          id: sdrId,
          email: `${sdrId}@session-fixture.test`,
          password: 'hashed',
          firstName: 'Sam',
          lastName: 'Rep',
          role: 'sdr',
          tenantId,
        },
        {
          id: otherDirectorId,
          email: `${otherDirectorId}@session-fixture.test`,
          password: 'hashed',
          firstName: 'Ola',
          lastName: 'Other',
          role: 'director',
          tenantId: otherTenantId,
        },
      ],
    });

    const client = await prisma.client.create({
      data: {
        name: `${prefix} Co`,
        industry: 'SaaS',
        contactName: 'Pat Buyer',
        contactEmail: `pat@${prefix}.test`,
        tenantId,
      },
    });
    const campaign = await prisma.campaign.create({
      data: { name: `${prefix} Campaign`, clientId: client.id, startDate: new Date(), tenantId },
    });

    const otherClient = await prisma.client.create({
      data: {
        name: `${prefix} Other Co`,
        industry: 'SaaS',
        contactName: 'Sam Buyer',
        contactEmail: `sam@${prefix}-other.test`,
        tenantId: otherTenantId,
      },
    });
    const otherCampaign = await prisma.campaign.create({
      data: {
        name: `${prefix} Other Campaign`,
        clientId: otherClient.id,
        startDate: new Date(),
        tenantId: otherTenantId,
      },
    });

    const sequence = await prisma.sequence.create({
      data: { name: `${prefix} Sequence`, createdById: directorId, tenantId },
    });

    const playbook = await prisma.campaignPlaybook.create({
      data: {
        name: `${prefix} Playbook`,
        campaignId: campaign.id,
        createdById: directorId,
        tenantId,
      },
    });

    const leads = await Promise.all(
      ['idle', 'enrolled', 'managed'].map((name) =>
        prisma.lead.create({
          data: {
            firstName: name,
            lastName: 'Target',
            company: 'Prospect Inc',
            email: `${prefix}-${name}@prospect.test`,
            stage: 'new',
            assignedToId: sdrId,
            campaignId: campaign.id,
            tenantId,
          },
        })
      )
    );

    const otherLead = await prisma.lead.create({
      data: {
        firstName: 'Foreign',
        lastName: 'Target',
        company: 'Other Inc',
        email: `${prefix}-foreign@prospect.test`,
        stage: 'new',
        assignedToId: otherDirectorId,
        campaignId: otherCampaign.id,
        tenantId: otherTenantId,
      },
    });

    return {
      campaignId: campaign.id,
      sequenceId: sequence.id,
      playbookId: playbook.id,
      idleLeadId: leads[0].id,
      enrolledLeadId: leads[1].id,
      humanManagedLeadId: leads[2].id,
      otherTenantLeadId: otherLead.id,
    };
  });

  // Inside the real tenant context, not `system`: the extension in `lib/prisma.ts` stamps
  // `tenantId` onto every write even under bypass, so an update run as `system` would try to
  // move the lead into a tenant that does not exist.
  await runAs(tenantId, async () => {
    await prisma.sequenceEnrollment.create({
      data: {
        leadId: ids.enrolledLeadId,
        sequenceId: ids.sequenceId,
        status: 'active',
        currentStep: 2,
        tenantId,
      },
    });
    await prisma.lead.update({
      where: { id: ids.humanManagedLeadId },
      data: { operatingState: 'human_managed', operatingStateAt: new Date() },
    });
  });

  // Two approved versions; v1 activated. v2 exists so "pinned once" has something to drift to.
  const versions = await runAs(tenantId, async () => {
    const v1 = await createDraftVersion({
      playbookId: ids.playbookId,
      tenantId,
      createdById: directorId,
      rules: FIXTURE_RULES,
    });
    await approveVersion(v1.id, tenantId, directorId);
    await activateVersion(v1.id, tenantId);

    const v2 = await createDraftVersion({
      playbookId: ids.playbookId,
      tenantId,
      createdById: directorId,
      rules: { ...FIXTURE_RULES, valueProposition: 'Second version.' },
    });
    await approveVersion(v2.id, tenantId, directorId);

    return { versionOneId: v1.id, versionTwoId: v2.id };
  });

  return {
    tenantId,
    otherTenantId,
    directorId,
    sdrId,
    otherDirectorId,
    ...ids,
    ...versions,
  };
}

/** Clear only the work order rows, leaving the fixture's leads and campaign intact. */
export async function resetWorkOrders(fixture: WorkOrderFixture): Promise<void> {
  const tenants = [fixture.tenantId, fixture.otherTenantId];
  await runSystem(async () => {
    await prisma.workOrderLease.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.workOrder.deleteMany({ where: { tenantId: { in: tenants } } });
  });
}
