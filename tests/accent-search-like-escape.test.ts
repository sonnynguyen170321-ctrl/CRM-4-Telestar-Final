import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { escapeLikePattern, findAccentInsensitiveIds, LEAD_SEARCH_COLUMNS } from '@/lib/search/accentSearch';
import { tenantStorage } from '@/lib/tenant-context';
import { createTestTenant } from './helpers/testTenant';

/** A typed % or _ or \ is a literal character in a lead search, not a wildcard. */

describe('escapeLikePattern', () => {
  it('escapes the three LIKE metacharacters and leaves the rest', () => {
    expect(escapeLikePattern('50%_off\\x')).toBe('50\\%\\_off\\\\x');
    expect(escapeLikePattern('Nguyễn')).toBe('Nguyễn');
  });
});

describe('findAccentInsensitiveIds with LIKE metacharacters', () => {
  it('matches the literal character only', async () => {
    const tenantId = await createTestTenant(`t-like-${randomUUID()}`, 'Like');
    const inTenant = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);
    const user = await inTenant(() => prisma.user.create({ data: { tenantId, email: `u.${randomUUID()}@t.test`, firstName: 'S', lastName: 'R', password: 'x', role: 'sdr' } }));
    const client = await inTenant(() => prisma.client.create({ data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } }));
    const campaign = await inTenant(() => prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date() } }));
    const make = (company: string) =>
      inTenant(async () => (await prisma.lead.create({ data: { tenantId, firstName: 'F', lastName: 'L', email: `l.${randomUUID()}@x.test`, company, campaignId: campaign.id, assignedToId: user.id } })).id);
    const percent = await make('Acme 50%x');
    const plain = await make('Acme 50 plain');
    const underscore = await make('Snake_case Ltd');
    const other = await make('SnakeXcase Ltd');

    expect(await findAccentInsensitiveIds('Lead', LEAD_SEARCH_COLUMNS, '50%x', tenantId)).toEqual([percent]);
    expect(await findAccentInsensitiveIds('Lead', LEAD_SEARCH_COLUMNS, '%', tenantId)).toEqual([percent]);
    expect(await findAccentInsensitiveIds('Lead', LEAD_SEARCH_COLUMNS, 'snake_case', tenantId)).toEqual([underscore]);
    void plain;
    void other;
  });
});
