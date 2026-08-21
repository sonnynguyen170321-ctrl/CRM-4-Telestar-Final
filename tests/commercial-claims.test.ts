/**
 * Commercial memory — the persistence the prototype never had.
 *
 * What this replaced kept claims in `new Map<string, CommercialClaim>()` inside one Node
 * process: empty after every deploy, invisible to the worker, and different in each web
 * container. It was also unreachable from any production entry point, so none of that was ever
 * felt. These tests exist so the replacement is held to the rules the prototype only described
 * in a comment.
 *
 * The rules under test, in the order they matter:
 *
 *   1. A FACTUAL claim without provenance is refused, not stored. This is the whole reason the
 *      table distinguishes claim types — a sourceless "fact" is indistinguishable from a
 *      sourced one once it is read back, and that is how an inference becomes a lie.
 *   2. An INFERRED claim without a confidence is refused, for the same reason.
 *   3. Correction supersedes; the wrong belief keeps its text. Overwriting would destroy the
 *      evidence needed to explain a bad answer after the fact.
 *   4. Tenancy holds on every path, including correction by id.
 *   5. A lapsed claim stops being returned the moment it lapses, without waiting for a sweep.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const { prisma, tenantStorage } = await import('@/lib/prisma');
const {
  recordClaim,
  readClaims,
  correctClaim,
  retractClaim,
  expireLapsedClaims,
  ClaimValidationError,
} = await import('@/lib/memory/claims');

const T = 'claims-tenant-a';
const OTHER = 'claims-tenant-b';
const CONTACT = 'claims-contact-1';

const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

let hasDb = false;
try {
  if (process.env.DATABASE_URL) {
    await prisma.$queryRaw`SELECT 1`;
    hasDb = true;
  }
} catch {
  hasDb = false;
}

describe.skipIf(!hasDb)('commercial memory', () => {
  beforeAll(async () => {
    await runSystem(async () => {
      await prisma.commercialClaim.deleteMany({ where: { tenantId: { in: [T, OTHER] } } });
      await prisma.tenant.deleteMany({ where: { id: { in: [T, OTHER] } } });
      await prisma.tenant.create({ data: { id: T, name: 'Claims Tenant A' } });
      await prisma.tenant.create({ data: { id: OTHER, name: 'Claims Tenant B' } });
    });
  });

  afterAll(async () => {
    await runSystem(async () => {
      await prisma.commercialClaim.deleteMany({ where: { tenantId: { in: [T, OTHER] } } });
      await prisma.tenant.deleteMany({ where: { id: { in: [T, OTHER] } } });
    });
  });

  describe('a claim states what kind of claim it is', () => {
    it('refuses a FACTUAL claim with no provenance', async () => {
      await run(async () => {
        await expect(
          recordClaim({
            tenantId: T,
            scopeType: 'CONTACT',
            scopeId: CONTACT,
            claimType: 'FACTUAL',
            claimText: 'Budget review is in September.',
            createdByType: 'ai',
          }),
        ).rejects.toThrow(ClaimValidationError);
      });
    });

    it('accepts a FACTUAL claim that says where it came from', async () => {
      await run(async () => {
        const claim = await recordClaim({
          tenantId: T,
          scopeType: 'CONTACT',
          scopeId: CONTACT,
          claimType: 'FACTUAL',
          claimText: 'Sarah stated budget review is in September.',
          sourceType: 'email',
          sourceId: 'msg-1',
          sourceObservedAt: new Date('2026-08-01T09:00:00Z'),
          createdByType: 'ai',
        });
        expect(claim.claimType).toBe('FACTUAL');
        expect(claim.sourceType).toBe('email');
        expect(claim.status).toBe('active');
      });
    });

    it('refuses an INFERRED claim with no confidence', async () => {
      await run(async () => {
        await expect(
          recordClaim({
            tenantId: T,
            scopeType: 'COMPANY',
            scopeId: 'claims-company-1',
            claimType: 'INFERRED',
            claimText: 'Acme appears to be expanding its commercial team.',
            createdByType: 'ai',
          }),
        ).rejects.toThrow(/confidence/);
      });
    });

    it('refuses a confidence outside [0, 1]', async () => {
      await run(async () => {
        await expect(
          recordClaim({
            tenantId: T,
            scopeType: 'COMPANY',
            scopeId: 'claims-company-1',
            claimType: 'INFERRED',
            claimText: 'Acme appears to be expanding.',
            confidence: 1.4,
            createdByType: 'ai',
          }),
        ).rejects.toThrow(/\[0, 1\]/);
      });
    });

    it('requires a scopeId for a scope that names a record', async () => {
      await run(async () => {
        await expect(
          recordClaim({
            tenantId: T,
            scopeType: 'CONTACT',
            claimType: 'PREFERENCE',
            claimText: 'Prefers concise call-prep notes.',
            createdByType: 'user',
          }),
        ).rejects.toThrow(/requires a scopeId/);
      });
    });
  });

  describe('correction supersedes rather than rewrites', () => {
    it('keeps the wrong belief, and links the replacement to it', async () => {
      await run(async () => {
        const original = await recordClaim({
          tenantId: T,
          scopeType: 'CONTACT',
          scopeId: 'claims-contact-correct',
          claimType: 'FACTUAL',
          claimText: 'Budget review is in September.',
          sourceType: 'call',
          sourceId: 'call-1',
          createdByType: 'ai',
        });

        const corrected = await correctClaim({
          tenantId: T,
          claimId: original.id,
          claimText: 'Budget review moved to November.',
          correctionReason: 'Sarah corrected this on the 12 Aug call.',
          createdByType: 'user',
          createdById: 'user-1',
        });

        expect(corrected.supersedesId).toBe(original.id);
        expect(corrected.claimText).toBe('Budget review moved to November.');

        // The original still says what it said. That is the point.
        const reloaded = await prisma.commercialClaim.findUnique({ where: { id: original.id } });
        expect(reloaded?.claimText).toBe('Budget review is in September.');
        expect(reloaded?.status).toBe('superseded');

        // And a reader sees only the correction.
        const active = await readClaims({
          tenantId: T,
          scopeType: 'CONTACT',
          scopeId: 'claims-contact-correct',
        });
        expect(active.map((c) => c.claimText)).toEqual(['Budget review moved to November.']);
      });
    });

    it('refuses a correction with no reason', async () => {
      await run(async () => {
        const claim = await recordClaim({
          tenantId: T,
          scopeType: 'CONTACT',
          scopeId: 'claims-contact-noreason',
          claimType: 'PREFERENCE',
          claimText: 'Prefers morning calls.',
          createdByType: 'user',
        });
        await expect(
          correctClaim({
            tenantId: T,
            claimId: claim.id,
            claimText: 'Prefers afternoon calls.',
            correctionReason: '   ',
            createdByType: 'user',
          }),
        ).rejects.toThrow(/reason/);
      });
    });

    it('refuses to correct a claim twice', async () => {
      await run(async () => {
        const claim = await recordClaim({
          tenantId: T,
          scopeType: 'CONTACT',
          scopeId: 'claims-contact-twice',
          claimType: 'PREFERENCE',
          claimText: 'Prefers email.',
          createdByType: 'user',
        });
        await correctClaim({
          tenantId: T,
          claimId: claim.id,
          claimText: 'Prefers phone.',
          correctionReason: 'Said so directly.',
          createdByType: 'user',
        });
        await expect(
          correctClaim({
            tenantId: T,
            claimId: claim.id,
            claimText: 'Prefers WhatsApp.',
            correctionReason: 'Changed again.',
            createdByType: 'user',
          }),
        ).rejects.toThrow(/not active/);
      });
    });
  });

  describe('tenancy', () => {
    it('never returns another tenant’s claims', async () => {
      await runSystem(async () => {
        await recordClaim({
          tenantId: OTHER,
          scopeType: 'CONTACT',
          scopeId: CONTACT,
          claimType: 'FACTUAL',
          claimText: 'Tenant B private commercial detail.',
          sourceType: 'note',
          createdByType: 'user',
        });
      });

      await run(async () => {
        const mine = await readClaims({ tenantId: T, scopeType: 'CONTACT', scopeId: CONTACT });
        expect(mine.every((c) => c.tenantId === T)).toBe(true);
        expect(mine.map((c) => c.claimText)).not.toContain('Tenant B private commercial detail.');
      });
    });

    it('cannot correct another tenant’s claim by id', async () => {
      const foreign = await runSystem(() =>
        recordClaim({
          tenantId: OTHER,
          scopeType: 'CONTACT',
          scopeId: 'claims-contact-foreign',
          claimType: 'PREFERENCE',
          claimText: 'Tenant B preference.',
          createdByType: 'user',
        }),
      );

      await run(async () => {
        await expect(
          correctClaim({
            tenantId: T,
            claimId: foreign.id,
            claimText: 'Rewritten by the wrong tenant.',
            correctionReason: 'should not be possible',
            createdByType: 'user',
          }),
        ).rejects.toThrow(/not found/);
      });

      // Unchanged.
      const reloaded = await runSystem(() =>
        prisma.commercialClaim.findUnique({ where: { id: foreign.id } }),
      );
      expect(reloaded?.claimText).toBe('Tenant B preference.');
      expect(reloaded?.status).toBe('active');
    });
  });

  describe('freshness', () => {
    it('stops returning a claim the moment it lapses, before any sweep runs', async () => {
      await run(async () => {
        const past = new Date(Date.now() - 60_000);
        await recordClaim({
          tenantId: T,
          scopeType: 'CONTACT',
          scopeId: 'claims-contact-expiry',
          claimType: 'INFERRED',
          claimText: 'Probably evaluating a competitor.',
          confidence: 0.6,
          createdByType: 'ai',
          expiresAt: past,
        });

        const active = await readClaims({
          tenantId: T,
          scopeType: 'CONTACT',
          scopeId: 'claims-contact-expiry',
        });
        expect(active).toEqual([]);
      });
    });

    it('gives an AI inference a shorter life than a sourced fact', async () => {
      await run(async () => {
        const now = new Date('2026-08-21T00:00:00Z');
        const inferred = await recordClaim({
          tenantId: T,
          scopeType: 'COMPANY',
          scopeId: 'claims-company-ttl',
          claimType: 'INFERRED',
          claimText: 'Hiring pressure suspected.',
          confidence: 0.5,
          createdByType: 'ai',
          now,
        });
        const factual = await recordClaim({
          tenantId: T,
          scopeType: 'COMPANY',
          scopeId: 'claims-company-ttl',
          claimType: 'FACTUAL',
          claimText: 'Announced a Series B on 12 August.',
          sourceType: 'research',
          createdByType: 'ai',
          now,
        });
        expect(inferred.expiresAt!.getTime()).toBeLessThan(factual.expiresAt!.getTime());
      });
    });

    it('marks lapsed claims expired without changing what readers see', async () => {
      await run(async () => {
        await recordClaim({
          tenantId: T,
          scopeType: 'CONTACT',
          scopeId: 'claims-contact-sweep',
          claimType: 'INFERRED',
          claimText: 'Lapsed inference.',
          confidence: 0.4,
          createdByType: 'ai',
          expiresAt: new Date(Date.now() - 60_000),
        });

        const before = await readClaims({
          tenantId: T,
          scopeType: 'CONTACT',
          scopeId: 'claims-contact-sweep',
        });
        const swept = await expireLapsedClaims({ tenantId: T });
        const after = await readClaims({
          tenantId: T,
          scopeType: 'CONTACT',
          scopeId: 'claims-contact-sweep',
        });

        expect(swept).toBeGreaterThan(0);
        expect(before).toEqual([]);
        expect(after).toEqual([]);
      });
    });
  });

  describe('retraction', () => {
    it('withdraws a claim without asserting a replacement', async () => {
      await run(async () => {
        const claim = await recordClaim({
          tenantId: T,
          scopeType: 'CONTACT',
          scopeId: 'claims-contact-retract',
          claimType: 'PREFERENCE',
          claimText: 'Prefers Slack.',
          createdByType: 'user',
        });
        await retractClaim({ tenantId: T, claimId: claim.id, reason: 'Entered against the wrong contact.' });

        const active = await readClaims({
          tenantId: T,
          scopeType: 'CONTACT',
          scopeId: 'claims-contact-retract',
        });
        expect(active).toEqual([]);

        const reloaded = await prisma.commercialClaim.findUnique({ where: { id: claim.id } });
        expect(reloaded?.status).toBe('retracted');
      });
    });
  });
});
