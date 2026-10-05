import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionUser } from '@/lib/auth';

const mockVisible = vi.fn<(user: SessionUser) => Promise<string[] | null>>();
vi.mock('@/lib/auth', () => ({ getVisibleUserIds: (user: SessionUser) => mockVisible(user) }));

const mockSequenceFindFirst = vi.fn();
const mockTemplateFindFirst = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sequence: { findFirst: (...a: unknown[]) => mockSequenceFindFirst(...a) },
    template: { findFirst: (...a: unknown[]) => mockTemplateFindFirst(...a) },
  },
}));

const { canManageOwned, canShare, canViewOwned, canViewSequenceId, ownedOrSharedWhere, templateAccess } = await import(
  '@/lib/visibility'
);

/**
 * Who sees a sequence or a template (owner, 2026-10-05: "everybody are still sharing the same
 * view, no privacy per account"): its creator, the managers above them, and everyone once a
 * manager has shared it. `getVisibleUserIds` — the walk down `managerId` — is mocked here; what is
 * under test is how the rule is built on top of it.
 */
const user = (id: string, role: SessionUser['role']) => ({ id, role, tenantId: 't1' }) as SessionUser;
const rep = user('rep', 'sdr');
const teamLead = user('lead', 'team_lead');
const director = user('dir', 'director');

beforeEach(() => {
  vi.clearAllMocks();
  mockVisible.mockImplementation(async (viewer) => {
    if (viewer.role === 'director') return null;
    if (viewer.role === 'team_lead') return ['lead', 'rep'];
    return [viewer.id];
  });
});

describe('ownedOrSharedWhere', () => {
  it('limits a rep to what they created and what was shared', async () => {
    expect(await ownedOrSharedWhere(rep)).toEqual({ OR: [{ isShared: true }, { createdById: { in: ['rep'] } }] });
  });

  it('gives a team lead their pod’s rows as well', async () => {
    expect(await ownedOrSharedWhere(teamLead)).toEqual({
      OR: [{ isShared: true }, { createdById: { in: ['lead', 'rep'] } }],
    });
  });

  it('does not restrict a director', async () => {
    expect(await ownedOrSharedWhere(director)).toEqual({});
  });

  it('always includes the viewer, even when their tree comes back without them', async () => {
    mockVisible.mockResolvedValueOnce([]);
    expect(await ownedOrSharedWhere(user('lg', 'leadgen'))).toEqual({
      OR: [{ isShared: true }, { createdById: { in: ['lg'] } }],
    });
  });
});

describe('canViewOwned', () => {
  it('lets a rep see their own row and a shared one, and nobody else’s', async () => {
    expect(await canViewOwned(rep, { createdById: 'rep', isShared: false })).toBe(true);
    expect(await canViewOwned(rep, { createdById: 'peer', isShared: true })).toBe(true);
    expect(await canViewOwned(rep, { createdById: 'peer', isShared: false })).toBe(false);
  });

  it('lets a manager see a private row of someone under them, not of another pod', async () => {
    expect(await canViewOwned(teamLead, { createdById: 'rep', isShared: false })).toBe(true);
    expect(await canViewOwned(teamLead, { createdById: 'other-pod-rep', isShared: false })).toBe(false);
  });
});

describe('canManageOwned', () => {
  it('is the creator, or a manager with the creator in their tree', async () => {
    expect(await canManageOwned(rep, { createdById: 'rep' })).toBe(true);
    expect(await canManageOwned(teamLead, { createdById: 'rep' })).toBe(true);
    expect(await canManageOwned(director, { createdById: 'anyone' })).toBe(true);
  });

  it('is not granted by seeing a shared row, nor by being a manager of another pod', async () => {
    expect(await canManageOwned(rep, { createdById: 'peer' })).toBe(false);
    expect(await canManageOwned(teamLead, { createdById: 'other-pod-rep' })).toBe(false);
  });
});

describe('canShare', () => {
  it('is a manager’s call', () => {
    expect(canShare(rep)).toBe(false);
    expect(canShare(user('lg', 'leadgen_manager'))).toBe(false);
    expect(canShare(teamLead)).toBe(true);
    expect(canShare(director)).toBe(true);
  });
});

describe('lookups by id', () => {
  it('answers a missing sequence and an invisible one the same way, within the caller’s tenant', async () => {
    mockSequenceFindFirst.mockResolvedValueOnce(null);
    expect(await canViewSequenceId(rep, 'gone')).toBe(false);

    mockSequenceFindFirst.mockResolvedValueOnce({ createdById: 'peer', isShared: false });
    expect(await canViewSequenceId(rep, 'seq-1')).toBe(false);
    expect(mockSequenceFindFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 'seq-1', tenantId: 't1' } }),
    );

    mockSequenceFindFirst.mockResolvedValueOnce({ createdById: 'peer', isShared: true });
    expect(await canViewSequenceId(rep, 'seq-1')).toBe(true);
  });

  it('grades template access: none, view for a shared one, manage for the author', async () => {
    mockTemplateFindFirst.mockResolvedValueOnce(null);
    expect(await templateAccess(rep, 'gone')).toBe('none');

    mockTemplateFindFirst.mockResolvedValueOnce({ createdById: 'peer', isShared: false });
    expect(await templateAccess(rep, 'tmpl')).toBe('none');

    mockTemplateFindFirst.mockResolvedValueOnce({ createdById: 'peer', isShared: true });
    expect(await templateAccess(rep, 'tmpl')).toBe('view');

    mockTemplateFindFirst.mockResolvedValueOnce({ createdById: 'rep', isShared: false });
    expect(await templateAccess(rep, 'tmpl')).toBe('manage');
  });

  it('refuses a caller with no tenant', async () => {
    const stray = { id: 'x', role: 'sdr', tenantId: undefined } as unknown as SessionUser;
    expect(await canViewSequenceId(stray, 'seq-1')).toBe(false);
    expect(await templateAccess(stray, 'tmpl')).toBe('none');
    expect(mockSequenceFindFirst).not.toHaveBeenCalled();
  });
});
