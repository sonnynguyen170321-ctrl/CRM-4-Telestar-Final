import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import {
  DOMAIN_CLASSIFICATION_CLAIM_STALE_MS,
  DOMAIN_CLASSIFICATION_TTL_MS,
  claimDomainClassification,
  completeDomainClassification,
  failDomainClassification,
} from '@/lib/research/domainClassificationCache';
import { tenantStorage } from '@/lib/tenant-context';
import { createTestTenant } from './helpers/testTenant';

/**
 * The per-domain classification cache (2026-10-08): the same company is classified once per tenant per
 * classifier version, two slices never pay for the same domain at once, and a dead slice's claim is
 * taken over rather than blocking the domain forever.
 */

let tenantId: string;
let otherTenantId: string;
const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);
const T0 = new Date('2026-10-08T10:00:00Z');
const later = (ms: number) => new Date(T0.getTime() + ms);
const claim = (now = T0, t = tenantId, domain = 'riyadbank.com', version = 1) => inTenant(() => claimDomainClassification({ tenantId: t, domain, version, now }), t);
const complete = (id: string, token: string, now = T0) =>
  inTenant(() => completeDomainClassification({ tenantId, id, token, classificationJson: { companyKind: 'operator' }, confidence: 'high', now }));

beforeEach(async () => {
  tenantId = `t-domain-cache-${randomUUID()}`;
  otherTenantId = `t-domain-cache-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'Domain cache');
  await createTestTenant(otherTenantId, 'Domain cache other');
});

describe('domain classification cache', () => {
  it('lets one slice classify a domain, and the next run reuse the result', async () => {
    const first = await claim();
    expect(first.state).toBe('won');
    if (first.state !== 'won') return;
    expect(await claim()).toEqual({ state: 'busy' });

    expect(await complete(first.id, first.token)).toBe(true);
    const reuse = await claim(later(60_000));
    expect(reuse.state).toBe('fresh');
    if (reuse.state === 'fresh') expect(reuse.row).toMatchObject({ status: 'completed', confidence: 'high', classificationJson: { companyKind: 'operator' } });
  });

  it('classifies again once the cached result expires, or for a new classifier version', async () => {
    const first = await claim();
    if (first.state !== 'won') throw new Error('expected a claim');
    await complete(first.id, first.token);
    expect((await claim(later(DOMAIN_CLASSIFICATION_TTL_MS + 1))).state).toBe('won');
    expect((await claim(T0, tenantId, 'riyadbank.com', 2)).state).toBe('won');
  });

  it('takes over a claim that has gone quiet, and the dead slice can no longer write', async () => {
    const dead = await claim();
    if (dead.state !== 'won') throw new Error('expected a claim');
    expect((await claim(later(DOMAIN_CLASSIFICATION_CLAIM_STALE_MS - 1000))).state).toBe('busy');
    const takeover = await claim(later(DOMAIN_CLASSIFICATION_CLAIM_STALE_MS + 1000));
    expect(takeover.state).toBe('won');
    expect(await complete(dead.id, dead.token)).toBe(false);
  });

  it('retries a failed classification instead of caching the failure', async () => {
    const first = await claim();
    if (first.state !== 'won') throw new Error('expected a claim');
    await inTenant(() => failDomainClassification({ tenantId, id: first.id, token: first.token, errorCode: 'site_blocked', errorMessage: 'robots.txt', now: T0 }));
    const row = await inTenant(() => prisma.researchDomainClassification.findFirstOrThrow({ where: { id: first.id } }));
    expect(row).toMatchObject({ status: 'failed', errorCode: 'site_blocked', claimToken: null });
    expect((await claim(later(1000))).state).toBe('won');
  });

  it('keeps each tenant’s classifications to itself', async () => {
    const mine = await claim();
    if (mine.state !== 'won') throw new Error('expected a claim');
    await complete(mine.id, mine.token);
    expect((await claim(T0, otherTenantId)).state).toBe('won');
  });
});
