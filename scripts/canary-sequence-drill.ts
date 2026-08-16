import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { createTaskForStep } from '@/lib/sequences/engine';

async function main() {
  console.log('\n=== Phase C: Seeding Automated Sequence & Canary Lead via Prisma ===');

  const tenantRows: any = await prisma.$queryRaw`SELECT id FROM "Tenant" LIMIT 1`;
  const tenantId = tenantRows[0].id;

  const userRows: any = await prisma.$queryRaw`
    SELECT id FROM "User" WHERE role IN ('sdr', 'floor_manager', 'director') LIMIT 1
  `;
  const userId = userRows[0].id;

  await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
    // 1. Create or Find Canary Sequence & Step
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
                instructions: 'Phase C Automated Canary Dispatch — Step 1',
                autoComplete: true,
                tenantId,
              },
            ],
          },
        },
        include: { steps: true },
      });
      console.log('  + Created Sequence & Step 1 via Prisma');
    }

    // 2. Create or Find Canary Lead
    const canaryEmail = 'sonny@itelestar.com';
    let lead = await prisma.lead.findFirst({
      where: { email: canaryEmail, tenantId },
    });

    if (!lead) {
      lead = await prisma.lead.create({
        data: {
          firstName: 'Sonny',
          lastName: 'Canary',
          email: canaryEmail,
          stage: 'new',
          crmPriorityScore: 'hot',
          tenantId,
          assignedToId: userId,
        },
      });
      console.log('  + Created Lead:', lead.email);
    }

    // 3. Create Automated Step Task via Sequence Engine
    const step1 = sequence.steps[0];
    const task = await createTaskForStep(lead, sequence, step1, new Date());
    console.log('  + Created Sequence Task:', task.id, '| Title:', task.title, '| DueDate:', task.dueDate);

    console.log('✅ Phase C Canary Setup Ready.\n');
  });
}

main().catch(console.error);
