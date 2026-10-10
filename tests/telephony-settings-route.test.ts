import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { SessionUser } from '@/lib/auth';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
const authUser = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  const { NextResponse } = await import('next/server');
  return {
    ...actual,
    requireAuth: async () => authUser.current ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});

import { TELEPHONY_ENV } from '@/lib/env-contract';
import { prisma } from '@/lib/prisma';
import { FakeTelephonyProvider } from '@/lib/telephony/fake';
import { setTelephonyProviderForTests } from '@/lib/telephony/index';
import { TelephonyProviderError } from '@/lib/telephony/provider';
import { tenantStorage } from '@/lib/tenant-context';
import { GET, PATCH } from '@/app/api/telephony/settings/route';
import { POST as ADD_NUMBER } from '@/app/api/telephony/settings/numbers/route';
import { DELETE as REMOVE_NUMBER, PATCH as PATCH_NUMBER } from '@/app/api/telephony/settings/numbers/[id]/route';
import { DELETE as REVOKE_CREDENTIAL } from '@/app/api/telephony/settings/credentials/[id]/route';
import { POST as TOKEN } from '@/app/api/telephony/token/route';
import { createTestTenant } from './helpers/testTenant';

/**
 * settings/telephony's API (docs/dialer/TASKS.md D9.2), against a real database.
 *
 * Managers (director, floor manager, team lead) read and change their own team's dialer settings;
 * everyone else, and any API key, is refused. The tenant is always the session's. Every change is
 * audited with the non-secret before and after, the kill switch stops the next token, and Vietnam
 * is refused as a dialable country.
 */

const ENV_KEYS = [...TELEPHONY_ENV, 'TELEPHONY_ENABLED', 'TELEPHONY_DRY_RUN'] as const;
const SECRET_VALUE = 'a-secret-value-that-must-never-appear-in-a-response-1234567890';

let savedEnv: Record<string, string | undefined> = {};
let tenantId: string;
let otherTenantId: string;
let provider: FakeTelephonyProvider;
const users = {
  director: null as unknown as SessionUser,
  floorManager: null as unknown as SessionUser,
  teamLead: null as unknown as SessionUser,
  sdr: null as unknown as SessionUser,
  leadgen: null as unknown as SessionUser,
  otherDirector: null as unknown as SessionUser,
};

const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

async function makeUser(t: string, role: SessionUser['role']): Promise<SessionUser> {
  const row = await inTenant(
    () => prisma.user.create({ data: { tenantId: t, email: `u.${randomUUID()}@t.test`, firstName: 'Mia', lastName: String(role), password: 'x', role } }),
    t
  );
  return { id: row.id, email: row.email, firstName: 'Mia', lastName: String(role), role, tenantId: t };
}

const jsonRequest = (method: string, body?: unknown) =>
  new NextRequest('https://crm.telestar.cloud/api/telephony/settings', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function get(user: SessionUser | null) {
  authUser.current = user;
  const response = await GET();
  return { response, body: await response.json() };
}
async function patch(user: SessionUser | null, body: unknown) {
  authUser.current = user;
  const response = await PATCH(jsonRequest('PATCH', body));
  return { response, body: await response.json() };
}
async function addNumber(user: SessionUser | null, body: unknown) {
  authUser.current = user;
  const response = await ADD_NUMBER(jsonRequest('POST', body));
  return { response, body: await response.json() };
}
async function patchNumber(user: SessionUser | null, id: string, body: unknown) {
  authUser.current = user;
  const response = await PATCH_NUMBER(jsonRequest('PATCH', body), params(id));
  return { response, body: await response.json() };
}
async function removeNumber(user: SessionUser | null, id: string) {
  authUser.current = user;
  const response = await REMOVE_NUMBER(jsonRequest('DELETE'), params(id));
  return { response, body: await response.json() };
}
async function revoke(user: SessionUser | null, id: string) {
  authUser.current = user;
  const response = await REVOKE_CREDENTIAL(jsonRequest('DELETE'), params(id));
  return { response, body: await response.json() };
}

const settingsRow = (t = tenantId) => inTenant(() => prisma.telephonySettings.findUnique({ where: { tenantId: t } }), t);
const auditRows = (action?: string, t = tenantId) =>
  inTenant(() => prisma.auditLog.findMany({ where: { tenantId: t, action: action ?? { startsWith: 'admin.telephony' } }, orderBy: { createdAt: 'asc' } }), t);
const numberRows = (t = tenantId) => inTenant(() => prisma.telephonyNumber.findMany({ where: { tenantId: t }, orderBy: { createdAt: 'asc' } }), t);
/** A valid North American number (the exchange cannot start with 0 or 1), unique enough across runs. */
const uniqueE164 = () => `+1415${Math.floor(2 + Math.random() * 8)}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;

async function makeCredential(t: string, userId: string) {
  return inTenant(
    () => prisma.telephonyCredential.create({ data: { tenantId: t, userId, provider: 'fake', providerCredentialId: `cred-${randomUUID()}`, sipUsername: 'gencred1', lastTokenAt: new Date('2026-10-09T08:00:00Z') } }),
    t
  );
}

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of TELEPHONY_ENV) process.env[k] = SECRET_VALUE;
  process.env.TELEPHONY_AUTH_SECRET = SECRET_VALUE;
  process.env.TELEPHONY_ENABLED = 'true';
  process.env.TELEPHONY_DRY_RUN = 'false';
  provider = new FakeTelephonyProvider();
  setTelephonyProviderForTests(provider);

  tenantId = `t-telset-${randomUUID()}`;
  otherTenantId = `t-telset-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'Telephony settings');
  await createTestTenant(otherTenantId, 'Telephony settings other');
  users.director = await makeUser(tenantId, 'director');
  users.floorManager = await makeUser(tenantId, 'floor_manager');
  users.teamLead = await makeUser(tenantId, 'team_lead');
  users.sdr = await makeUser(tenantId, 'sdr');
  users.leadgen = await makeUser(tenantId, 'leadgen');
  users.otherDirector = await makeUser(otherTenantId, 'director');
});

afterEach(() => {
  authUser.current = null;
  setTelephonyProviderForTests(null);
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

describe('access', () => {
  it('needs a session', async () => {
    expect((await get(null)).response.status).toBe(401);
    expect((await patch(null, { enabled: true })).response.status).toBe(401);
    expect((await addNumber(null, { e164: uniqueE164() })).response.status).toBe(401);
  });

  it.each([['sdr'], ['leadgen']] as const)('refuses a %s on every endpoint', async (who) => {
    const user = users[who];
    const number = await inTenant(() => prisma.telephonyNumber.create({ data: { tenantId, e164: uniqueE164(), country: 'US' } }));
    const credential = await makeCredential(tenantId, users.sdr.id);
    expect((await get(user)).response.status).toBe(403);
    expect((await patch(user, { enabled: true })).response.status).toBe(403);
    expect((await addNumber(user, { e164: uniqueE164() })).response.status).toBe(403);
    expect((await patchNumber(user, number.id, { isActive: false })).response.status).toBe(403);
    expect((await removeNumber(user, number.id)).response.status).toBe(403);
    expect((await revoke(user, credential.id)).response.status).toBe(403);
    expect(await settingsRow()).toBeNull();
    expect(await numberRows()).toHaveLength(1);
    expect((await inTenant(() => prisma.telephonyCredential.findUnique({ where: { id: credential.id } })))?.status).toBe('active');
  });

  it('refuses an API key even on a manager', async () => {
    const keyed = { ...users.director, apiKey: { id: 'k1', name: 'full', scopes: ['*'] } } as SessionUser;
    expect((await get(keyed)).response.status).toBe(403);
    expect((await patch(keyed, { killed: true })).response.status).toBe(403);
    expect((await addNumber(keyed, { e164: uniqueE164() })).response.status).toBe(403);
    expect(await settingsRow()).toBeNull();
  });

  it.each([['director'], ['floorManager'], ['teamLead']] as const)('lets a %s read', async (who) => {
    const { response, body } = await get(users[who]);
    expect(response.status).toBe(200);
    expect(body.settings.enabled).toBe(false);
  });
});

describe('GET /api/telephony/settings', () => {
  it('shows the defaults before anyone has saved: off, dry run, any time, no countries, recording on without a notice', async () => {
    const { body } = await get(users.director);
    expect(body.settings).toMatchObject({
      enabled: false,
      dryRun: true,
      anyTime: true,
      callingHoursStart: 0,
      callingHoursEnd: 1440,
      allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
      allowedCountries: [],
      recordingEnabled: true,
      recordingNotice: false,
      recordingRetentionDays: 90,
      killed: false,
    });
    expect(await settingsRow()).toBeNull(); // reading creates nothing
  });

  it('reports the deployment flags by state only, never by value', async () => {
    const { response, body } = await get(users.director);
    const text = JSON.stringify(body);
    expect(text).not.toContain(SECRET_VALUE);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body.deployment).toMatchObject({ enabledFlag: true, dryRunFlag: false, configured: true, missing: [] });

    delete process.env.TELNYX_API_KEY;
    process.env.TELEPHONY_ENABLED = 'false';
    const off = (await get(users.director)).body.deployment;
    expect(off).toMatchObject({ enabledFlag: false, configured: false, missing: ['TELNYX_API_KEY'] });
  });

  it('lists this team\'s numbers and credentials only', async () => {
    await inTenant(() => prisma.telephonyNumber.create({ data: { tenantId, e164: '+14155550101', country: 'US' } }));
    await inTenant(() => prisma.telephonyNumber.create({ data: { tenantId: otherTenantId, e164: '+14155550102', country: 'US' } }), otherTenantId);
    await makeCredential(tenantId, users.sdr.id);
    const otherSdr = await makeUser(otherTenantId, 'sdr');
    await makeCredential(otherTenantId, otherSdr.id);

    const { body } = await get(users.director);
    expect(body.numbers.map((n: { e164: string }) => n.e164)).toEqual(['+14155550101']);
    expect(body.credentials).toHaveLength(1);
    expect(body.credentials[0]).toMatchObject({ userName: expect.stringContaining('Mia'), status: 'active', lastTokenAt: '2026-10-09T08:00:00.000Z' });
    expect(JSON.stringify(body)).not.toContain('gencred');
    expect(JSON.stringify(body)).not.toContain('cred-');
  });

  it('never shows another team\'s settings', async () => {
    await inTenant(() => prisma.telephonySettings.create({ data: { tenantId: otherTenantId, enabled: true, allowedCountries: ['SG'] } }), otherTenantId);
    const { body } = await get(users.director);
    expect(body.settings).toMatchObject({ enabled: false, allowedCountries: [] });
  });
});

describe('PATCH /api/telephony/settings', () => {
  it('creates the row on the first save and changes only what was sent', async () => {
    const { response, body } = await patch(users.director, { enabled: true, dryRun: false, allowedCountries: ['sg', 'US'] });
    expect(response.status).toBe(200);
    expect(body.settings).toMatchObject({ enabled: true, dryRun: false, allowedCountries: ['SG', 'US'] });
    const row = await settingsRow();
    expect(row).toMatchObject({ enabled: true, dryRun: false, allowedCountries: ['SG', 'US'], recordingEnabled: true, updatedById: users.director.id });

    await patch(users.teamLead, { recordingNotice: true });
    expect(await settingsRow()).toMatchObject({ enabled: true, allowedCountries: ['SG', 'US'], recordingNotice: true, updatedById: users.teamLead.id });
  });

  it('never writes another team\'s row', async () => {
    await inTenant(() => prisma.telephonySettings.create({ data: { tenantId: otherTenantId, enabled: false } }), otherTenantId);
    await patch(users.director, { enabled: true });
    expect((await settingsRow(otherTenantId))?.enabled).toBe(false);
    await patch(users.otherDirector, { dryRun: false });
    expect((await settingsRow())?.dryRun).toBe(true); // not touched by the other team's save
  });

  it('refuses Vietnam with a clear message and saves nothing', async () => {
    const { response, body } = await patch(users.director, { enabled: true, allowedCountries: ['SG', 'VN'] });
    expect(response.status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/own phone/i);
    expect(await settingsRow()).toBeNull();
    expect(await auditRows()).toHaveLength(0);
  });

  it.each([
    ['end before start', { callingHoursStart: 1000, callingHoursEnd: 500 }],
    ['past midnight', { callingHoursStart: 0, callingHoursEnd: 1500 }],
    ['negative start', { callingHoursStart: -5, callingHoursEnd: 600 }],
    ['no weekdays', { allowedWeekdays: [] }],
    ['retention too long', { recordingRetentionDays: 100000 }],
    ['retention too short', { recordingRetentionDays: 0 }],
    ['smuggled tenant', { tenantId: 'x', enabled: true }],
    ['smuggled kill fields', { killedAt: '2026-01-01T00:00:00Z' }],
  ])('refuses %s', async (_name, body) => {
    expect((await patch(users.director, body)).response.status).toBe(400);
    expect(await settingsRow()).toBeNull();
  });

  it('refuses a body that is not JSON', async () => {
    authUser.current = users.director;
    const response = await PATCH(new NextRequest('https://crm.telestar.cloud/api/telephony/settings', { method: 'PATCH', body: 'nope', headers: { 'content-type': 'application/json' } }));
    expect(response.status).toBe(400);
  });

  it('"any time" and narrower hours round-trip', async () => {
    await patch(users.director, { anyTime: false, callingHoursStart: 480, callingHoursEnd: 1020, allowedWeekdays: [1, 2, 3, 4, 5] });
    let { body } = await get(users.director);
    expect(body.settings).toMatchObject({ anyTime: false, callingHoursStart: 480, callingHoursEnd: 1020, allowedWeekdays: [1, 2, 3, 4, 5] });
    await patch(users.director, { anyTime: true });
    ({ body } = await get(users.director));
    expect(body.settings).toMatchObject({ anyTime: true, callingHoursStart: 0, callingHoursEnd: 1440, allowedWeekdays: [0, 1, 2, 3, 4, 5, 6] });
  });

  it('writes an audit row with the before and after of what changed, and nothing else', async () => {
    await patch(users.director, { enabled: true, recordingRetentionDays: 30 });
    const rows = await auditRows('admin.telephony.settings');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: users.director.id, tableName: 'TelephonySettings' });
    const changed = rows[0].changedFields as Record<string, Record<string, unknown>>;
    expect(changed.before).toEqual({ enabled: false, recordingRetentionDays: 90 });
    expect(changed.after).toEqual({ enabled: true, recordingRetentionDays: 30 });
    expect(JSON.stringify(changed)).not.toContain(SECRET_VALUE);
  });

  it('writes no audit row when nothing actually changed', async () => {
    await patch(users.director, { enabled: true });
    await patch(users.director, { enabled: true });
    expect(await auditRows('admin.telephony.settings')).toHaveLength(1);
  });

  it('keeps audit rows of one team out of the other team\'s view', async () => {
    await patch(users.director, { enabled: true });
    expect(await auditRows('admin.telephony.settings', otherTenantId)).toHaveLength(0);
  });
});

describe('kill switch', () => {
  it('records who stopped the dialer and when, and lifting it clears both', async () => {
    const { body } = await patch(users.floorManager, { killed: true });
    expect(body.settings).toMatchObject({ killed: true, killedByName: expect.stringContaining('Mia') });
    expect(await settingsRow()).toMatchObject({ killedById: users.floorManager.id, killedAt: expect.any(Date) });

    const lifted = await patch(users.director, { killed: false });
    expect(lifted.body.settings.killed).toBe(false);
    expect(await settingsRow()).toMatchObject({ killedAt: null, killedById: null });
  });

  it('keeps the original time and person when it is pressed twice', async () => {
    await patch(users.floorManager, { killed: true });
    const first = await settingsRow();
    await patch(users.director, { killed: true });
    expect(await settingsRow()).toMatchObject({ killedAt: first!.killedAt, killedById: users.floorManager.id });
    expect(await auditRows('admin.telephony.kill')).toHaveLength(1);
  });

  it('is audited under its own action with before and after', async () => {
    await patch(users.director, { killed: true });
    await patch(users.director, { killed: false });
    const rows = await auditRows('admin.telephony.kill');
    expect(rows).toHaveLength(2);
    expect((rows[0].changedFields as { after: unknown }).after).toEqual({ killed: true });
    expect((rows[1].changedFields as { before: unknown }).before).toEqual({ killed: true });
  });

  it('stops the very next softphone token, and lifting it restores it', async () => {
    await patch(users.director, { enabled: true, dryRun: false });
    authUser.current = users.sdr;
    expect((await TOKEN()).status).toBe(200);
    await inTenant(() => prisma.telephonyCredential.updateMany({ where: { tenantId }, data: { lastTokenAt: null } })); // past the token route's own rate limit
    await patch(users.director, { killed: true });
    authUser.current = users.sdr;
    const blocked = await TOKEN();
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).code).toBe('dialer_disabled');
    await patch(users.director, { killed: false });
    authUser.current = users.sdr;
    expect((await TOKEN()).status).toBe(200);
  });
});

describe('caller ID numbers', () => {
  it('adds a number in E.164 and derives its country; the first becomes the default for its country and overall', async () => {
    const e164 = uniqueE164();
    const { response, body } = await addNumber(users.director, { e164, label: ' Main ' });
    expect(response.status).toBe(201);
    expect(body.number).toMatchObject({ e164, country: 'US', label: 'Main', isActive: true, isDefault: true, isOverallDefault: true });
    const row = (await numberRows())[0];
    expect(row).toMatchObject({ tenantId, purpose: 'outbound', provider: 'telnyx' });
  });

  it('keeps the first number\'s defaults when a second is added in the same country', async () => {
    const first = (await addNumber(users.director, { e164: uniqueE164() })).body.number;
    const second = (await addNumber(users.director, { e164: uniqueE164() })).body.number;
    expect(second).toMatchObject({ isDefault: false, isOverallDefault: false });
    expect((await numberRows()).find((n) => n.id === first.id)).toMatchObject({ isDefault: true, isOverallDefault: true });
  });

  it('makes a number in a new country that country\'s default but not the overall default', async () => {
    await addNumber(users.director, { e164: uniqueE164() });
    const sg = (await addNumber(users.director, { e164: '+6561234567' })).body.number;
    expect(sg).toMatchObject({ country: 'SG', isDefault: true, isOverallDefault: false });
  });

  it.each([['0948200638'], ['+65 6123 4567'], ['+0123456789'], ['not a number'], ['']])('refuses %j', async (e164) => {
    expect((await addNumber(users.director, { e164 })).response.status).toBe(400);
    expect(await numberRows()).toHaveLength(0);
  });

  it('refuses a country calling code nobody uses', async () => {
    expect((await addNumber(users.director, { e164: '+999123456789' })).response.status).toBe(400);
  });

  it('refuses a duplicate in this team (409) and a number another team owns, without saying which', async () => {
    const e164 = uniqueE164();
    await addNumber(users.director, { e164 });
    expect((await addNumber(users.teamLead, { e164 })).response.status).toBe(409);

    const taken = uniqueE164();
    await addNumber(users.otherDirector, { e164: taken });
    const clash = await addNumber(users.director, { e164: taken });
    expect(clash.response.status).toBe(409);
    expect(JSON.stringify(clash.body)).not.toContain(otherTenantId);
    expect(await numberRows()).toHaveLength(1);
  });

  it('moves the country default and the overall default between numbers, one of each', async () => {
    const a = (await addNumber(users.director, { e164: uniqueE164() })).body.number;
    const b = (await addNumber(users.director, { e164: uniqueE164() })).body.number;

    expect((await patchNumber(users.director, b.id, { isDefault: true, isOverallDefault: true })).response.status).toBe(200);
    const rows = await numberRows();
    expect(rows.find((n) => n.id === a.id)).toMatchObject({ isDefault: false, isOverallDefault: false });
    expect(rows.find((n) => n.id === b.id)).toMatchObject({ isDefault: true, isOverallDefault: true });
  });

  it('does not move another team\'s defaults', async () => {
    await addNumber(users.director, { e164: uniqueE164() });
    const mine = (await addNumber(users.director, { e164: uniqueE164() })).body.number;
    const theirs = (await addNumber(users.otherDirector, { e164: uniqueE164() })).body.number;
    await patchNumber(users.director, mine.id, { isDefault: true, isOverallDefault: true });
    expect((await numberRows(otherTenantId)).find((n) => n.id === theirs.id)).toMatchObject({ isDefault: true, isOverallDefault: true });
  });

  it('will not make an inactive number a default, and deactivating clears its defaults', async () => {
    const a = (await addNumber(users.director, { e164: uniqueE164() })).body.number;
    const b = (await addNumber(users.director, { e164: uniqueE164() })).body.number;
    await patchNumber(users.director, b.id, { isActive: false });
    expect((await patchNumber(users.director, b.id, { isDefault: true })).response.status).toBe(409);
    await patchNumber(users.director, a.id, { isActive: false });
    expect((await numberRows()).find((n) => n.id === a.id)).toMatchObject({ isActive: false, isDefault: false, isOverallDefault: false });
  });

  it('answers 404 for another team\'s number on every verb and leaves it alone', async () => {
    const theirs = (await addNumber(users.otherDirector, { e164: uniqueE164() })).body.number;
    expect((await patchNumber(users.director, theirs.id, { isActive: false })).response.status).toBe(404);
    expect((await removeNumber(users.director, theirs.id)).response.status).toBe(404);
    expect(await numberRows(otherTenantId)).toHaveLength(1);
    expect((await numberRows(otherTenantId))[0].isActive).toBe(true);
  });

  it('removes a number', async () => {
    const a = (await addNumber(users.director, { e164: uniqueE164() })).body.number;
    expect((await removeNumber(users.director, a.id)).response.status).toBe(200);
    expect(await numberRows()).toHaveLength(0);
  });

  it('audits add, change and remove without a phone number in the changed fields beyond the one acted on', async () => {
    const a = (await addNumber(users.director, { e164: uniqueE164() })).body.number;
    await patchNumber(users.director, a.id, { label: 'Sales' });
    await removeNumber(users.director, a.id);
    const rows = await auditRows('admin.telephony.number');
    expect(rows.map((r) => (r.changedFields as { operation: string }).operation)).toEqual(['add', 'update', 'remove']);
    expect(rows.every((r) => r.recordId === a.id)).toBe(true);
  });

  it('refuses an empty or unknown patch', async () => {
    const a = (await addNumber(users.director, { e164: uniqueE164() })).body.number;
    expect((await patchNumber(users.director, a.id, {})).response.status).toBe(400);
    expect((await patchNumber(users.director, a.id, { e164: '+14155550999' })).response.status).toBe(400);
  });
});

describe('revoking a softphone credential', () => {
  it('marks it revoked, deletes it at the provider and audits it', async () => {
    const created = { providerCredentialId: `fake-cred-${randomUUID()}`, sipUsername: 'gencred9' };
    provider.credentials.set(created.providerCredentialId, { ...created, label: 'crm:x:y', tag: 't' });
    const credential = await inTenant(() =>
      prisma.telephonyCredential.create({ data: { tenantId, userId: users.sdr.id, provider: 'fake', providerCredentialId: created.providerCredentialId, sipUsername: created.sipUsername } })
    );
    const { response, body } = await revoke(users.teamLead, credential.id);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ revoked: true, providerRevoked: true });
    expect(provider.credentials.has(created.providerCredentialId)).toBe(false);
    expect(await inTenant(() => prisma.telephonyCredential.findUnique({ where: { id: credential.id } }))).toMatchObject({ status: 'revoked', revokedAt: expect.any(Date) });

    const rows = await auditRows('admin.telephony.credential_revoke');
    expect(rows).toHaveLength(1);
    expect(rows[0].recordId).toBe(credential.id);
    expect(JSON.stringify(rows[0].changedFields)).not.toContain(created.providerCredentialId);
  });

  it('revokes locally even when the provider fails, and says so', async () => {
    const credential = await makeCredential(tenantId, users.sdr.id);
    const originalRevoke = provider.revokeCredential.bind(provider);
    provider.revokeCredential = async () => {
      throw new TelephonyProviderError('boom', 503, true);
    };
    const { response, body } = await revoke(users.director, credential.id);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ revoked: true, providerRevoked: false });
    expect((await inTenant(() => prisma.telephonyCredential.findUnique({ where: { id: credential.id } })))?.status).toBe('revoked');

    provider.revokeCredential = originalRevoke;
    expect((await revoke(users.director, credential.id)).body).toMatchObject({ revoked: true, providerRevoked: true }); // a retry finishes the cleanup
  });

  it('revokes locally when the provider is not configured at all', async () => {
    setTelephonyProviderForTests(null);
    delete process.env.TELNYX_API_KEY;
    const credential = await makeCredential(tenantId, users.sdr.id);
    const { response, body } = await revoke(users.director, credential.id);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ revoked: true, providerRevoked: false });
  });

  it('a revoked rep cannot get a token', async () => {
    await patch(users.director, { enabled: true, dryRun: false });
    const credential = await makeCredential(tenantId, users.sdr.id);
    await revoke(users.director, credential.id);
    authUser.current = users.sdr;
    const response = await TOKEN();
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('credential_revoked');
  });

  it('answers 404 for another team\'s credential and leaves it active', async () => {
    const otherSdr = await makeUser(otherTenantId, 'sdr');
    const theirs = await makeCredential(otherTenantId, otherSdr.id);
    expect((await revoke(users.director, theirs.id)).response.status).toBe(404);
    expect((await inTenant(() => prisma.telephonyCredential.findUnique({ where: { id: theirs.id } }), otherTenantId))?.status).toBe('active');
  });
});
