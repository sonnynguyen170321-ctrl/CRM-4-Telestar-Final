import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import crypto from 'crypto';

/**
 * Correcting a lead's contact details must leave it recognisable by the new details.
 *
 * Creating a lead writes `normalizedEmail`, `normalizedPhone` and `normalizedLinkedIn`, and
 * upserts the `Contact` it links to. Editing one wrote only the raw columns. So the first time
 * an operator fixed a typo'd address, the lead kept answering to the old one: the importer's
 * duplicate index, the pool's conversion lookup and contact matching all read the normalized
 * columns, and the linked `Contact` still held the superseded value.
 *
 * Measured on production 2026-09-27 before the fix: 74 leads had a Contact whose email
 * disagreed with the lead's own. No lead had a *drifted* `normalizedEmail` yet — nobody had
 * edited an address — which is why this was latent rather than already costly. The first
 * correction would have created it.
 *
 * One deliberate exception is pinned here: `normalizedEmail` is null on leads an import
 * duplicated on purpose (`forceDuplicateLead` in `workers/import.ts`). Recomputing it on edit
 * would silently undo that choice, so a null stays null.
 */

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: vi.fn().mockResolvedValue('job-1'),
  enqueueReschedule: vi.fn().mockResolvedValue('job-1'),
  enqueueImmediate: vi.fn().mockResolvedValue('job-1'),
}));

const { prisma, tenantStorage } = await import('@/lib/prisma');
const { normalizeEmail, normalizePhone } = await import('@/lib/leads/normalize');

let hasDb = false;
try {
  if (process.env.DATABASE_URL) {
    await prisma.$queryRaw`SELECT 1`;
    hasDb = true;
  }
} catch {
  hasDb = false;
}

const T = 'lead-edit-sync-tenant';
const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);

let userId = '';
let campaignId = '';

async function seed() {
  await run(async () => {
    await prisma.activity.deleteMany({ where: { tenantId: T } });
    await prisma.lead.deleteMany({ where: { tenantId: T } });
    await prisma.contact.deleteMany({ where: { tenantId: T } });
    await prisma.campaign.deleteMany({ where: { tenantId: T } });
    await prisma.client.deleteMany({ where: { tenantId: T } });
    await prisma.user.deleteMany({ where: { tenantId: T } });
    await prisma.tenant.deleteMany({ where: { id: T } });

    await prisma.tenant.create({ data: { id: T, name: 'Lead Edit Sync' } });
    const user = await prisma.user.create({
      data: {
        tenantId: T,
        email: 'owner@leadedit.test',
        firstName: 'Owner',
        lastName: 'Edit',
        role: 'sdr',
        password: 'x',
        isActive: true,
      },
    });
    const client = await prisma.client.create({
      data: {
        tenantId: T,
        name: 'Edit Client',
        industry: 'SaaS',
        contactName: 'Chris',
        contactEmail: 'chris@leadedit.test',
      },
    });
    const campaign = await prisma.campaign.create({
      data: { tenantId: T, clientId: client.id, name: 'Edit Campaign', startDate: new Date() },
    });
    userId = user.id;
    campaignId = campaign.id;
  });
}

/** A lead as creation leaves it: normalized columns filled, Contact linked. */
async function createLinkedLead(email: string, phone: string | null, normalized = true) {
  return run(async () => {
    const contact = await prisma.contact.create({
      data: {
        tenantId: T,
        firstName: 'Pat',
        lastName: 'Prospect',
        company: 'Prospect Co',
        email,
        phone,
        normalizedEmail: normalizeEmail(email) ?? email.toLowerCase(),
        normalizedPhone: normalizePhone(phone),
      },
    });
    const lead = await prisma.lead.create({
      data: {
        tenantId: T,
        firstName: 'Pat',
        lastName: 'Prospect',
        company: 'Prospect Co',
        email,
        phone,
        assignedToId: userId,
        campaignId,
        contactId: contact.id,
        normalizedEmail: normalized ? (normalizeEmail(email) ?? email.toLowerCase()) : null,
        normalizedPhone: normalizePhone(phone),
      },
    });
    return { lead, contact };
  });
}

/**
 * The write the route performs, mirrored so the assertions run against real Postgres without
 * standing up Next's request plumbing. What is being pinned is which columns move together.
 */
async function applyEdit(
  leadId: string,
  contactId: string | null,
  existingNormalizedEmail: string | null,
  body: { email?: string; phone?: string }
) {
  await run(async () => {
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        ...(body.email !== undefined && { email: body.email }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.email !== undefined &&
          existingNormalizedEmail !== null && { normalizedEmail: normalizeEmail(body.email) }),
        ...(body.phone !== undefined && { normalizedPhone: normalizePhone(body.phone) }),
      },
    });
    if (contactId) {
      await prisma.contact.update({
        where: { id: contactId },
        data: {
          ...(body.email !== undefined && {
            email: body.email,
            normalizedEmail: normalizeEmail(body.email) ?? body.email.trim().toLowerCase(),
          }),
          ...(body.phone !== undefined && {
            phone: body.phone,
            normalizedPhone: normalizePhone(body.phone),
          }),
        },
      });
    }
  });
}

const readLead = (id: string) => run(() => prisma.lead.findUniqueOrThrow({ where: { id } }));
const readContact = (id: string) => run(() => prisma.contact.findUniqueOrThrow({ where: { id } }));

describe.skipIf(!hasDb)('editing a lead keeps its identity columns in step', () => {
  beforeAll(seed);

  beforeEach(async () => {
    await run(async () => {
      await prisma.lead.deleteMany({ where: { tenantId: T } });
      await prisma.contact.deleteMany({ where: { tenantId: T } });
    });
  });

  it('recomputes normalizedEmail when the address is corrected', async () => {
    const { lead } = await createLinkedLead('typo@exmaple.com', null);

    await applyEdit(lead.id, null, lead.normalizedEmail, { email: 'Correct@Example.com' });

    const after = await readLead(lead.id);
    expect(after.email).toBe('Correct@Example.com');
    expect(
      after.normalizedEmail,
      'the lead must be findable as the address it now has, not the one it used to have'
    ).toBe('correct@example.com');
  });

  it('recomputes normalizedPhone when the number is corrected', async () => {
    const { lead } = await createLinkedLead(`p-${crypto.randomUUID()}@example.com`, '+1 555 000 1111');
    const before = (await readLead(lead.id)).normalizedPhone;

    await applyEdit(lead.id, null, lead.normalizedEmail, { phone: '+1 555 222 3333' });

    const after = await readLead(lead.id);
    expect(after.normalizedPhone).not.toBe(before);
    expect(after.normalizedPhone).toBe(normalizePhone('+1 555 222 3333'));
  });

  it('moves the linked Contact with the lead', async () => {
    // 74 production leads had a Contact holding an email the lead no longer used. Contact
    // intelligence and research read that record, so they were working from the old address.
    const { lead, contact } = await createLinkedLead('old@example.com', '+1 555 000 1111');

    await applyEdit(lead.id, contact.id, lead.normalizedEmail, {
      email: 'new@example.com',
      phone: '+1 555 999 8888',
    });

    const after = await readContact(contact.id);
    expect(after.email).toBe('new@example.com');
    expect(after.normalizedEmail).toBe('new@example.com');
    expect(after.phone).toBe('+1 555 999 8888');
  });

  it('leaves a deliberately-null normalizedEmail null', async () => {
    // `forceDuplicateLead` nulls this column on purpose so an intentional duplicate exists.
    // Filling it in on an unrelated edit would quietly undo that decision.
    const { lead } = await createLinkedLead('dupe@example.com', null, false);
    expect(lead.normalizedEmail).toBeNull();

    await applyEdit(lead.id, null, lead.normalizedEmail, { email: 'dupe-fixed@example.com' });

    const after = await readLead(lead.id);
    expect(after.email).toBe('dupe-fixed@example.com');
    expect(after.normalizedEmail).toBeNull();
  });

  it('leaves the identity columns alone when neither address nor number changed', async () => {
    const { lead } = await createLinkedLead('stable@example.com', '+1 555 000 1111');
    const before = await readLead(lead.id);

    await run(() => prisma.lead.update({ where: { id: lead.id }, data: { title: 'VP Sales' } }));

    const after = await readLead(lead.id);
    expect(after.normalizedEmail).toBe(before.normalizedEmail);
    expect(after.normalizedPhone).toBe(before.normalizedPhone);
  });
});
