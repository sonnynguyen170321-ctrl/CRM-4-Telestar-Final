/**
 * Two ways a cadence could promise something it would never do.
 *
 * **An auto-complete email step with no template.** The builder let it be saved — the seeded
 * "Post-Meeting Follow-Up" step 1 was one. The worker's eligibility check then returns
 * `MANUAL_REQUIRED missing_template`, the task sits pending, and nobody is told the cadence
 * they armed cannot fire. The step schema now refuses it with the reason, and the builder
 * says so beside the toggle before anyone clicks Save.
 *
 * **Archiving a sequence left its enrollments active.** `DELETE /api/sequences/[id]` skipped
 * the pending tasks and cleared the lead cache (`sequenceId` and friends), but the
 * `SequenceEnrollment` rows — the thing that *is* the cadence — stayed `active` with their
 * occupancy key. The lead read as "not in a sequence" and could never be enrolled anywhere
 * again, because the unique key said it was still busy on a sequence that no longer existed.
 * Same class as the 556 import leads: two models, one updated.
 *
 * The archive test runs against real Postgres, because the occupancy key is a database
 * constraint and the whole point is what the database says afterwards.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createSequenceSchema } from '@/lib/validation/schemas';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({
    id: 'seq-guard-actor',
    email: 'seq-guard@telestar.test',
    firstName: 'Seq',
    lastName: 'Guard',
    role: 'director',
    tenantId: 'default-tenant',
  })),
  getVisibleUserIds: vi.fn(async () => null),
}));
vi.mock('@/lib/cache', () => ({ invalidateList: vi.fn(async () => {}) }));
vi.mock('@/lib/audit', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/audit')>()), logAdminAudit: vi.fn(async () => {}) }));

const { NextRequest } = await import('next/server');
const { prisma, tenantStorage } = await import('@/lib/prisma');
const { DELETE } = await import('@/app/api/sequences/[id]/route');

const TENANT = 'default-tenant';
const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: TENANT, bypassRls: true }, fn);

let hasDb = false;
try {
  if (process.env.DATABASE_URL) {
    await prisma.$queryRaw`SELECT 1`;
    hasDb = true;
  }
} catch {
  hasDb = false;
}

describe('an auto-complete email step needs a template', () => {
  const base = { name: 'Guarded', steps: [{ channel: 'email' as const, order: 1, autoComplete: true }] };

  it('refuses auto-complete email with no template, naming the field', () => {
    const result = createSequenceSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === 'steps.0.templateId');
    expect(issue?.message).toMatch(/needs a template/);
  });

  it('accepts the same step once a template is chosen', () => {
    const ok = createSequenceSchema.safeParse({ ...base, steps: [{ ...base.steps[0], templateId: 'ckvlq4c1t0000abcdefghijkl' }] });
    expect(ok.success).toBe(true);
  });

  it('accepts a manual email step with no template — a person writes it', () => {
    const ok = createSequenceSchema.safeParse({ ...base, steps: [{ ...base.steps[0], autoComplete: false }] });
    expect(ok.success).toBe(true);
  });

  it('does not apply to LinkedIn or call steps, which have no template to send', () => {
    const ok = createSequenceSchema.safeParse({ ...base, steps: [{ channel: 'linkedin', order: 1, autoComplete: true }] });
    expect(ok.success).toBe(true);
  });
});

describe.skipIf(!hasDb)('archiving a sequence releases its enrollments', () => {
  it('sets every live enrollment to unenrolled and frees the occupancy key', async () => {
    const tag = randomUUID().slice(0, 8);
    const ids = await run(async () => {
      await prisma.user.upsert({
        where: { id: 'seq-guard-actor' },
        update: {},
        create: { id: 'seq-guard-actor', email: 'seq-guard-actor@telestar.test', firstName: 'Seq', lastName: 'Guard', role: 'director', password: 'x', tenantId: TENANT },
      });
      const client = await prisma.client.create({ data: { tenantId: TENANT, name: `Guard Client ${tag}`, industry: 'x', contactName: 'c', contactEmail: `c-${tag}@t.test` } });
      const campaign = await prisma.campaign.create({ data: { tenantId: TENANT, clientId: client.id, name: `Guard Campaign ${tag}`, startDate: new Date() } });
      const lead = await prisma.lead.create({ data: { tenantId: TENANT, firstName: 'Archive', lastName: `Lead-${tag}`, company: 'Co', email: `archive-${tag}@t.test`, assignedToId: 'seq-guard-actor', campaignId: campaign.id } });
      const sequence = await prisma.sequence.create({ data: { tenantId: TENANT, name: `Guard Seq ${tag}`, isActive: true, createdById: 'seq-guard-actor' } });
      const enrollment = await prisma.sequenceEnrollment.create({
        data: { tenantId: TENANT, leadId: lead.id, sequenceId: sequence.id, status: 'active', currentStep: 1, occupancyKey: `${TENANT}:${lead.id}` },
      });
      await prisma.lead.update({ where: { id: lead.id }, data: { sequenceId: sequence.id, sequenceStep: 1, sequenceStatus: 'active' } });
      return { lead: lead.id, sequence: sequence.id, enrollment: enrollment.id };
    });

    const res = await run(() =>
      DELETE(new NextRequest(`https://crm.test/api/sequences/${ids.sequence}`, { method: 'DELETE' }), { params: Promise.resolve({ id: ids.sequence }) })
    );
    expect(res.status).toBe(200);

    const after = await run(() => prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: ids.enrollment } }));
    expect(after.status).toBe('unenrolled');
    expect(after.occupancyKey, 'the key must be released in the same write, or the lead stays busy forever').toBeNull();

    // The proof that matters: the lead can be enrolled somewhere else now.
    const other = await run(() => prisma.sequence.create({ data: { tenantId: TENANT, name: `Guard Seq B ${tag}`, isActive: true, createdById: 'seq-guard-actor' } }));
    await expect(
      run(() =>
        prisma.sequenceEnrollment.create({
          data: { tenantId: TENANT, leadId: ids.lead, sequenceId: other.id, status: 'active', currentStep: 1, occupancyKey: `${TENANT}:${ids.lead}` },
        })
      )
    ).resolves.toBeTruthy();
  });
});
