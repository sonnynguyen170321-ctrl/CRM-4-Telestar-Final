#!/usr/bin/env node
/**
 * Make sequence email steps that have a template send themselves.
 *
 * Dry run by default: lists, per step, the pending tasks, the active enrollments and the mailbox
 * state, and writes nothing. --apply turns auto-send on and gives each pending task a new due time
 * at the next send window, spread over --spread-minutes, so nothing is sent in a burst.
 *
 * Usage:
 *   npx tsx scripts/sequence-email-autosend.ts                       (dry run, every tenant)
 *   npx tsx scripts/sequence-email-autosend.ts --tenant <tenantId>   (dry run, one tenant)
 *   npx tsx scripts/sequence-email-autosend.ts --apply --tenant <tenantId>
 *   npx tsx scripts/sequence-email-autosend.ts --apply --spread-minutes 480
 *
 * Safe to run again: a converted step is not listed again, and a task that already has an
 * execution job is not scheduled again. See lib/sequences/autoSendConversion.ts.
 */
import { prisma } from '../lib/prisma';
import {
  DEFAULT_SPREAD_MINUTES,
  applyAutoSendConversion,
  planAutoSendConversion,
  type AutoSendCandidate,
} from '../lib/sequences/autoSendConversion';
import { forEachTenant } from './lib/tenantContext';

const MAILBOX_TEXT: Record<AutoSendCandidate['mailbox'], string> = {
  ok: 'mailbox ok',
  none_chosen: 'NO MAILBOX CHOSEN (steps will be held until one is)',
  all_disconnected: 'ALL MAILBOXES DISCONNECTED (steps will be held)',
};

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
}

function printCandidate(c: AutoSendCandidate): void {
  const action = c.willConvert ? 'convert' : 'schedule only';
  console.log(
    `  [${action}] ${c.sequenceName}${c.sequenceActive ? '' : ' (inactive)'} - step ${c.stepOrder}: ` +
      `${c.pendingTasks} pending task(s), ${c.unscheduledTasks} without a job, ` +
      `${c.activeEnrollments} active enrollment(s), ${MAILBOX_TEXT[c.mailbox]}`
  );
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const tenantId = argValue(args, '--tenant');
  const spreadRaw = argValue(args, '--spread-minutes');
  const spreadMinutes = spreadRaw ? Number(spreadRaw) : DEFAULT_SPREAD_MINUTES;
  if (!Number.isFinite(spreadMinutes) || spreadMinutes < 1) {
    throw new Error(`--spread-minutes must be a positive number, got "${spreadRaw}"`);
  }

  console.log('Sequence email auto-send conversion');
  console.log(`Mode:    ${apply ? 'APPLY (writing changes)' : 'DRY RUN (no changes will be written)'}`);
  if (tenantId) console.log(`Tenant:  ${tenantId}`);
  if (apply) console.log(`Spread:  pending tasks go out over ${spreadMinutes} minutes from the next send window`);
  console.log('');

  // Inside tenant context, always: with none, production reads return [] and a dry run would
  // report "nothing to do" having looked at nothing (scripts/lib/tenantContext.ts).
  const runs = await forEachTenant(async (tenant) => {
    if (tenantId && tenant.id !== tenantId) return null;
    const candidates = await planAutoSendConversion(tenant.id);
    console.log(`Tenant ${tenant.name} (${tenant.id}): ${candidates.length} step(s)`);
    candidates.forEach(printCandidate);
    if (!apply || candidates.length === 0) return { converted: 0, rescheduled: 0 };

    const result = await applyAutoSendConversion(candidates, { tenantId: tenant.id, spreadMinutes });
    result.skipped.forEach((s) => console.log(`    skipped task ${s.taskId}: ${s.reason}`));
    console.log(`  converted ${result.convertedSteps} step(s), scheduled ${result.rescheduled} task(s)`);
    return { converted: result.convertedSteps, rescheduled: result.rescheduled };
  });

  const visited = runs.filter((r): r is NonNullable<typeof r> => r !== null);
  if (tenantId && visited.length === 0) throw new Error(`Unknown tenant ${tenantId}`);
  console.log('');
  console.log(
    apply
      ? `Done. Converted ${visited.reduce((n, r) => n + r.converted, 0)} step(s), scheduled ${visited.reduce((n, r) => n + r.rescheduled, 0)} task(s).`
      : 'Dry run only. Re-run with --apply to convert.'
  );
}

main()
  .catch((err) => {
    console.error('sequence-email-autosend error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
