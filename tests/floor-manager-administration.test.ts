import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PUT as updateUser } from '@/app/api/users/[id]/route';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/auth';

const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateMany = vi.fn();
const mockEmailAccountUpdateMany = vi.fn();
let currentUser: SessionUser;

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => currentUser),
  canAccessUser: vi.fn(async (_viewer: SessionUser, targetId: string) => {
    // FM can access in-floor users ('sdr-1', 'lead-1', 'sdr-2'), but not 'other-fm' or 'outside-sdr'
    if (currentUser.role === 'director') return true;
    if (currentUser.role === 'floor_manager') {
      return ['sdr-1', 'lead-1', 'sdr-2', currentUser.id].includes(targetId);
    }
    return targetId === currentUser.id;
  }),
  clearVisibleUserCache: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  logAdminAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/podScoping', () => ({
  wouldCreateManagerCycle: vi.fn(() => false),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
    emailAccount: {
      updateMany: (...args: unknown[]) => mockEmailAccountUpdateMany(...args),
    },
  },
}));

function putReq(id: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost:3000/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Floor Manager Scoped User Administration', () => {
  const fmUser: SessionUser = {
    id: 'fm-1',
    email: 'fm@telestar.cloud',
    firstName: 'Floor',
    lastName: 'Manager',
    role: 'floor_manager',
    tenantId: 'tenant-1',
  };

  const sdrUser: SessionUser = {
    id: 'sdr-1',
    email: 'sdr@telestar.cloud',
    firstName: 'Sales',
    lastName: 'Rep',
    role: 'sdr',
    tenantId: 'tenant-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = fmUser;
  });

  it('allows Floor Manager to promote an in-scope SDR to Team Lead', async () => {
    mockFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'sdr-1') {
        return { id: 'sdr-1', role: 'sdr', managerId: 'fm-1', isActive: true };
      }
      if (where.id === 'fm-1') {
        return { id: 'fm-1', role: 'floor_manager', isActive: true };
      }
      return null;
    });
    mockFindMany.mockResolvedValueOnce([]); // org check
    mockUpdate.mockResolvedValueOnce({
      id: 'sdr-1',
      role: 'team_lead',
      email: 'sdr@telestar.cloud',
      firstName: 'Sales',
      lastName: 'Rep',
      managerId: 'fm-1',
      isActive: true,
    });

    const res = await updateUser(putReq('sdr-1', { role: 'team_lead' }), {
      params: Promise.resolve({ id: 'sdr-1' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.role).toBe('team_lead');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sdr-1' },
        data: expect.objectContaining({
          role: 'team_lead',
          authVersion: { increment: 1 },
        }),
      })
    );
  });

  it('allows Floor Manager to demote an in-scope Team Lead to SDR', async () => {
    mockFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'lead-1') {
        return { id: 'lead-1', role: 'team_lead', managerId: 'fm-1', isActive: true };
      }
      if (where.id === 'fm-1') {
        return { id: 'fm-1', role: 'floor_manager', isActive: true };
      }
      return null;
    });
    mockFindMany.mockResolvedValueOnce([]); // org check
    mockUpdate.mockResolvedValueOnce({
      id: 'lead-1',
      role: 'sdr',
      email: 'lead@telestar.cloud',
      firstName: 'Team',
      lastName: 'Lead',
      managerId: 'fm-1',
      isActive: true,
    });

    const res = await updateUser(putReq('lead-1', { role: 'sdr' }), {
      params: Promise.resolve({ id: 'lead-1' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.role).toBe('sdr');
  });

  it('forbids Floor Manager from promoting an SDR to Director', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'sdr-1',
      role: 'sdr',
      managerId: 'fm-1',
      isActive: true,
    });

    const res = await updateUser(putReq('sdr-1', { role: 'director' }), {
      params: Promise.resolve({ id: 'sdr-1' }),
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain('Floor Managers may only promote or demote between SDR and Team Lead');
  });

  it('forbids Floor Manager from modifying a user outside their floor scope', async () => {
    const res = await updateUser(putReq('outside-sdr', { role: 'team_lead' }), {
      params: Promise.resolve({ id: 'outside-sdr' }),
    });

    expect(res.status).toBe(403);
  });

  it('forbids SDR from calling updateUser on any other user', async () => {
    currentUser = sdrUser;

    const res = await updateUser(putReq('sdr-2', { role: 'team_lead' }), {
      params: Promise.resolve({ id: 'sdr-2' }),
    });

    expect(res.status).toBe(403);
  });

  it('allows Floor Manager to deactivate an in-scope SDR', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'sdr-1',
      role: 'sdr',
      managerId: 'fm-1',
      isActive: true,
    });
    mockFindMany.mockResolvedValueOnce([]); // no reports
    mockUpdate.mockResolvedValueOnce({
      id: 'sdr-1',
      role: 'sdr',
      isActive: false,
    });

    const res = await updateUser(putReq('sdr-1', { isActive: false }), {
      params: Promise.resolve({ id: 'sdr-1' }),
    });

    expect(res.status).toBe(200);
    expect(mockEmailAccountUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'sdr-1', sendPausedAt: null },
      })
    );
  });
});
