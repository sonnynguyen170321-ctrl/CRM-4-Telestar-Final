import { hash } from 'bcryptjs';
import { createAdminClient } from '@/lib/db/adminClient.mjs';

const prisma = createAdminClient();
const TENANT_ID = 'default-tenant';
const DIRECTOR_EMAIL = 'dean@telestar.vn';
const DIRECTOR_PASSWORD = process.env.DIRECTOR_PASSWORD || 'Telestar2026';

async function safeUpdate(model: string, args: any) {
  try {
    if ((prisma as any)[model]?.updateMany) {
      await (prisma as any)[model].updateMany(args);
    }
  } catch (e: any) {
    console.warn(`[safeUpdate:${model}]`, e.message);
  }
}

async function safeDelete(model: string, args: any) {
  try {
    if ((prisma as any)[model]?.deleteMany) {
      await (prisma as any)[model].deleteMany(args);
    }
  } catch (e: any) {
    console.warn(`[safeDelete:${model}]`, e.message);
  }
}

async function main() {
  console.log('========================================================================');
  console.log(`🧹 CLEANUP: RETAINING ONLY ${DIRECTOR_EMAIL} AS ACTIVE DIRECTOR`);
  console.log('========================================================================\n');

  // 1. Ensure Default Tenant
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: { name: 'Telestar SDR Production Tenant' },
    create: { id: TENANT_ID, name: 'Telestar SDR Production Tenant' },
  });

  const passwordHash = await hash(DIRECTOR_PASSWORD, 12);

  // 2. Ensure Dean is upserted as Director and Active
  const dean = await prisma.user.upsert({
    where: { email: DIRECTOR_EMAIL.toLowerCase() },
    update: {
      firstName: 'Dean',
      lastName: 'Nguyen',
      role: 'director',
      password: passwordHash,
      isActive: true,
      authVersion: { increment: 1 },
      managerId: null,
      tenantId: TENANT_ID,
    },
    create: {
      email: DIRECTOR_EMAIL.toLowerCase(),
      firstName: 'Dean',
      lastName: 'Nguyen',
      role: 'director',
      password: passwordHash,
      isActive: true,
      tenantId: TENANT_ID,
    },
  });

  console.log(`✅ Director Account Established: ${dean.email} (ID: ${dean.id})`);

  // 3. Clear managerId references from all users
  await prisma.user.updateMany({
    where: { id: { not: dean.id } },
    data: { managerId: null },
  });

  // 4. Find all other users
  const otherUsers = await prisma.user.findMany({
    where: { id: { not: dean.id } },
    select: { id: true, email: true },
  });

  const otherUserIds = otherUsers.map((u) => u.id);
  console.log(`🔍 Found ${otherUserIds.length} other user accounts to purge...`);

  if (otherUserIds.length > 0) {
    console.log('🔗 Reassigning all foreign key relations to Dean...');

    // Sequences & Templates
    await safeUpdate('sequence', { where: { createdById: { in: otherUserIds } }, data: { createdById: dean.id } });
    await safeUpdate('template', { where: { createdById: { in: otherUserIds } }, data: { createdById: dean.id } });

    // Reports & Exports & Links
    await safeUpdate('clientReport', { where: { createdById: { in: otherUserIds } }, data: { createdById: dean.id } });
    await safeUpdate('clientReport', { where: { generatedById: { in: otherUserIds } }, data: { generatedById: dean.id } });
    await safeUpdate('clientReport', { where: { approvedById: { in: otherUserIds } }, data: { approvedById: dean.id } });
    await safeUpdate('clientReportExport', { where: { exportedById: { in: otherUserIds } }, data: { exportedById: dean.id } });
    await safeUpdate('clientReportShareLink', { where: { createdById: { in: otherUserIds } }, data: { createdById: dean.id } });

    // Work Orders
    await safeUpdate('workOrder', { where: { createdById: { in: otherUserIds } }, data: { createdById: dean.id } });
    await safeUpdate('workOrder', { where: { sdrId: { in: otherUserIds } }, data: { sdrId: null } });
    await safeUpdate('workOrder', { where: { assignedByUserId: { in: otherUserIds } }, data: { assignedByUserId: null } });

    // Meetings
    await safeUpdate('meeting', { where: { sdrId: { in: otherUserIds } }, data: { sdrId: dean.id } });
    await safeUpdate('meeting', { where: { outcomeLoggedById: { in: otherUserIds } }, data: { outcomeLoggedById: dean.id } });

    // Opportunities
    await safeUpdate('opportunity', { where: { ownerId: { in: otherUserIds } }, data: { ownerId: dean.id } });
    await safeUpdate('opportunity', { where: { createdById: { in: otherUserIds } }, data: { createdById: dean.id } });
    await safeUpdate('opportunityActivity', { where: { userId: { in: otherUserIds } }, data: { userId: dean.id } });

    // Leads & Contacts
    await safeUpdate('lead', { where: { assignedToId: { in: otherUserIds } }, data: { assignedToId: dean.id } });
    await safeUpdate('lead', { where: { claimedById: { in: otherUserIds } }, data: { claimedById: null } });
    await safeUpdate('contact', { where: { assignedToId: { in: otherUserIds } }, data: { assignedToId: dean.id } });
    await safeUpdate('contact', { where: { relationshipOwnerId: { in: otherUserIds } }, data: { relationshipOwnerId: null } });
    await safeUpdate('contactEvidence', { where: { capturedById: { in: otherUserIds } }, data: { capturedById: null } });
    await safeUpdate('account', { where: { assignedToId: { in: otherUserIds } }, data: { assignedToId: dean.id } });

    // Campaigns & Lead Pool
    await safeUpdate('campaign', { where: { managerId: { in: otherUserIds } }, data: { managerId: dean.id } });
    await safeUpdate('leadPoolItem', { where: { qualifiedById: { in: otherUserIds } }, data: { qualifiedById: null } });
    await safeUpdate('leadPoolItem', { where: { assignedSdrId: { in: otherUserIds } }, data: { assignedSdrId: null } });
    await safeUpdate('leadPoolItem', { where: { assignedById: { in: otherUserIds } }, data: { assignedById: null } });
    await safeUpdate('campaignLeadRequirement', { where: { createdById: { in: otherUserIds } }, data: { createdById: dean.id } });

    // Tasks & Notes & Messages & Imports
    await safeUpdate('task', { where: { userId: { in: otherUserIds } }, data: { userId: dean.id } });
    await safeUpdate('task', { where: { assignedToId: { in: otherUserIds } }, data: { assignedToId: dean.id } });
    await safeUpdate('note', { where: { userId: { in: otherUserIds } }, data: { userId: dean.id } });
    await safeUpdate('note', { where: { createdById: { in: otherUserIds } }, data: { createdById: dean.id } });
    await safeUpdate('outboundMessage', { where: { sentByUserId: { in: otherUserIds } }, data: { sentByUserId: dean.id } });
    await safeUpdate('importBatch', { where: { userId: { in: otherUserIds } }, data: { userId: dean.id } });

    // Proposals & Approvals
    await safeUpdate('playbookProposal', { where: { authorId: { in: otherUserIds } }, data: { authorId: dean.id } });
    await safeUpdate('campaignPlaybookVersion', { where: { approvedById: { in: otherUserIds } }, data: { approvedById: null } });
    await safeUpdate('campaignPlaybookVersion', { where: { draftedById: { in: otherUserIds } }, data: { draftedById: null } });
    await safeUpdate('agentApprovalRequest', { where: { requestedById: { in: otherUserIds } }, data: { requestedById: dean.id } });
    await safeUpdate('agentApprovalRequest', { where: { approvedById: { in: otherUserIds } }, data: { approvedById: null } });

    // Reassign user-bound models to Dean
    await safeUpdate('emailAccount', { where: { userId: { in: otherUserIds } }, data: { userId: dean.id } });
    await safeUpdate('activity', { where: { userId: { in: otherUserIds } }, data: { userId: dean.id } });
    await safeUpdate('notification', { where: { userId: { in: otherUserIds } }, data: { userId: dean.id } });
    await safeUpdate('reminder', { where: { userId: { in: otherUserIds } }, data: { userId: dean.id } });
    await safeUpdate('agentAction', { where: { userId: { in: otherUserIds } }, data: { userId: dean.id } });
    await safeUpdate('bookingLink', { where: { userId: { in: otherUserIds } }, data: { userId: dean.id } });
    await safeUpdate('leadgenActivity', { where: { userId: { in: otherUserIds } }, data: { userId: dean.id } });
    await safeUpdate('autonomyPolicy', { where: { userId: { in: otherUserIds } }, data: { userId: dean.id } });

    // Audits & Joins
    await safeDelete('campaignSdr', { where: { userId: { in: otherUserIds } } });
    await safeDelete('userRoleAudit', { where: { userId: { in: otherUserIds } } });
    await safeDelete('workTransferAudit', { where: { fromUserId: { in: otherUserIds } } });
    await safeDelete('workTransferAudit', { where: { toUserId: { in: otherUserIds } } });
    await safeDelete('workTransferAudit', { where: { initiatedByUserId: { in: otherUserIds } } });
    await safeDelete('apiKey', { where: { createdById: { in: otherUserIds } } });

    // Delete the other users in batches of 500
    console.log('🗑️ Deleting other user records in chunks...');
    const chunkSize = 500;
    for (let i = 0; i < otherUserIds.length; i += chunkSize) {
      const chunk = otherUserIds.slice(i, i + chunkSize);
      await prisma.user.deleteMany({
        where: { id: { in: chunk } },
      });
    }

    console.log(`✅ All ${otherUserIds.length} non-Dean users successfully deleted.`);
  }

  // 5. Final Confirmation Table
  const remainingUsers = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  console.log('\n========================================================================');
  console.log(`🎉 FINAL CLEAN DATABASE STATE: ${remainingUsers.length} USER(S) TOTAL`);
  console.log('========================================================================\n');
  console.table(remainingUsers);
  console.log(`\n🔑 Login Credentials:`);
  console.log(`   Email:    ${DIRECTOR_EMAIL}`);
  console.log(`   Password: ${DIRECTOR_PASSWORD}\n`);
}

main()
  .then(async () => {
    await (prisma as any).$disconnect?.();
  })
  .catch(async (err) => {
    console.error('❌ Failed:', err instanceof Error ? err.message : err);
    await (prisma as any).$disconnect?.();
    process.exit(1);
  });
