/**
 * Is every bounced address actually stopped? Read-only (owner, 2026-10-09: "make sure current leads
 * will not hit the same thing" — Spanco's step 1 bounced and step 2 was sent anyway).
 *
 * Per tenant:
 *   - bounced addresses with no suppression — a bounce recorded but never applied;
 *   - running or paused enrollments whose lead's address has bounced — the current leads at risk;
 *   - sends after a bounce: messages sent to an address after its first recorded bounce — the
 *     incident itself, counted everywhere it happened, with the last 7 days on their own line;
 *   - mailboxes never synced, or not synced for over 2 hours — bounces and replies unread there;
 *   - hours in the last 30 days when one mailbox received 50+ messages — where the old 50-per-run
 *     sync most likely dropped mail (scripts/inbox-resync.ts re-reads it).
 *
 * After the fix is deployed, run in order: inbox-resync → the `unapplied-bounces` maintenance repair
 * → this audit. "Unapplied" and "enrollments at risk" should then be 0, and "sends after a bounce
 * in the last 7 days" should stop growing.
 *
 *   docker compose ... exec -T web npx tsx scripts/audit-bounce-coverage.ts
 *   docker compose ... exec -T web npx tsx scripts/audit-bounce-coverage.ts --json
 */
import { prisma } from '@/lib/prisma';

import { forEachTenant } from './lib/tenantContext';

const JSON_OUTPUT = process.argv.includes('--json');
const SAMPLE = 20;
const CHUNK = 500;
const STALE_SYNC_MS = 2 * 60 * 60 * 1000;
const BURST_THRESHOLD = 50;
const DAY_MS = 86_400_000;

const chunks = <T>(items: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
};

type TenantReport = {
  tenant: string;
  bouncedAddresses: number;
  unapplied: { count: number; sample: string[] };
  enrollmentsAtRisk: { count: number; sample: { email: string; sequence: string; status: string }[] };
  sendsAfterBounce: { total: number; last7Days: number; sample: { to: string; firstBounceAt: string; sentAt: string; mailbox: string }[] };
  staleMailboxes: { email: string; lastSyncAt: string | null }[];
  burstHours: { mailbox: string; hour: string; messages: number }[];
};

async function auditTenant(tenantId: string, tenantName: string): Promise<TenantReport> {
  const now = Date.now();

  // Every address with bounce evidence, and when it first bounced.
  const firstBounce = new Map<string, number>();
  const note = (email: string | null, at: Date | null) => {
    if (!email || !at) return;
    const key = email.trim().toLowerCase();
    const time = at.getTime();
    const known = firstBounce.get(key);
    if (known === undefined || time < known) firstBounce.set(key, time);
  };
  const bouncedSends = await prisma.outboundMessage.findMany({
    where: { tenantId, bouncedAt: { not: null } },
    select: { to: true, bouncedAt: true },
  });
  bouncedSends.forEach((row) => note(row.to, row.bouncedAt));
  const bounceMessages = await prisma.inboundMessage.findMany({
    where: { tenantId, isBounce: true, bouncedRecipient: { not: null } },
    select: { bouncedRecipient: true, createdAt: true },
  });
  bounceMessages.forEach((row) => note(row.bouncedRecipient, row.createdAt));
  const addresses = [...firstBounce.keys()];

  // Bounced, but never suppressed.
  const suppressed = new Set<string>();
  for (const part of chunks(addresses)) {
    const rows = await prisma.suppressionEntry.findMany({ where: { tenantId, email: { in: part } }, select: { email: true } });
    rows.forEach((row) => row.email && suppressed.add(row.email.toLowerCase()));
  }
  const unapplied = addresses.filter((email) => !suppressed.has(email));

  // Current leads at risk: a running or paused cadence on a bounced address.
  const atRisk: TenantReport['enrollmentsAtRisk']['sample'] = [];
  let atRiskCount = 0;
  for (const part of chunks(addresses)) {
    const rows = await prisma.sequenceEnrollment.findMany({
      where: { tenantId, status: { in: ['active', 'paused'] }, lead: { email: { in: part, mode: 'insensitive' } } },
      select: { status: true, lead: { select: { email: true } }, sequence: { select: { name: true } } },
    });
    atRiskCount += rows.length;
    for (const row of rows) {
      if (atRisk.length < SAMPLE) atRisk.push({ email: row.lead.email, sequence: row.sequence.name, status: row.status });
    }
  }

  // The incident: a send after the address's first bounce.
  const after: TenantReport['sendsAfterBounce']['sample'] = [];
  let afterTotal = 0;
  let afterWeek = 0;
  for (const part of chunks(addresses)) {
    const sends = await prisma.outboundMessage.findMany({
      where: { tenantId, sentAt: { not: null }, to: { in: part, mode: 'insensitive' } },
      select: { to: true, sentAt: true, account: { select: { email: true } } },
    });
    for (const send of sends) {
      const first = firstBounce.get(send.to.toLowerCase());
      if (first === undefined || !send.sentAt || send.sentAt.getTime() <= first) continue;
      afterTotal += 1;
      if (send.sentAt.getTime() > now - 7 * DAY_MS) afterWeek += 1;
      if (after.length < SAMPLE) {
        after.push({ to: send.to, firstBounceAt: new Date(first).toISOString(), sentAt: send.sentAt.toISOString(), mailbox: send.account?.email ?? '?' });
      }
    }
  }

  const mailboxes = await prisma.emailAccount.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, email: true, lastSyncAt: true },
  });
  const staleMailboxes = mailboxes
    .filter((m) => !m.lastSyncAt || m.lastSyncAt.getTime() < now - STALE_SYNC_MS)
    .map((m) => ({ email: m.email, lastSyncAt: m.lastSyncAt?.toISOString() ?? null }));

  // Hours with a burst of mail into one mailbox, the last 30 days.
  const received = await prisma.inboundMessage.findMany({
    where: { tenantId, createdAt: { gte: new Date(now - 30 * DAY_MS) } },
    select: { accountId: true, date: true },
  });
  const perHour = new Map<string, number>();
  for (const row of received) {
    const hour = new Date(Math.floor(row.date.getTime() / 3_600_000) * 3_600_000).toISOString();
    const key = `${row.accountId}|${hour}`;
    perHour.set(key, (perHour.get(key) ?? 0) + 1);
  }
  const mailboxEmail = new Map(mailboxes.map((m) => [m.id, m.email]));
  const burstHours = [...perHour.entries()]
    .filter(([, count]) => count >= BURST_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SAMPLE)
    .map(([key, messages]) => {
      const [accountId, hour] = key.split('|');
      return { mailbox: mailboxEmail.get(accountId) ?? accountId, hour, messages };
    });

  return {
    tenant: `${tenantName} (${tenantId})`,
    bouncedAddresses: addresses.length,
    unapplied: { count: unapplied.length, sample: unapplied.slice(0, SAMPLE) },
    enrollmentsAtRisk: { count: atRiskCount, sample: atRisk },
    sendsAfterBounce: { total: afterTotal, last7Days: afterWeek, sample: after },
    staleMailboxes,
    burstHours,
  };
}

function print(report: TenantReport) {
  console.log(`\n== ${report.tenant}`);
  console.log(`  bounced addresses:                ${report.bouncedAddresses}`);
  console.log(`  bounced but not suppressed:       ${report.unapplied.count}${report.unapplied.count ? '  ← run the unapplied-bounces repair' : ''}`);
  report.unapplied.sample.forEach((email) => console.log(`      ${email}`));
  console.log(`  enrollments on a bounced address: ${report.enrollmentsAtRisk.count}${report.enrollmentsAtRisk.count ? '  ← current leads at risk' : ''}`);
  report.enrollmentsAtRisk.sample.forEach((row) => console.log(`      ${row.email} — ${row.sequence} (${row.status})`));
  console.log(`  sends after a bounce:             ${report.sendsAfterBounce.total} (last 7 days: ${report.sendsAfterBounce.last7Days})`);
  report.sendsAfterBounce.sample.forEach((row) => console.log(`      ${row.to} bounced ${row.firstBounceAt}, sent again ${row.sentAt} from ${row.mailbox}`));
  console.log(`  mailboxes not synced in 2 h:      ${report.staleMailboxes.length}`);
  report.staleMailboxes.forEach((row) => console.log(`      ${row.email} — last ${row.lastSyncAt ?? 'never'}`));
  console.log(`  hours with ${BURST_THRESHOLD}+ messages into one mailbox (30 days): ${report.burstHours.length}`);
  report.burstHours.forEach((row) => console.log(`      ${row.mailbox} ${row.hour}: ${row.messages}`));
}

async function main() {
  const reports = await forEachTenant((tenant) => auditTenant(tenant.id, tenant.name));
  if (JSON_OUTPUT) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }
  console.log('Bounce coverage audit (read-only).');
  reports.forEach(print);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
