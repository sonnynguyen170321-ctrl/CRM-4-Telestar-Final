import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

import { findSuppression } from '@/lib/email/suppress';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { createTestTenant } from './helpers/testTenant';

/**
 * The check every send makes before the provider call (pre-launch audit, 2026-10-05).
 *
 * Entries are stored lowercase but lead emails keep their imported case, so the lookup must ignore
 * case — an exact match let `John.Doe@Acme.com` be emailed after `john.doe@acme.com` bounced.
 */

let tenantId: string;
let otherTenantId: string;
const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

async function campaign(t: string) {
  return inTenant(async () => {
    const client = await prisma.client.create({ data: { tenantId: t, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } });
    return (await prisma.campaign.create({ data: { tenantId: t, clientId: client.id, name: 'Out', startDate: new Date() } })).id;
  }, t);
}

const suppress = (data: { email?: string; domain?: string; campaignId?: string | null }, t = tenantId) =>
  inTenant(() => prisma.suppressionEntry.create({ data: { tenantId: t, email: data.email ?? `x.${randomUUID()}@unused.test`, domain: data.domain, campaignId: data.campaignId ?? null, reason: 'hard_bounce' } }), t);

const lookup = (email: string | null, campaignId?: string | null, t = tenantId) => inTenant(() => findSuppression({ tenantId: t, email, campaignId }), t);

beforeEach(async () => {
  tenantId = `t-supp-${randomUUID()}`;
  otherTenantId = `t-supp-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'Suppression');
  await createTestTenant(otherTenantId, 'Suppression other');
});

describe('findSuppression', () => {
  it('matches an address whatever its case', async () => {
    await suppress({ email: 'john.doe@acme.com' });
    expect(await lookup('John.Doe@Acme.com')).not.toBeNull();
    expect(await lookup('  JOHN.DOE@ACME.COM ')).not.toBeNull();
    expect(await lookup('jane@acme.com')).toBeNull();
  });

  it('matches a deliberate domain block whatever the case', async () => {
    await suppress({ domain: 'competitor.com' });
    expect(await lookup('Anyone@Competitor.COM')).not.toBeNull();
  });

  it('applies tenant-wide entries and the campaign’s own, not another campaign’s', async () => {
    const [mine, theirs] = [await campaign(tenantId), await campaign(tenantId)];
    await suppress({ email: 'scoped@acme.com', campaignId: theirs });
    expect(await lookup('scoped@acme.com', mine)).toBeNull();
    expect(await lookup('scoped@acme.com', theirs)).not.toBeNull();

    await suppress({ email: 'global@acme.com' });
    expect(await lookup('Global@Acme.com', mine)).not.toBeNull();
  });

  it('never sees another tenant’s list, and treats no address as not suppressed', async () => {
    await suppress({ email: 'shared@acme.com' }, otherTenantId);
    expect(await lookup('shared@acme.com')).toBeNull();
    expect(await lookup(null)).toBeNull();
    expect(await lookup('   ')).toBeNull();
  });
});
