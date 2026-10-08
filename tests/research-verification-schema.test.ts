import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { createTestTenant } from './helpers/testTenant';

/**
 * The verification schema (2026-10-08) against a real database: a candidate's verdict lives beside
 * its workflow status, and the per-domain classification it points at is a cache that can be
 * deleted without taking the candidate, or the candidate's tenant, with it.
 */

let tenantId: string;
let otherTenantId: string;
const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

async function candidate(t: string, classificationId: string | null = null) {
  return inTenant(async () => {
    const run = await prisma.researchRun.create({ data: { tenantId: t, kind: 'company', status: 'running', queriesJson: [] as never } });
    return prisma.researchCandidate.create({
      data: {
        tenantId: t,
        runId: run.id,
        kind: 'company',
        name: 'Riyad Bank',
        domain: 'riyadbank.com',
        sourceJson: {} as never,
        matchHintsJson: [] as never,
        dedupeFingerprint: `company:riyadbank.com:${randomUUID()}`,
        verification: 'pending',
        classificationId,
      },
    });
  }, t);
}

const classification = (t: string, domain = 'riyadbank.com', version = 1) =>
  inTenant(
    () =>
      prisma.researchDomainClassification.create({
        data: {
          tenantId: t,
          canonicalDomain: domain,
          classifierVersion: version,
          status: 'completed',
          classificationJson: { companyKind: 'operator', industryText: 'Banking', hqCountry: 'Saudi Arabia' } as never,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
    t
  );

beforeEach(async () => {
  tenantId = `t-research-verify-${randomUUID()}`;
  otherTenantId = `t-research-verify-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'Research verification');
  await createTestTenant(otherTenantId, 'Research verification other');
});

describe('research verification schema', () => {
  it('keeps the verdict next to the workflow status, not instead of it', async () => {
    const row = await candidate(tenantId);
    expect(row).toMatchObject({ status: 'discovered', verification: 'pending', verifyAttempts: 0, verificationReason: null });
    const updated = await inTenant(() =>
      prisma.researchCandidate.update({ where: { id: row.id }, data: { verification: 'rejected', verificationReason: 'company_type:media_news' } })
    );
    expect(updated).toMatchObject({ status: 'discovered', verification: 'rejected', verificationReason: 'company_type:media_news' });
  });

  it('detaches a candidate when its cached classification is deleted, and keeps its tenant', async () => {
    const cached = await classification(tenantId);
    const row = await candidate(tenantId, cached.id);
    await inTenant(() => prisma.researchDomainClassification.delete({ where: { id: cached.id } }));
    const after = await inTenant(() => prisma.researchCandidate.findUniqueOrThrow({ where: { id: row.id } }));
    expect(after).toMatchObject({ classificationId: null, tenantId });
  });

  it('caches one classification per tenant, domain and classifier version', async () => {
    await classification(tenantId);
    await expect(classification(tenantId)).rejects.toThrow();
    await expect(classification(tenantId, 'riyadbank.com', 2)).resolves.toBeTruthy();
    await expect(classification(otherTenantId)).resolves.toBeTruthy();
  });

  it('cannot point a candidate at another tenant’s classification', async () => {
    const theirs = await classification(otherTenantId);
    await expect(candidate(tenantId, theirs.id)).rejects.toThrow();
  });
});
