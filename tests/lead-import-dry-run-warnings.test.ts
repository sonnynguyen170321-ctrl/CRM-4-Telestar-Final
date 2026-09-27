import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * What the dry run tells the operator before the write.
 *
 * Two rows that name the same person are the importer's central problem, and the dry run detects
 * them against the database on four keys — email, phone, LinkedIn, name+company. Within one file it
 * tracked only email and phone, because `indexes` is built from the database once before the loop
 * and cannot see rows the same file has already contributed. LinkedIn was missing there, and it is
 * the worst of the three to miss: the old header detector mapped the contact's LinkedIn onto a
 * "Company LinkedIn" column whenever that column came first, which gives every colleague in the
 * file the same URL.
 *
 * Separately, `warnings` was computed here and returned in the response, and nothing in
 * `CSVImportModal` ever rendered it. A signal that exists in the payload but not on the screen is
 * not a signal. These tests pin the payload; the modal change carries the display.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/bullmq/health', () => ({ isQueueReachable: () => Promise.resolve(true) }));
vi.mock('@/lib/workflows/import', () => ({ startImportWorkflow: () => Promise.resolve('job-1') }));

const { POST: importLeads } = await import('@/app/api/leads/import/route');
const { prisma, tenantStorage } = await import('@/lib/prisma');
const { auth } = await import('@/auth');
type SessionUser = import('@/lib/auth').SessionUser;

const hasDb = Boolean(process.env.DATABASE_URL);

const TENANT = 'impwarn-tenant';
const SDR = 'impwarn-sdr';
const CLIENT = 'impwarn-client';
const CAMPAIGN = 'impwarn-campaign';

const sdr: SessionUser = {
  id: SDR,
  email: 'sdr@impwarn.test',
  firstName: 'Sam',
  lastName: 'Rep',
  role: 'sdr',
  tenantId: TENANT,
};

const runAs = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: TENANT, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

type DryRun = {
  total: number;
  toImport: number;
  rowsWithErrors: number;
  duplicates: Array<{ row: number; matchType: string }>;
  errorRows: Array<{ row: number; reason: string }>;
  warnings: Array<{ row: number; reason: string }>;
};

const dryRun = async (leads: Record<string, unknown>[]): Promise<DryRun> => {
  const res = await runAs(() =>
    importLeads(
      new NextRequest('http://localhost/api/leads/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leads, dryRun: true, campaignId: CAMPAIGN, filename: 'impwarn.csv' }),
      })
    )
  );
  expect(res.status).toBe(200);
  return (await res.json()) as DryRun;
};

const person = (n: number, over: Record<string, unknown> = {}) => ({
  firstName: 'Dana',
  lastName: `Prospect${n}`,
  company: 'Northwind Freight',
  title: 'Head of Logistics',
  email: `dana${n}@northwind-impwarn.test`,
  ...over,
});

describe.skipIf(!hasDb)('lead import dry run reports what it found', () => {
  beforeAll(async () => {
    await runAs(async () => {
      await prisma.importRow.deleteMany({ where: { tenantId: TENANT } });
      await prisma.importBatch.deleteMany({ where: { tenantId: TENANT } });
      await prisma.lead.deleteMany({ where: { tenantId: TENANT } });
      await prisma.campaignSdr.deleteMany({ where: { tenantId: TENANT } });
      await prisma.campaign.deleteMany({ where: { tenantId: TENANT } });
      await prisma.client.deleteMany({ where: { tenantId: TENANT } });
      await prisma.user.deleteMany({ where: { tenantId: TENANT } });
      await prisma.tenant.deleteMany({ where: { id: TENANT } });
    });
    await runSystem(async () => {
      await prisma.tenant.create({ data: { id: TENANT, name: 'ImpWarn' } });
      await prisma.user.create({
        data: {
          id: SDR,
          tenantId: TENANT,
          email: 'sdr@impwarn.test',
          password: 'x',
          firstName: 'Sam',
          lastName: 'Rep',
          role: 'sdr',
        },
      });
    });
    await runAs(async () => {
      await prisma.client.create({
        data: {
          id: CLIENT,
          tenantId: TENANT,
          name: 'ImpWarn Client',
          industry: 'Logistics',
          contactName: 'Ops',
          contactEmail: 'ops@impwarn.test',
        },
      });
      await prisma.campaign.create({
        data: {
          id: CAMPAIGN,
          tenantId: TENANT,
          clientId: CLIENT,
          name: 'ImpWarn Campaign',
          startDate: new Date('2026-08-01T00:00:00Z'),
        },
      });
      await prisma.campaignSdr.create({ data: { tenantId: TENANT, campaignId: CAMPAIGN, userId: SDR } });
    });
  });

  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue({ user: sdr } as never);
  });

  it('warns when two rows in the file carry the same LinkedIn URL', async () => {
    // The shape a mismapped "Company LinkedIn" column produces: distinct people, distinct emails,
    // one URL between them. Before this, nothing anywhere said so.
    const summary = await dryRun([
      person(1, { linkedIn: 'https://www.linkedin.com/company/northwind-freight' }),
      person(2, { linkedIn: 'https://linkedin.com/company/northwind-freight/' }),
    ]);

    const linkedInWarnings = summary.warnings.filter((w) => /linkedin/i.test(w.reason));
    expect(linkedInWarnings).toHaveLength(1);
    expect(linkedInWarnings[0].row).toBe(2);
    // A warning, not an error: the operator decides whether it is a mapping mistake or two real
    // people, and duplicates are permitted here on purpose.
    expect(summary.errorRows).toHaveLength(0);
    expect(summary.toImport).toBe(2);
  });

  it('normalizes before comparing, so one profile in two spellings is still one URL', async () => {
    const summary = await dryRun([
      person(3, { linkedIn: 'http://LinkedIn.com/in/dana-prospect' }),
      person(4, { linkedIn: 'https://www.linkedin.com/in/dana-prospect/' }),
    ]);
    expect(summary.warnings.filter((w) => /linkedin/i.test(w.reason))).toHaveLength(1);
  });

  it('says nothing about LinkedIn when every row has its own', async () => {
    const summary = await dryRun([
      person(5, { linkedIn: 'https://linkedin.com/in/person-five' }),
      person(6, { linkedIn: 'https://linkedin.com/in/person-six' }),
      person(7, {}),
      person(8, {}),
    ]);
    expect(summary.warnings.filter((w) => /linkedin/i.test(w.reason))).toHaveLength(0);
  });

  it('still refuses a repeated email outright, whatever its casing', async () => {
    // One of the two checks that already existed, kept under test so the LinkedIn addition cannot
    // disturb it.
    const summary = await dryRun([
      person(9, { email: 'same@northwind-impwarn.test' }),
      person(10, { email: 'SAME@northwind-impwarn.test' }),
    ]);

    expect(summary.errorRows.map((e) => e.reason)).toContain('Duplicate email within this file');
  });

  it('still warns on a repeated phone', async () => {
    // Deliberately two different emails. A row refused for a duplicate email returns before the
    // phone and LinkedIn checks run — it is not being imported, so there is nothing to warn about
    // — which means these two signals can only ever be observed on rows that differ by email.
    const summary = await dryRun([
      person(11, { phone: '+1 415 555 0100' }),
      person(12, { phone: '+1 415 555 0100' }),
    ]);

    expect(summary.warnings.filter((w) => /phone/i.test(w.reason))).toHaveLength(1);
    expect(summary.errorRows).toHaveLength(0);
  });
});
