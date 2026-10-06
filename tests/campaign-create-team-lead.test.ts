import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeUserFindUnique } from './helpers/mockDbUser';
import type { SessionUser } from '@/lib/auth';

/**
 * Creating a campaign (owner, 2026-10-06: "team lead create dc, làm y chang floor/director").
 *
 * Team leads may now create one. Whoever creates it — other than a director, who sees every
 * campaign — becomes its first member: campaign visibility runs through CampaignSdr, so a campaign
 * with no members was invisible to the floor manager who had just created it, and would have been
 * to a team lead too (absent from their list and from the bulk-upload campaign picker).
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const mockUserFindUnique = makeUserFindUnique([
  { id: 'u-dir', role: 'director', tenantId: 'tenant-1' },
  { id: 'u-fm', role: 'floor_manager', tenantId: 'tenant-1', reports: 1 },
  { id: 'u-tl', role: 'team_lead', tenantId: 'tenant-1', reports: 1 },
  { id: 'u-sdr', role: 'sdr', tenantId: 'tenant-1' },
]);
const campaignCreate = vi.fn();
const campaignSdrUpsert = vi.fn();
const clientFindUnique = vi.fn();
const clientCreate = vi.fn();
const auditCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (args: { where?: { id?: string } }) => mockUserFindUnique(args), findMany: vi.fn() },
    campaign: { create: (...a: unknown[]) => campaignCreate(...a) },
    campaignSdr: { upsert: (...a: unknown[]) => campaignSdrUpsert(...a) },
    client: { findUnique: (...a: unknown[]) => clientFindUnique(...a), create: (...a: unknown[]) => clientCreate(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
  tenantStorage: { run: (_: unknown, fn: () => unknown) => fn() },
}));
vi.mock('@/lib/cache', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  listKey: (...parts: string[]) => parts.join(':'),
  invalidateList: vi.fn(),
}));

const { auth } = await import('@/auth');
const { POST } = await import('@/app/api/campaigns/route');

function signIn(id: string, role: SessionUser['role']) {
  const user: SessionUser = { id, role, tenantId: 'tenant-1', email: `${id}@t.test`, firstName: 'F', lastName: 'L' };
  (auth as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ user, expires: '' });
}

const create = () =>
  POST(
    new NextRequest('http://localhost:3000/api/campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nekko Q4', clientId: 'client-1' }),
    })
  );

describe('POST /api/campaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientFindUnique.mockResolvedValue({ id: 'client-1' });
    campaignCreate.mockResolvedValue({ id: 'camp-1', name: 'Nekko Q4', status: 'active' });
    campaignSdrUpsert.mockResolvedValue({});
    auditCreate.mockResolvedValue({});
  });

  it('lets a team lead create a campaign, and makes them its first member so they can see it', async () => {
    signIn('u-tl', 'team_lead');

    const res = await create();

    expect(res.status).toBe(201);
    expect(campaignSdrUpsert).toHaveBeenCalledWith({
      where: { campaignId_userId: { campaignId: 'camp-1', userId: 'u-tl' } },
      create: { campaignId: 'camp-1', userId: 'u-tl' },
      update: {},
    });
  });

  it('does the same for a floor manager, who could not see their own new campaign before', async () => {
    signIn('u-fm', 'floor_manager');

    const res = await create();

    expect(res.status).toBe(201);
    expect(campaignSdrUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { campaignId: 'camp-1', userId: 'u-fm' } })
    );
  });

  it('adds no membership for a director, who already sees every campaign', async () => {
    signIn('u-dir', 'director');

    const res = await create();

    expect(res.status).toBe(201);
    expect(campaignSdrUpsert).not.toHaveBeenCalled();
  });

  it('still refuses an SDR', async () => {
    signIn('u-sdr', 'sdr');

    const res = await create();

    expect(res.status).toBe(403);
    expect(campaignCreate).not.toHaveBeenCalled();
  });
});
