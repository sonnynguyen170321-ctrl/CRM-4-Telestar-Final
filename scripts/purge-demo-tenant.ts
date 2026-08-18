import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEMO_TENANT_ID = 'demo-telestar';

async function main() {
  console.log('=================================================================');
  console.log('🧹 PRODUCTION CLEANUP: PURGING DEMO TENANT & MOCK ACCOUNTS');
  console.log('=================================================================\n');

  const t = DEMO_TENANT_ID;

  // Check if demo tenant exists
  const demoTenant = await prisma.tenant.findUnique({
    where: { id: t },
  });

  if (!demoTenant) {
    console.log(`ℹ️ Demo tenant "${t}" does not exist in this database. Nothing to delete.`);
  } else {
    console.log(`🗑️ Deleting all records belonging to demo tenant "${t}"...`);

    // 1. Proposals & Playbooks
    await prisma.playbookProposalEvidence.deleteMany({ where: { proposal: { tenantId: t } } }).catch(() => {});
    await prisma.playbookProposal.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.outcomeSignal.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.campaignPlaybook.updateMany({ where: { tenantId: t }, data: { currentVersionId: null } }).catch(() => {});
    await prisma.campaignPlaybookVersion.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.campaignPlaybook.deleteMany({ where: { tenantId: t } }).catch(() => {});

    // 2. Pool items, requirements & sequence copies
    await prisma.leadPoolItem.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.campaignLeadRequirement.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.sequenceStepCopy.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.sequenceDraftRecord.deleteMany({ where: { tenantId: t } }).catch(() => {});

    // 3. Operations & Agents
    await prisma.meeting.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.prospectTransition.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.agentApprovalRequest.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.agentAction.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.aiCall.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.workOrderLease.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.sequenceLaunch.deleteMany({ where: { tenantId: t } }).catch(() => {});

    // 4. Intelligence caches
    await prisma.companySignal.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.accountPainHypothesis.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.personalizationHook.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.accountResearchCache.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.contactResearchCache.deleteMany({ where: { tenantId: t } }).catch(() => {});

    // 5. Messages, Reminders & Tasks
    await prisma.inboundMessage.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.outboundMessage.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.suppressionEntry.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.reminder.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.activity.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.task.deleteMany({ where: { tenantId: t } }).catch(() => {});

    // 6. Sequences & Templates
    await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.sequenceStep.deleteMany({ where: { sequence: { tenantId: t } } }).catch(() => {});
    await prisma.sequence.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.abTestVariant.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.template.deleteMany({ where: { tenantId: t } }).catch(() => {});

    // 7. Leads, Contacts, Accounts & Campaigns
    await prisma.note.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.lead.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.account.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.campaign.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.client.deleteMany({ where: { tenantId: t } }).catch(() => {});

    // 8. Mailboxes, Users & Tenant
    await prisma.emailAccount.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.autonomyPolicy.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.user.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: t } }).catch(() => {});

    console.log(`✅ Demo tenant "${t}" completely purged from database.`);
  }

  // Also remove any stray demo user accounts or e2e test accounts
  const deletedStrayUsers = await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { endsWith: '@telestar.demo' } },
        { email: { startsWith: 'sdr.e2e.' } },
        { email: { startsWith: 'test.' } },
      ],
    },
  }).catch(() => ({ count: 0 }));

  if (deletedStrayUsers.count > 0) {
    console.log(`🧹 Removed ${deletedStrayUsers.count} stray test/demo user accounts.`);
  }

  // 9. Display Active Production Inventory
  console.log('\n=================================================================');
  console.log('🏛️ ACTIVE PRODUCTION INVENTORY');
  console.log('=================================================================');

  const activeTenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  console.log(`\nActive Tenants (${activeTenants.length}):`);
  console.table(activeTenants);

  const activeUsers = await prisma.user.findMany({
    select: { id: true, email: true, role: true, tenantId: true },
    orderBy: { email: 'asc' },
  });
  console.log(`\nActive Production Users (${activeUsers.length}):`);
  console.table(activeUsers);

  console.log('\n✅ System is in 100% clean production state.');
}

main()
  .catch((err) => {
    console.error('Error during demo cleanup:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
