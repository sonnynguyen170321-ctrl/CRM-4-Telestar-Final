/**
 * Prove the outreach pipeline end to end, against production, without touching a prospect.
 *
 * Every part of this path has been repaired this week — the cadence settling on the provider's
 * answer, the hourly ceiling, bounce suppression, the redrive sweep — and each repair was
 * verified by reading the database afterwards. That is not the same as watching one message
 * travel the whole way and land in a human inbox. This does that.
 *
 * It creates one lead addressed to a mailbox the operator owns, enrols it in a sequence that
 * has no other enrollments, forces the first step due, and reports what happened at each hop:
 * task created, job queued, provider accepted, step settled, cadence advanced.
 *
 *   npx tsx scripts/e2e-outreach-probe.ts                        # report the plan, write nothing
 *   npx tsx scripts/e2e-outreach-probe.ts --apply                # run it
 *   npx tsx scripts/e2e-outreach-probe.ts --status               # where did the last probe get to
 *   npx tsx scripts/e2e-outreach-probe.ts --cleanup              # archive the probe lead
 *
 * ## Why the guards below are hard failures rather than warnings
 *
 * This sends real email from a real mailbox on a live system. The controls that exist in the
 * product protect deliverability and consent; **nothing in the codebase distinguishes a test
 * address from a prospect**. So the guards are here, they refuse rather than warn, and none of
 * them can be passed by a flag:
 *
 *   - the recipient must be on the operator's own domain
 *   - the sequence must have no enrollments other than this probe's
 *   - the campaign must contain no leads other than this probe's
 *
 * If any of those stops being true, the probe stops. A probe that quietly widened its blast
 * radius would be the same defect class as everything it was written to check.
 */
import { prisma } from '@/lib/prisma';
import { asOperator } from './lib/tenantContext';
import { enrollLeadInSequence } from '@/lib/sequences/enrollment';
import { resolveOccurrenceTask } from '@/lib/sequences/occurrenceTask';
import { enqueueImmediate } from '@/lib/bullmq/enqueue';
import { JobType } from '@/lib/bullmq/types';
import type { SessionUser } from '@/lib/auth';

const APPLY = process.argv.includes('--apply');
const STATUS = process.argv.includes('--status');
const CLEANUP = process.argv.includes('--cleanup');

function arg(name: string, fallback: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}

/** Only ever an address the operator owns. Checked below, not merely documented. */
const RECIPIENT = arg('to', 'branndon@itelestar.com');
const ALLOWED_RECIPIENT_DOMAIN = '@itelestar.com';

const SENDER_EMAIL = arg('from', 'judy@itelestar.com');
const CAMPAIGN_NAME = arg('campaign', 'Tele - Q4 - Campaign');
const SEQUENCE_NAME = arg('sequence', 'Telestar Campaign outreach');

/** Stable, so a re-run finds the previous probe instead of creating a second one. */
const PROBE_COMPANY = 'E2E Outreach Probe';
const PROBE_FIRST = 'Pipeline';
const PROBE_LAST = 'Probe';

function fail(message: string): never {
  console.error(`\nREFUSED: ${message}`);
  process.exit(2);
}

async function findProbeLead() {
  return prisma.lead.findFirst({
    where: { email: RECIPIENT, company: PROBE_COMPANY },
    orderBy: { createdAt: 'desc' },
  });
}

/** Everything the probe needs, each one refused rather than improvised. */
async function resolveTargets() {
  if (!RECIPIENT.toLowerCase().endsWith(ALLOWED_RECIPIENT_DOMAIN)) {
    fail(
      `recipient ${RECIPIENT} is not on ${ALLOWED_RECIPIENT_DOMAIN}. This probe sends real email; ` +
        `it will not address anyone outside the operator's own domain.`
    );
  }

  const sender = await prisma.user.findFirst({
    where: { email: { equals: SENDER_EMAIL, mode: 'insensitive' } },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, tenantId: true },
  });
  if (!sender) fail(`no user ${SENDER_EMAIL} — the probe sends as this person`);

  const mailbox = await prisma.emailAccount.findFirst({
    where: { userId: sender!.id, isActive: true },
    select: { id: true, email: true, dailyCap: true, dailySendCount: true, hourlyCap: true, sendPausedAt: true },
  });
  if (!mailbox) {
    fail(
      `${SENDER_EMAIL} has no active mailbox. The sending account is resolved from the lead's ` +
        `owner, so without one the step would stall as MANUAL_REQUIRED and nothing would send.`
    );
  }
  if (mailbox!.sendPausedAt) fail(`mailbox ${mailbox!.email} is paused`);
  if (mailbox!.dailySendCount >= mailbox!.dailyCap) {
    fail(`mailbox ${mailbox!.email} is at its daily cap (${mailbox!.dailySendCount}/${mailbox!.dailyCap})`);
  }

  const campaign = await prisma.campaign.findFirst({
    where: { name: CAMPAIGN_NAME },
    select: { id: true, name: true, _count: { select: { leads: true } } },
  });
  if (!campaign) fail(`no campaign named "${CAMPAIGN_NAME}"`);

  const sequence = await prisma.sequence.findFirst({
    where: { name: SEQUENCE_NAME, isActive: true },
    select: { id: true, name: true, _count: { select: { steps: true, sequenceEnrollments: true } } },
  });
  if (!sequence) fail(`no active sequence named "${SEQUENCE_NAME}"`);
  if (sequence!._count.steps === 0) fail(`sequence "${SEQUENCE_NAME}" has no steps — nothing would send`);

  // The blast-radius guards. A probe on a populated sequence or campaign is one mistake away
  // from mailing real prospects, and the UI has a bulk "Run Now" that would do exactly that.
  const probeLead = await findProbeLead();
  const otherEnrollments = await prisma.sequenceEnrollment.count({
    where: { sequenceId: sequence!.id, status: { in: ['active', 'paused'] }, leadId: { not: probeLead?.id ?? '' } },
  });
  if (otherEnrollments > 0) {
    fail(
      `sequence "${SEQUENCE_NAME}" has ${otherEnrollments} other live enrollment(s). Pick an empty ` +
        `sequence: anything that touches this one touches real prospects.`
    );
  }

  const otherLeads = await prisma.lead.count({
    where: { campaignId: campaign!.id, id: { not: probeLead?.id ?? '' } },
  });
  if (otherLeads > 0) {
    fail(`campaign "${CAMPAIGN_NAME}" holds ${otherLeads} other lead(s). Pick an empty campaign.`);
  }

  return { sender: sender!, mailbox: mailbox!, campaign: campaign!, sequence: sequence!, probeLead };
}

/** What the probe can see of one message's journey, in the order it happens. */
async function report(leadId: string) {
  const [lead, enrollment, tasks, outbound, activities] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId } }),
    prisma.sequenceEnrollment.findFirst({ where: { leadId }, orderBy: { startedAt: 'desc' } }),
    prisma.task.findMany({ where: { leadId }, orderBy: { sequenceStep: 'asc' } }),
    prisma.outboundMessage.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } }),
    prisma.activity.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' }, select: { type: true, description: true } }),
  ]);

  console.log(`\n  lead        ${lead?.email}  stage=${lead?.stage}  step=${lead?.sequenceStep ?? '-'}`);
  console.log(
    `  enrollment  ${enrollment ? `${enrollment.status} step=${enrollment.currentStep} next=${enrollment.nextActionAt?.toISOString() ?? 'none'}` : 'none'}`
  );
  for (const t of tasks) {
    console.log(`  task        step ${t.sequenceStep}: ${t.status}${t.completedAt ? ` at ${t.completedAt.toISOString()}` : ''}`);
  }
  for (const m of outbound) {
    console.log(
      `  outbound    ${m.status}${m.providerMessageId ? ` provider=${m.providerMessageId.slice(0, 28)}` : ''}` +
        `${m.sentAt ? ` sent=${m.sentAt.toISOString()}` : ''}${m.errorMessage ? ` err="${m.errorMessage.slice(0, 60)}"` : ''}`
    );
  }
  for (const a of activities) console.log(`  activity    ${a.type}: ${a.description?.slice(0, 70)}`);

  const delivered = outbound.some((m) => m.status === 'sent' && m.providerMessageId && !m.providerMessageId.startsWith('dry-run'));
  const dryRun = outbound.some((m) => m.providerMessageId?.startsWith('dry-run'));
  console.log(
    delivered
      ? `\n  DELIVERED — the provider accepted it. Check ${RECIPIENT}.`
      : dryRun
        ? `\n  DRY RUN — EMAIL_SEND_DRY_RUN is on, so nothing left the building. This proves the ` +
          `pipeline mechanics only, not delivery.`
        : `\n  not yet sent — re-run with --status in a minute; the worker may still be on it.`
  );
}

async function main() {
  await asOperator(async () => {
    const { sender, mailbox, campaign, sequence, probeLead } = await resolveTargets();

    console.log('E2E outreach probe');
    console.log(`  from      ${mailbox.email}  (${mailbox.dailySendCount}/${mailbox.dailyCap} today, hourly cap ${mailbox.hourlyCap})`);
    console.log(`  to        ${RECIPIENT}`);
    console.log(`  campaign  ${campaign.name}  (${campaign._count.leads} lead(s))`);
    console.log(`  sequence  ${sequence.name}  (${sequence._count.steps} step(s), no other enrollments)`);

    if (STATUS) {
      if (!probeLead) return console.log('\nNo probe lead exists yet.');
      return report(probeLead.id);
    }

    if (CLEANUP) {
      if (!probeLead) return console.log('\nNothing to clean up.');
      if (!APPLY) return console.log('\nWould archive the probe lead and end its cadence. Add --apply.');
      await prisma.sequenceEnrollment.updateMany({
        where: { leadId: probeLead.id, status: { in: ['active', 'paused'] } },
        data: { status: 'unenrolled', completedAt: new Date(), occupancyKey: null },
      });
      await prisma.task.updateMany({
        where: { leadId: probeLead.id, status: 'pending' },
        data: { status: 'skipped', notes: 'E2E probe cleanup' },
      });
      await prisma.lead.update({
        where: { id: probeLead.id },
        data: { archivedAt: new Date(), archiveReason: 'E2E outreach probe' },
      });
      return console.log('\nProbe lead archived, cadence ended, pending tasks skipped.');
    }

    if (!APPLY) {
      console.log(
        probeLead
          ? `\nA probe lead already exists (${probeLead.id}). --apply would re-enrol and re-fire it.`
          : '\nWould create one lead, enrol it, and force step 1 due now. Add --apply.'
      );
      return;
    }

    // ── create or reuse the one lead ──────────────────────────────────────
    const lead =
      probeLead ??
      (await prisma.lead.create({
        data: {
          firstName: PROBE_FIRST,
          lastName: PROBE_LAST,
          email: RECIPIENT,
          company: PROBE_COMPANY,
          assignedToId: sender.id,
          campaignId: campaign.id,
          stage: 'new',
        },
      }));
    console.log(`\n  lead ${probeLead ? 'reused' : 'created'}: ${lead.id}`);

    // Unarchive if a previous run cleaned it up, or the cadence cannot start.
    if (lead.archivedAt) {
      await prisma.lead.update({ where: { id: lead.id }, data: { archivedAt: null, archiveReason: null } });
      console.log('  lead unarchived');
    }

    // ── enrol, exactly this lead ──────────────────────────────────────────
    const actor: SessionUser = {
      id: sender.id,
      email: sender.email,
      firstName: sender.firstName,
      lastName: sender.lastName,
      role: sender.role as SessionUser['role'],
      tenantId: sender.tenantId,
    };
    const enrolled = await enrollLeadInSequence(actor, { leadId: lead.id, sequenceId: sequence.id });
    console.log(`  enrolled: ${enrolled.enrollmentId} at step ${enrolled.currentStep}`);

    // ── force step 1 due, the way the per-row "Run Now" control does ──────
    const enrollment = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrolled.enrollmentId } });
    const resolved = await resolveOccurrenceTask(enrollment);
    if (!resolved) {
      console.log('  no pending task for step 1 — the cadence produced nothing to send');
      return report(lead.id);
    }
    await prisma.task.update({ where: { id: resolved.task.id }, data: { dueDate: new Date() } });
    await enqueueImmediate(
      JobType.SEQUENCE_EXECUTE_TASK,
      { taskId: resolved.task.id, expectedEnrollmentId: resolved.expectedEnrollmentId },
      { tenantId: sender.tenantId! }
    );
    console.log(`  step 1 forced due and promoted on the queue (task ${resolved.task.id})`);
    console.log('\n  The worker takes it from here. Run --status in a minute.');
  });
}

main()
  .catch((err) => {
    console.error('probe failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
