import { prisma } from '@/lib/prisma';

async function main() {
  console.log('\n=== Phase C: Seeding Automated Sequence & Canary Lead ===');

  const tenantRows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Tenant" LIMIT 1`;
  const tenantId = tenantRows[0].id;
  const userRows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE role = 'sdr' OR role = 'floor_manager' LIMIT 1`;
  const userId = userRows[0].id;

  // 1. Create or Find Canary Sequence & Step
  const sequenceId = 'seq_canary_drill';
  const existingSeq = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Sequence" WHERE id = ${sequenceId}`;
  if (!existingSeq || existingSeq.length === 0) {
    await prisma.$executeRaw`
      INSERT INTO "Sequence" (id, name, "tenantId", "createdAt", "updatedAt")
      VALUES (${sequenceId}, 'Phase C Live Canary Sequence', ${tenantId}, NOW(), NOW())
    `;
    await prisma.$executeRaw`
      INSERT INTO "SequenceStep" (id, "sequenceId", "stepNumber", "dayOffset", "taskType", "subjectTemplate", "bodyTemplate", "tenantId", "createdAt", "updatedAt")
      VALUES (
        'step_canary_1',
        ${sequenceId},
        1,
        0,
        'email',
        'Phase C Automated Cadence — Step 1',
        '<p>Hi Sonny,</p><p>This is Step 1 of the automated multi-step sequence executed by Telestar CRM BullMQ sequence engine.</p>',
        ${tenantId},
        NOW(),
        NOW()
      )
    `;
    console.log('  + Created Canary Sequence & Step 1');
  }

  // 2. Create or Find Canary Lead
  const leadId = 'lead_canary_drill';
  const existingLead = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Lead" WHERE id = ${leadId}`;
  if (!existingLead || existingLead.length === 0) {
    await prisma.$executeRaw`
      INSERT INTO "Lead" (
        id, "firstName", "lastName", email, stage, priority, "tenantId", "assignedToId", "createdAt", "updatedAt"
      ) VALUES (
        ${leadId},
        'Sonny',
        'Canary',
        'sonny@itelestar.com',
        'new',
        'hot',
        ${tenantId},
        ${userId},
        NOW(),
        NOW()
      )
    `;
    console.log('  + Created Canary Lead: sonny@itelestar.com');
  }

  // 3. Enroll Lead with immediate execution
  const enrollmentId = 'enr_canary_drill';
  await prisma.$executeRaw`
    DELETE FROM "SequenceEnrollment" WHERE id = ${enrollmentId} OR "leadId" = ${leadId}
  `;
  await prisma.$executeRaw`
    INSERT INTO "SequenceEnrollment" (
      id, "sequenceId", "leadId", "currentStep", status, "nextActionAt", "tenantId", "createdAt", "updatedAt"
    ) VALUES (
      ${enrollmentId},
      ${sequenceId},
      ${leadId},
      1,
      'active',
      NOW(),
      ${tenantId},
      NOW(),
      NOW()
    )
  `;
  console.log('  + Enrolled Lead with nextActionAt = NOW()');
  console.log('✅ Sequence enrollment ready for automated execution.\n');
}

main().catch(console.error);
