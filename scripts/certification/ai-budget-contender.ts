/**
 * One contender in the durable AI budget concurrency proof (TEL-P1-015).
 *
 * Each invocation is a **separate operating-system process** with its own module registry,
 * so it shares nothing with its siblings except the database. That is the whole point: the
 * previous budget lived in a process-local Map, where N replicas could each spend the full
 * limit and no in-process test could ever have caught it.
 *
 * Prints a single JSON line so the calling test can count outcomes exactly.
 *
 *   DATABASE_URL=... npx tsx scripts/certification/ai-budget-contender.ts \
 *     --tenant <id> --period <YYYY-MM> --estimate 1.0
 */
import { AiBudgetExceededError, checkAndReserveAiBudget } from '@/lib/ai/budget';
import { prisma } from '@/lib/prisma';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function main() {
  const tenantId = arg('tenant', '');
  const periodKey = arg('period', '');
  const estimatedCostUsd = Number.parseFloat(arg('estimate', '1'));

  try {
    const reservation = await checkAndReserveAiBudget({
      tenantId,
      periodKey,
      estimatedCostUsd,
      operation: 'concurrency-proof',
    });
    process.stdout.write(
      `${JSON.stringify({ outcome: 'reserved', reservationId: reservation?.reservationId ?? null, pid: process.pid })}\n`,
    );
  } catch (error) {
    const outcome = error instanceof AiBudgetExceededError ? 'refused' : 'error';
    process.stdout.write(
      `${JSON.stringify({ outcome, message: error instanceof Error ? error.message : String(error), pid: process.pid })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
