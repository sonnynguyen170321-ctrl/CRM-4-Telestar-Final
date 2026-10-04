import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { createTestTenant } from './helpers/testTenant';

/**
 * The telephony tables (docs/dialer/, Phase 1), against a real database.
 *
 * These pin the guarantees the rest of the dialer is built on: one provider call is one row, a
 * webhook delivered twice is stored once, a call gets at most one Activity and one missed-call task,
 * a rep has one softphone credential, our do-not-call list holds a number once per tenant — and
 * deleting a lead or a rep never takes the call history (or its tenant) with it.
 */

let tenantId: string;
let otherTenantId: string;
const ids = { user: '', lead: '', campaign: '' };
const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

async function call(extra: Record<string, unknown> = {}) {
  return prisma.call.create({
    data: { tenantId, direction: 'outbound', status: 'authorized', toE164: '+84948200638', userId: ids.user, leadId: ids.lead, ...extra },
  });
}

beforeEach(async () => {
  tenantId = `t-telschema-${randomUUID()}`;
  otherTenantId = `t-telschema-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'Telephony schema');
  await createTestTenant(otherTenantId, 'Telephony schema other');
  await inTenant(async () => {
    ids.user = (
      await prisma.user.create({
        data: { tenantId, email: `sdr.${randomUUID()}@t.test`, firstName: 'S', lastName: 'R', password: 'x', role: 'sdr' },
      })
    ).id;
    const client = await prisma.client.create({
      data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
    });
    ids.campaign = (await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date() } })).id;
    ids.lead = (
      await prisma.lead.create({
        data: { tenantId, firstName: 'Ann', lastName: 'L', email: `ann.${randomUUID()}@acme.test`, company: 'Acme', phone: '0948200638', campaignId: ids.campaign, assignedToId: ids.user },
      })
    ).id;
  });
});

describe('Call', () => {
  it('keeps one row per provider call, while any number of not-yet-dialed calls have no session id', async () => {
    await inTenant(async () => {
      await call();
      await call(); // two authorized calls, no provider session yet — both allowed
      await call({ providerSessionId: 'sess-1', status: 'initiated' });
      await expect(call({ providerSessionId: 'sess-1', status: 'initiated' })).rejects.toSatisfy(isUniqueViolation);
    });
  });

  it('links at most one Activity and one missed-call task to a call', async () => {
    await inTenant(async () => {
      await call({ activityId: 'act-1', missedCallTaskId: 'task-1' });
      await expect(call({ activityId: 'act-1' })).rejects.toSatisfy(isUniqueViolation);
      await expect(call({ missedCallTaskId: 'task-1' })).rejects.toSatisfy(isUniqueViolation);
    });
  });

  it('survives deleting its lead or its rep: only the link is cleared, the tenant stays', async () => {
    await inTenant(async () => {
      const row = await call();
      await prisma.$executeRaw`DELETE FROM "Lead" WHERE id = ${ids.lead}`;
      await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${ids.user}`;
      const after = await prisma.call.findUniqueOrThrow({ where: { id: row.id } });
      expect(after).toMatchObject({ leadId: null, userId: null, tenantId });
    });
  });

  it('starts with no recorded outcome or reasons', async () => {
    const row = await inTenant(() => call());
    expect(row).toMatchObject({ outcome: null, blockedReasons: [], provider: 'telnyx', activityId: null });
  });
});

describe('TelephonyCredential', () => {
  it('gives a rep one softphone credential', async () => {
    await inTenant(async () => {
      await prisma.telephonyCredential.create({ data: { tenantId, userId: ids.user, providerCredentialId: `cred-${randomUUID()}`, sipUsername: 'gencred1' } });
      await expect(
        prisma.telephonyCredential.create({ data: { tenantId, userId: ids.user, providerCredentialId: `cred-${randomUUID()}`, sipUsername: 'gencred2' } })
      ).rejects.toSatisfy(isUniqueViolation);
    });
  });
});

describe('PhoneSuppression', () => {
  it('holds a number once per tenant, and the same number can be on another tenant\'s list', async () => {
    await inTenant(() => prisma.phoneSuppression.create({ data: { tenantId, e164: '+84948200638', source: 'call_outcome' } }));
    await expect(
      inTenant(() => prisma.phoneSuppression.create({ data: { tenantId, e164: '+84948200638', source: 'manual' } }))
    ).rejects.toSatisfy(isUniqueViolation);
    await inTenant(
      () => prisma.phoneSuppression.create({ data: { tenantId: otherTenantId, e164: '+84948200638', source: 'manual' } }),
      otherTenantId
    );
  });
});

describe('TelephonyEvent', () => {
  it('stores a webhook delivered twice only once', async () => {
    const providerEventId = `evt-${randomUUID()}`;
    await prisma.telephonyEvent.create({ data: { providerEventId, type: 'call.initiated', payload: {} } });
    await expect(prisma.telephonyEvent.create({ data: { providerEventId, type: 'call.initiated', payload: {} } })).rejects.toSatisfy(
      isUniqueViolation
    );
    await prisma.telephonyEvent.deleteMany({ where: { providerEventId } });
  });
});

describe('TelephonySettings and do-not-call defaults', () => {
  it('starts switched off, in dry-run, 08:00–17:00 every day, recording kept 90 days', async () => {
    const settings = await inTenant(() => prisma.telephonySettings.create({ data: { tenantId } }));
    expect(settings).toMatchObject({
      enabled: false,
      dryRun: true,
      callingHoursStart: 480,
      callingHoursEnd: 1020,
      allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
      allowedCountries: ['VN'],
      recordingEnabled: true,
      recordingRetentionDays: 90,
      inboundRingSecs: 20,
      fallbackUserIds: [],
    });
  });

  it('does not mark leads do-not-call by default', async () => {
    const lead = await inTenant(() => prisma.lead.findUniqueOrThrow({ where: { id: ids.lead } }));
    expect(lead.doNotCall).toBe(false);
  });
});

describe('database guards', () => {
  const rejects = (promise: Promise<unknown>) =>
    expect(promise).rejects.toSatisfy((error: unknown) => /check constraint|violates check/i.test(String((error as Error).message)));

  it('refuses settings that would block every call or purge recordings at once', async () => {
    await inTenant(async () => {
      await rejects(prisma.telephonySettings.create({ data: { tenantId, callingHoursStart: 1020, callingHoursEnd: 480 } }));
      await rejects(prisma.telephonySettings.create({ data: { tenantId, callingHoursEnd: 1500 } }));
      await rejects(prisma.telephonySettings.create({ data: { tenantId, recordingRetentionDays: 0 } }));
      await rejects(prisma.telephonySettings.create({ data: { tenantId, inboundRingSecs: 0 } }));
      await rejects(prisma.telephonySettings.create({ data: { tenantId, allowedWeekdays: [1, 7] } }));
    });
  });

  it('refuses numbers that are not E.164, so a suppression can never silently fail to match', async () => {
    await inTenant(async () => {
      await rejects(prisma.phoneSuppression.create({ data: { tenantId, e164: '0948200638', source: 'manual' } }));
      await rejects(call({ toE164: '84948200638' }));
      await rejects(
        prisma.telephonyNumber.create({ data: { tenantId, e164: '+84 948 200 638', country: 'VN' } })
      );
    });
  });

  it('refuses a negative duration and unknown status or purpose values', async () => {
    await inTenant(async () => {
      await rejects(call({ billedDurationSec: -1 }));
      await rejects(prisma.telephonyNumber.create({ data: { tenantId, e164: '+84948200639', country: 'VN', purpose: 'fax' } }));
      await rejects(
        prisma.telephonyCredential.create({
          data: { tenantId, userId: ids.user, providerCredentialId: `cred-${randomUUID()}`, sipUsername: 'g', status: 'paused' },
        })
      );
    });
  });

  it('accepts the replacement numbers a sanitized dump writes', async () => {
    await inTenant(async () => {
      await call({ toE164: '+10000000000' });
      await prisma.phoneSuppression.create({ data: { tenantId, e164: '+1000000000001', source: 'manual' } });
      await prisma.telephonyNumber.create({ data: { tenantId, e164: '+2' + String(Date.now()).slice(-12).padStart(12, '0'), country: 'VN' } });
    });
  });
});

describe('the global webhook inbox', () => {
  it('is read only by telephony code — it has no tenant column, so no row-level security', () => {
    const allowed = [/^lib[\/]telephony[\/]/, /^app[\/]api[\/]telephony[\/]/, /^workers[\/]telephony\.ts$/];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          walk(path);
        } else if (/\.(ts|tsx)$/.test(entry.name) && /telephonyEvent/.test(readFileSync(join(process.cwd(), path), 'utf8'))) {
          if (!allowed.some((pattern) => pattern.test(path))) offenders.push(path);
        }
      }
    };
    for (const root of ['app', 'lib', 'components', 'workers']) walk(root);
    expect(offenders).toEqual([]);
  });
});

describe('the migration', () => {
  const sql = () => {
    const dir = readdirSync(join(process.cwd(), 'prisma', 'migrations')).find((name) => name.endsWith('_telephony_core'));
    return readFileSync(join(process.cwd(), 'prisma', 'migrations', dir!, 'migration.sql'), 'utf8');
  };

  it('clears only the link column on delete, never tenantId', () => {
    const text = sql();
    for (const column of ['userId', 'leadId', 'contactId']) {
      expect(text).toMatch(new RegExp(`ON DELETE SET NULL \\("${column}"\\)`));
    }
    expect(text).not.toMatch(/ON DELETE SET NULL ON UPDATE/);
  });

  it('does not rewrite Lead or Contact phone data', () => {
    expect(sql()).not.toMatch(/UPDATE\s+"(Lead|Contact)"/);
  });
});
