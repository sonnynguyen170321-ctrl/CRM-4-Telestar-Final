import { prisma } from '@/lib/prisma';

async function main() {
  console.log('\n=== Sequence Enrollment Record in DB ===');
  const enrollment = await prisma.$queryRaw`
    SELECT * FROM "SequenceEnrollment"
    WHERE id = 'enr_canary_drill' OR "sequenceId" = 'seq_canary_drill'
    LIMIT 5
  `;
  console.table(enrollment);

  console.log('\n=== Automated Sequence Tasks in DB ===');
  const tasks = await prisma.$queryRaw`
    SELECT id, "leadId", type, title, status, "dueDate", "completedAt"
    FROM "Task"
    WHERE "sequenceId" = 'seq_canary_drill'
  `;
  console.table(tasks);

  console.log('\n=== Dispatched Outbound Messages in DB ===');
  const messages = await prisma.$queryRaw`
    SELECT id, "leadId", "to", subject, status, "providerMessageId", "createdAt"
    FROM "OutboundMessage"
    WHERE "to" = 'sonny@itelestar.com'
    ORDER BY "createdAt" DESC
    LIMIT 3
  `;
  console.table(messages);
}

main().catch(console.error);
