import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { handleEnroll } from '@/workers/sequence';
import { executeTask } from '@/workers/sequence';

async function main() {
  console.log('\n=== Phase C: Automated Sequence Canary Drill ===');

  const tenantRows: any = await prisma.$queryRaw`SELECT id FROM "Tenant" LIMIT 1`;
  const tenantId = tenantRows[0].id;

  // Find user with connected active mailbox (e.g. Sonny or Dean)
  const accountRows: any = await prisma.$queryRaw`
    SELECT "userId" FROM "EmailAccount" WHERE "isActive" = true LIMIT 1
  `;
  const userId = accountRows[0].userId;

  const campaignRows: any = await prisma.$queryRaw`SELECT id FROM "Campaign" LIMIT 1`;
  const campaignId = campaignRows[0].id;

  await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
    // 1. Create or Find Template
    const templateName = 'Phase C Canary Email Template';
    let template = await prisma.template.findFirst({
      where: { name: templateName, tenantId },
    });

    if (!template) {
      template = await prisma.template.create({
        data: {
          name: templateName,
          channel: 'email',
          subject: 'Phase C Automated Cadence — Step 1',
          body: '<p>Hi Sonny,</p><p>This is Step 1 of the automated multi-step sequence executed by Telestar CRM BullMQ sequence engine.</p>',
          tenantId,
          createdById: userId,
        },
      });
      console.log('  + Created Template:', template.name);
    }

    // 2. Create or Find Canary Sequence & Step
    const sequenceName = 'Phase C Live Canary Sequence';
    let sequence = await prisma.sequence.findFirst({
      where: { name: sequenceName, tenantId },
      include: { steps: true },
    });

    if (!sequence) {
      sequence = await prisma.sequence.create({
        data: {
          name: sequenceName,
          tenantId,
          createdById: userId,
          steps: {
            create: [
              {
                order: 1,
                channel: 'email',
                delayDays: 0,
                delayHours: 0,
                templateId: template.id,
                instructions: 'Phase C Automated Canary Dispatch — Step 1',
                autoComplete: true,
                tenantId,
              },
            ],
          },
        },
        include: { steps: true },
      });
      console.log('  + Created Sequence & Step 1 with Template attached');
    } else {
      // Ensure step 1 points to our template
      await prisma.sequenceStep.updateMany({
        where: { sequenceId: sequence.id, order: 1 },
        data: { templateId: template.id, autoComplete: true },
      });
    }

    // 3. Create or Find Canary Lead assigned to user with connected inbox
    const canaryEmail = 'sonny@itelestar.com';
    let lead = await prisma.lead.findFirst({
      where: { email: canaryEmail, tenantId },
    });

    if (!lead) {
      lead = await prisma.lead.create({
        data: {
          firstName: 'Sonny',
          lastName: 'Canary',
          company: 'Telestar Canary Corp',
          email: canaryEmail,
          stage: 'new',
          crmPriorityScore: 'hot',
          tenantId,
          assignedToId: userId,
          campaignId,
        } as any,
      });
      console.log('  + Created Lead:', lead.email);
    } else {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { assignedToId: userId },
      });
    }

    // 4. Enroll Lead via native Sequence Worker
    console.log('==> Enrolling Lead in Sequence via BullMQ Worker...');
    await handleEnroll({
      leadId: lead.id,
      sequenceId: sequence.id,
      userId,
    });
    console.log('  + Lead enrolled and Step 1 Task generated.');

    // 5. Find Step 1 Task and trigger execution
    const task = await prisma.task.findFirst({
      where: { leadId: lead.id, sequenceId: sequence.id, status: 'pending' },
      include: {
        lead: {
          include: {
            assignedTo: true,
            campaign: true,
            sequence: true,
          },
        },
      },
    });

    if (task) {
      console.log('==> Executing Automated Step Task:', task.id);
      const res = await executeTask({ taskId: task.id });
      console.log('  + Execution Result:', JSON.stringify(res));
    }

    console.log('✅ Phase C Automated Sequence Execution Completed.\n');
  });
}

main().catch(console.error);
