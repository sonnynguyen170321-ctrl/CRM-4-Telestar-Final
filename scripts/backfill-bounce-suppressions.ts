/**
 * Suppress the addresses that already bounced and were never acted on.
 *
 * Production held 42 inbound hard bounces with `bouncedRecipient` null — every one of them —
 * because `extractBouncedRecipient` read only `X-Failed-Recipients` and the subject, while real
 * NDRs put the address in the RFC 3464 delivery-status part in the body. With no address there
 * was no lead to match, so `handleApplyBounce` never ran, so `SuppressionEntry` stayed empty
 * across 384 sends and `Lead.emailInvalid` stayed false on all 1,138 leads.
 *
 * The parser is fixed for new mail. This repairs the mail already sitting in the database:
 *
 *   1. re-parse every stored bounce whose recipient was never extracted
 *   2. write the address back onto the `InboundMessage`, so bounce-rate reporting is honest
 *   3. suppress it through `lib/email/suppress.ts` — the same door the live paths use
 *
 * It also sweeps `OutboundMessage` rows the provider refused for a recipient reason, which the
 * send path only began classifying on 2026-09-23.
 *
 * ## Read before running
 *
 *   npx tsx scripts/backfill-bounce-suppressions.ts            # report only
 *   npx tsx scripts/backfill-bounce-suppressions.ts --apply    # suppress
 *
 * Dry run by default, and it prints every address it would suppress before writing anything —
 * read that list. Suppression is not reversible by any automated path here, and a wrongly
 * suppressed address is a prospect nobody will ever email again.
 *
 * Idempotent: `suppressRecipient` is a no-op for an address already on the list, and a re-run
 * finds the recipients already written back.
 */
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { extractBouncedRecipient } from '@/lib/email/bounceDetection';
import { classifyRecipientFailure } from '@/lib/email/recipientFailure';
import { suppressRecipient } from '@/lib/email/suppress';
import { OUTBOUND_STATUS } from '@/lib/email/idempotency';

const APPLY = process.argv.includes('--apply');

type Found = { email: string; leadId: string | null; source: string; detail: string };

/** Bounces already in the inbox whose address was never extracted. */
async function fromInbound(): Promise<Found[]> {
  const bounces = await prisma.inboundMessage.findMany({
    where: { isBounce: true },
    select: {
      id: true,
      subject: true,
      body: true,
      bodyHtml: true,
      fromEmail: true,
      bounceType: true,
      bouncedRecipient: true,
    },
  });

  const found: Found[] = [];
  for (const msg of bounces) {
    const email =
      msg.bouncedRecipient ??
      extractBouncedRecipient({
        providerMessageId: msg.id,
        fromEmail: msg.fromEmail,
        subject: msg.subject ?? '',
        date: new Date(),
        failedRecipient: null,
        body: msg.body ?? '',
        bodyHtml: msg.bodyHtml ?? '',
      } as never);
    if (!email) continue;

    const lead = await prisma.lead.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });

    if (APPLY && !msg.bouncedRecipient) {
      // Write it back so bounce-rate reporting stops under-counting, and so a second run has
      // nothing left to re-parse.
      await prisma.inboundMessage.update({
        where: { id: msg.id },
        data: { bouncedRecipient: email },
      });
    }

    found.push({
      email,
      leadId: lead?.id ?? null,
      source: 'inbound bounce',
      detail: `${msg.bounceType ?? 'hard'} bounce: ${(msg.subject ?? '').slice(0, 60)}`,
    });
  }
  return found;
}

/** Sends the provider refused for a reason that was about the address. */
async function fromOutbound(): Promise<Found[]> {
  const refused = await prisma.outboundMessage.findMany({
    where: {
      status: { in: [OUTBOUND_STATUS.FAILED, OUTBOUND_STATUS.PERMANENTLY_FAILED] },
      sentAt: null,
      errorMessage: { not: null },
    },
    select: { id: true, to: true, leadId: true, errorMessage: true },
  });

  return refused
    .filter((msg) => classifyRecipientFailure(new Error(msg.errorMessage ?? '')) === 'recipient')
    .map((msg) => ({
      email: msg.to,
      leadId: msg.leadId,
      source: 'refused send',
      detail: (msg.errorMessage ?? '').slice(0, 70),
    }));
}

async function backfillTenant(tenantId: string, tenantName: string): Promise<void> {
  const found = [...(await fromInbound()), ...(await fromOutbound())];

  // One entry per address; the first occurrence keeps its detail so the activity row names a
  // real provider message rather than the last duplicate.
  const byEmail = new Map<string, Found>();
  for (const entry of found) {
    const email = entry.email.toLowerCase();
    if (!byEmail.has(email)) byEmail.set(email, { ...entry, email });
    else if (!byEmail.get(email)!.leadId && entry.leadId) byEmail.get(email)!.leadId = entry.leadId;
  }

  const already = await prisma.suppressionEntry.findMany({
    where: { tenantId, email: { in: [...byEmail.keys()] } },
    select: { email: true },
  });
  const suppressedAlready = new Set(already.map((e) => e.email?.toLowerCase()));
  const pending = [...byEmail.values()].filter((e) => !suppressedAlready.has(e.email));

  console.log(
    `  ${tenantName}: ${found.length} bounce signal(s), ${byEmail.size} distinct address(es),` +
      ` ${pending.length} not yet suppressed.`
  );
  for (const entry of pending) {
    console.log(`    ${entry.email}  [${entry.source}] ${entry.leadId ? '' : '(no lead matched) '}${entry.detail}`);
  }

  if (!APPLY) return;

  let suppressed = 0;
  for (const entry of pending) {
    const result = await suppressRecipient({
      tenantId,
      email: entry.email,
      leadId: entry.leadId,
      reason: 'hard_bounce',
      detail: entry.detail,
    });
    if (result.newlySuppressed) suppressed++;
  }
  console.log(`    suppressed ${suppressed} address(es).`);
}

async function main() {
  console.log(
    APPLY
      ? 'Backfilling bounce suppressions (WRITING).'
      : 'Backfilling bounce suppressions (dry run — pass --apply to write).'
  );

  const tenants = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, () =>
    prisma.tenant.findMany({ select: { id: true, name: true } })
  );

  for (const tenant of tenants) {
    await tenantStorage.run({ tenantId: tenant.id }, () => backfillTenant(tenant.id, tenant.name));
  }

  console.log(APPLY ? 'Done.' : 'Dry run complete — nothing was written.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
