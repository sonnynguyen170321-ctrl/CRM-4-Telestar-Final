import { randomUUID } from 'node:crypto';
import type { SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { occupancyKeyFor } from '@/lib/sequences/occupancy';
import { enrollmentStepTaskId } from '@/lib/sequences/identity';
import { createTestTenant } from './testTenant';

/**
 * A tenant with one rep, one connected mailbox, one campaign and one email template, and cadences
 * to run against it. Shared by the auto-send suites; each test mints its own tenant, which
 * `createTestTenant` removes when the test ends.
 */
export interface AutosendTenant {
  tenantId: string;
  user: SessionUser;
  userId: string;
  accountId: string;
  campaignId: string;
  templateId: string;
  /** Run `fn` inside this tenant's context. */
  inTenant: <T>(fn: () => Promise<T>) => Promise<T>;
}

export async function seedAutosendTenant(label: string): Promise<AutosendTenant> {
  const tenantId = `t-${label}-${randomUUID()}`;
  await createTestTenant(tenantId, label);
  const inTenant = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);

  return inTenant(async () => {
    const row = await prisma.user.create({
      data: {
        tenantId,
        email: `sdr.${randomUUID()}@t.test`,
        firstName: 'Judy',
        lastName: 'N',
        password: '$2a$10$abcdefghijklmnopqrstuu',
        role: 'sdr',
      },
    });
    const account = await prisma.emailAccount.create({
      data: {
        tenantId,
        userId: row.id,
        email: `sender.${randomUUID()}@t.test`,
        provider: 'imap_smtp',
        isActive: true,
        dailyCap: 100,
        hourlyCap: 0,
      },
    });
    const client = await prisma.client.create({
      data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
    });
    const campaign = await prisma.campaign.create({
      data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date(), status: 'active' },
    });
    const template = await prisma.template.create({
      data: { tenantId, name: 'Opener', channel: 'email', subject: 'Hello {{firstName}}', body: 'Hi {{firstName}}', createdById: row.id },
    });
    return {
      tenantId,
      user: { id: row.id, email: row.email, firstName: 'Judy', lastName: 'N', role: 'sdr', tenantId } as SessionUser,
      userId: row.id,
      accountId: account.id,
      campaignId: campaign.id,
      templateId: template.id,
      inTenant,
    };
  });
}

export interface CadenceOptions {
  /** The step's `autoComplete` flag. */
  autoComplete: boolean;
  /** Give the step the tenant's template. */
  withTemplate: boolean;
  /** Task due date; defaults to an hour ago (overdue). */
  dueDate?: Date;
  /** Name for the sequence. */
  name?: string;
  /** Skip the sequence's sending mailbox, to see the `none_chosen` state. */
  noSender?: boolean;
}

export interface Cadence {
  leadId: string;
  sequenceId: string;
  stepId: string;
  enrollmentId: string;
  taskId: string;
  email: string;
}

/** One lead on step 1 of a two-step email sequence, with its pending step-1 task. */
export async function seedCadence(t: AutosendTenant, options: CadenceOptions): Promise<Cadence> {
  return t.inTenant(async () => {
    const email = `lead.${randomUUID()}@prospect.test`;
    const sequence = await prisma.sequence.create({
      // Weekends allowed, so a run on a Saturday is not deferred to Monday and the test does not depend on the day.
      data: { tenantId: t.tenantId, name: options.name ?? `Seq ${randomUUID().slice(0, 6)}`, createdById: t.userId, sendOnWeekends: true },
    });
    const step1 = await prisma.sequenceStep.create({
      data: {
        tenantId: t.tenantId,
        sequenceId: sequence.id,
        order: 1,
        channel: 'email',
        delayDays: 0,
        autoComplete: options.autoComplete,
        templateId: options.withTemplate ? t.templateId : null,
        instructions: 'Log touchpoint details for the email outreach.',
      },
    });
    await prisma.sequenceStep.create({
      data: { tenantId: t.tenantId, sequenceId: sequence.id, order: 2, channel: 'email', delayDays: 2, autoComplete: false },
    });
    if (!options.noSender) {
      await prisma.sequenceSender.create({
        data: { tenantId: t.tenantId, sequenceId: sequence.id, emailAccountId: t.accountId, addedById: t.userId },
      });
    }
    const lead = await prisma.lead.create({
      data: {
        tenantId: t.tenantId,
        firstName: 'Pat',
        lastName: 'Prospect',
        email,
        company: 'Acme',
        timezone: 'UTC',
        assignedToId: t.userId,
        campaignId: t.campaignId,
        sequenceId: sequence.id,
        sequenceStep: 1,
        sequenceStatus: 'active',
        stage: 'sequence_active',
        operatingState: 'ready_for_outreach',
      },
    });
    const enrollment = await prisma.sequenceEnrollment.create({
      data: {
        tenantId: t.tenantId,
        leadId: lead.id,
        sequenceId: sequence.id,
        status: 'active',
        currentStep: 1,
        occupancyKey: occupancyKeyFor(t.tenantId, lead.id, sequence.id),
        nextActionAt: options.dueDate ?? new Date(Date.now() - 3_600_000),
      },
    });
    const task = await prisma.task.create({
      data: {
        id: enrollmentStepTaskId(enrollment.id, 1),
        tenantId: t.tenantId,
        leadId: lead.id,
        userId: t.userId,
        type: 'email',
        title: `Step 1: Email — ${sequence.name}`,
        description: 'Log touchpoint details for the email outreach.',
        status: 'pending',
        dueDate: options.dueDate ?? new Date(Date.now() - 3_600_000),
        sequenceId: sequence.id,
        sequenceStep: 1,
      },
    });
    return { leadId: lead.id, sequenceId: sequence.id, stepId: step1.id, enrollmentId: enrollment.id, taskId: task.id, email };
  });
}
