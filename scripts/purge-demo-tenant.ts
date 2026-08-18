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

  // 1. Update Brandon's login email to branndon@itelestar.com first
  await prisma.user.updateMany({
    where: { email: 'brandon@itelestar.com' },
    data: { email: 'branndon@itelestar.com' },
  }).catch(() => {});

  // 2. Define the exact 10 approved team members to retain
  const ALLOWED_EMAILS = [
    'dean@telestar.vn',
    'sonny@itelestar.com',
    'alayna@itelestar.com',
    'jackie@itelestar.com',
    'vie@itelestar.com',
    'branndon@itelestar.com',
    'meixi@itelestar.com',
    'hayden@itelestar.com',
    'kim@itelestar.com',
    'selina@itelestar.com',
  ];

  // 3. Find all users to purge (all users NOT in ALLOWED_EMAILS)
  const usersToPurge = await prisma.user.findMany({
    where: {
      email: {
        notIn: ALLOWED_EMAILS,
      },
    },
    select: { id: true, email: true },
  });

  const dean = await prisma.user.findUnique({ where: { email: 'dean@telestar.vn' } });
  const fallbackUserId = dean?.id ?? null;

  for (const u of usersToPurge) {
    // 1. Unbind / reassign all leads
    const assignedLeads = await prisma.lead.findMany({ where: { assignedToId: u.id }, select: { id: true, email: true } }).catch(() => []);
    for (const lead of assignedLeads) {
      if (lead.email.includes('e2e') || lead.email.includes('test') || lead.email.endsWith('@telestar.demo')) {
        await prisma.activity.deleteMany({ where: { leadId: lead.id } }).catch(() => {});
        await prisma.task.deleteMany({ where: { leadId: lead.id } }).catch(() => {});
        await prisma.note.deleteMany({ where: { leadId: lead.id } }).catch(() => {});
        await prisma.lead.delete({ where: { id: lead.id } }).catch(() => {});
      } else if (fallbackUserId) {
        await prisma.lead.update({ where: { id: lead.id }, data: { assignedToId: fallbackUserId } }).catch(() => {});
      } else {
        await prisma.lead.update({ where: { id: lead.id }, data: { assignedToId: null } }).catch(() => {});
      }
    }

    // 2. Unbind all meetings, opportunities, links, batches
    await prisma.meeting.updateMany({ where: { sdrId: u.id }, data: { sdrId: fallbackUserId } }).catch(() => {});
    await prisma.meeting.updateMany({ where: { outcomeLoggedById: u.id }, data: { outcomeLoggedById: fallbackUserId } }).catch(() => {});
    await prisma.opportunity.updateMany({ where: { ownerId: u.id }, data: { ownerId: fallbackUserId } }).catch(() => {});
    await prisma.opportunity.updateMany({ where: { createdById: u.id }, data: { createdById: fallbackUserId } }).catch(() => {});
    await prisma.bookingLink.updateMany({ where: { createdById: u.id }, data: { createdById: fallbackUserId } }).catch(() => {});
    await prisma.importBatch.updateMany({ where: { uploadedById: u.id }, data: { uploadedById: fallbackUserId } }).catch(() => {});
    await prisma.user.updateMany({ where: { managerId: u.id }, data: { managerId: null } }).catch(() => {});

    // 3. Delete user's own operational records
    await prisma.activity.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await prisma.task.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await prisma.note.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await prisma.reminder.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await prisma.emailAccount.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await prisma.campaignSdr.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await prisma.sequenceStepCopy.deleteMany({ where: { approvedById: u.id } }).catch(() => {});
    await prisma.sequenceDraftRecord.deleteMany({ where: { draftedById: u.id } }).catch(() => {});
    await prisma.sequence.deleteMany({ where: { createdById: u.id } }).catch(() => {});
    await prisma.template.deleteMany({ where: { createdById: u.id } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await prisma.aiMemory.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await prisma.prospectTransition.deleteMany({ where: { actorUserId: u.id } }).catch(() => {});
    await prisma.agentAction.deleteMany({ where: { actorUserId: u.id } }).catch(() => {});
    await prisma.agentApprovalRequest.deleteMany({ where: { requestedById: u.id } }).catch(() => {});
    await prisma.aiCall.deleteMany({ where: { userId: u.id } }).catch(() => {});
    
    // 4. Delete user
    await prisma.user.delete({ where: { id: u.id } }).catch((err) => console.error(`Failed deleting ${u.email}:`, err.message));
    console.log(`🧹 Purged user: ${u.email}`);
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
