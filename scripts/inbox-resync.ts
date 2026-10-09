/**
 * Re-read every connected mailbox over the past N days, so bounces and replies the inbox sync never
 * read are found and applied (owner, 2026-10-09: a bounced address was sent the follow-up).
 *
 * Until the fix that shipped with this script, each sync run read only the newest 50 messages and
 * moved its cursor to "now"; whatever lay beyond those 50 was never read. This walks the same
 * window again through the normal sync path — paged, oldest first — so each newly found bounce is
 * stored, matched and applied exactly as a live one would be. Messages already stored are skipped
 * by their provider id.
 *
 * It does not move a mailbox's live cursor: re-reading the past must never hold up today's replies.
 *
 * Dry run by default — lists the mailboxes it would read. Run inside the web container (the same
 * image and env as the worker, mail credentials included):
 *
 *   docker compose ... exec -T web npx tsx scripts/inbox-resync.ts --days 30
 *   docker compose ... exec -T web npx tsx scripts/inbox-resync.ts --days 30 --apply
 *   docker compose ... exec -T web npx tsx scripts/inbox-resync.ts --days 30 --apply --mailbox mei@nekko.tech
 *   ... --apply --mailbox mei@nekko.tech --from 2026-10-01T08:00:00Z   # resume where a failed run stopped
 *
 * Within the window, a reply older than the lead's current enrollment and any old out-of-office are
 * stored but not acted on (workers/sync.ts re-read guard); bounces always are.
 */
import { prisma } from '@/lib/prisma';
import { handleEmailSync } from '@/workers/sync';

import { forEachTenant } from './lib/tenantContext';

const APPLY = process.argv.includes('--apply');

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const DAYS = Number(argValue('--days') ?? 30);
const ONLY_MAILBOX = argValue('--mailbox')?.toLowerCase() ?? null;
const RESUME_FROM = argValue('--from');
/** Runs per mailbox; each reads up to SYNC_READ_LIMIT messages. */
const MAX_RUNS_PER_MAILBOX = 200;

type Totals = { runs: number; messages: number; replies: number; bounces: number; autoReplies: number; overflow: boolean };
type Outcome = Totals & { finished: boolean; reached: Date; error?: string };

async function resyncMailbox(accountId: string, from: Date): Promise<Outcome> {
  const totals: Totals = { runs: 0, messages: 0, replies: 0, bounces: 0, autoReplies: 0, overflow: false };
  let since = from;
  while (totals.runs < MAX_RUNS_PER_MAILBOX) {
    let result: Record<string, unknown>;
    try {
      result = (await handleEmailSync({ accountId, since: since.toISOString() })) as Record<string, unknown>;
    } catch (error) {
      return { ...totals, finished: false, reached: since, error: error instanceof Error ? error.message : String(error) };
    }
    totals.runs += 1;
    if (result.skipped) return { ...totals, finished: true, reached: since, error: String(result.reason) };
    totals.messages += Number(result.messagesProcessed ?? 0);
    totals.replies += Number(result.replies ?? 0);
    totals.bounces += Number(result.bounces ?? 0);
    totals.autoReplies += Number(result.autoReplies ?? 0);
    if (result.overflow) totals.overflow = true;
    if (!result.truncated) return { ...totals, finished: true, reached: new Date() };
    const next = new Date(String(result.cursor));
    if (!(next.getTime() > since.getTime())) {
      return { ...totals, finished: false, reached: since, error: 'the cursor did not advance; stopping rather than looping' };
    }
    since = next;
  }
  return { ...totals, finished: false, reached: since, error: `stopped after ${MAX_RUNS_PER_MAILBOX} runs` };
}

async function main() {
  if (!Number.isFinite(DAYS) || DAYS <= 0 || DAYS > 180) {
    throw new Error('--days must be between 1 and 180');
  }
  const from = RESUME_FROM ? new Date(RESUME_FROM) : new Date(Date.now() - DAYS * 86_400_000);
  if (Number.isNaN(from.getTime())) throw new Error('--from must be an ISO time');
  console.log(`${APPLY ? 'Re-reading' : 'Would re-read (dry run — pass --apply)'} mail since ${from.toISOString()} (${DAYS} days).`);

  await forEachTenant(async (tenant) => {
    const mailboxes = await prisma.emailAccount.findMany({
      where: { tenantId: tenant.id, isActive: true, ...(ONLY_MAILBOX ? { email: { equals: ONLY_MAILBOX, mode: 'insensitive' } } : {}) },
      select: { id: true, email: true, provider: true, lastSyncAt: true },
      orderBy: { email: 'asc' },
    });
    console.log(`\n${tenant.name} (${tenant.id}): ${mailboxes.length} active mailbox(es)`);

    for (const mailbox of mailboxes) {
      const label = `  ${mailbox.email} [${mailbox.provider}] last synced ${mailbox.lastSyncAt?.toISOString() ?? 'never'}`;
      if (!APPLY) {
        console.log(label);
        continue;
      }
      const done = await resyncMailbox(mailbox.id, from);
      console.log(
        `${label} -> ${done.runs} run(s), ${done.messages} message(s) read, ${done.bounces} bounce(s), ${done.replies} repl(ies), ${done.autoReplies} auto-repl(ies)` +
          (done.error ? ` — ${done.finished ? 'skipped' : 'NOT FINISHED'}: ${done.error}` : '')
      );
      if (!done.finished) {
        console.log(`      resume with: --apply --mailbox ${mailbox.email} --from ${done.reached.toISOString()}`);
      }
      if (done.overflow) {
        console.log('      WARNING: more mail than one listing holds — re-run this mailbox with a smaller --days');
      }
    }
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
