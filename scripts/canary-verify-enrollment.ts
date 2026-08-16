import { prisma } from '@/lib/prisma';

async function main() {
  const enrollment = await prisma.$queryRaw`
    SELECT id, "currentStep", status, "lastActionAt", "nextActionAt"
    FROM "SequenceEnrollment"
    WHERE id = 'enr_canary_drill'
  `;
  console.log('\n=== Sequence Enrollment Status in DB ===');
  console.table(enrollment);
}

main().catch(console.error);
