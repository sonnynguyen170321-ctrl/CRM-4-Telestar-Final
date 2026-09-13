import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireResearchPromoter: vi.fn(),
  requireTenantId: vi.fn(),
  promoteCandidates: vi.fn(),
  suppressionFindMany: vi.fn(),
}));

vi.mock('@/app/api/research/guard', () => ({
  requireResearchPromoter: mocks.requireResearchPromoter,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    suppressionEntry: { findMany: mocks.suppressionFindMany },
  },
}));
vi.mock('@/lib/api/tenant', () => ({
  requireTenantId: mocks.requireTenantId,
}));
vi.mock('@/lib/research/promote', () => ({
  promoteCandidates: mocks.promoteCandidates,
}));
vi.mock('@/lib/research/campaigns', () => ({
  ResearchCampaignUnavailableError: class ResearchCampaignUnavailableError extends Error {},
}));


import { POST } from '@/app/api/research/candidates/promote/route';

import { findResearchSuppression } from '@/lib/research/suppression';
const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Phase 4 research promotion API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireResearchPromoter.mockResolvedValue({
      id: 'manager-1',
      email: 'manager@example.test',
      firstName: 'Research',
      lastName: 'Manager',
      role: 'team_lead',
      tenantId: 'tenant-a',
    });
    mocks.requireTenantId.mockReturnValue('tenant-a');
    mocks.promoteCandidates.mockResolvedValue([]);
  });

  it('requires a campaign instead of creating campaign-less inventory', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/research/candidates/promote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateIds: ['candidate-1'] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.promoteCandidates).not.toHaveBeenCalled();
  });

  it('passes the selected campaign into the tenant-scoped promotion service', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/research/candidates/promote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          candidateIds: ['candidate-1', 'candidate-2'],
          campaignId: 'campaign-1',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.promoteCandidates).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      actor: expect.objectContaining({ id: 'manager-1' }),
      candidateIds: ['candidate-1', 'candidate-2'],
      campaignId: 'campaign-1',
    });
  });
});

describe('Phase 4 architecture contract', () => {
  it('uses campaign membership as the multi-campaign truth and keeps Lead activation downstream', () => {
    const promotion = source('lib/research/promote.ts');

    expect(promotion).toContain('ensureCampaignProspect');
    expect(promotion).toContain('CampaignProspectRemovedError');
    expect(promotion).toContain('campaign_membership_removed');
    expect(promotion).toContain('campaignId');
    expect(promotion).toContain('findResearchSuppression');
    expect(promotion).not.toContain('prisma.lead.create');
    expect(promotion).toContain('buildPoolDuplicateKey');
    expect(promotion).toContain('rescorePool');
  });

  it('provides a tenant and role scoped campaign picker', () => {
    const workspace = source('components/research/ResearchWorkspace.tsx');
    expect(workspace).toContain('/api/research/campaigns');
    expect(workspace).toContain('Choose campaign');
    expect(workspace).toContain('campaignId');
  });

  it('does not globally disable a known prospect that can join another campaign', () => {
    const workspace = source('components/research/ResearchWorkspace.tsx');
    expect(workspace).not.toContain("candidate.status === 'discovered' && !candidate.previouslyPromoted");
    expect(workspace).toContain('Already in prospect library');
  });
});

describe('Phase 4 suppression gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks only tenant-wide and selected-campaign suppression entries', async () => {
    mocks.suppressionFindMany.mockResolvedValue([
      {
        email: 'blocked@example.test',
        domain: null,
        company: null,
        campaignId: 'campaign-1',
        reason: 'Do not contact',
      },
    ]);

    const match = await findResearchSuppression({
      tenantId: 'tenant-a',
      campaignId: 'campaign-1',
      email: 'BLOCKED@example.test',
    });

    expect(mocks.suppressionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-a',
          AND: [
            { OR: [{ campaignId: null }, { campaignId: 'campaign-1' }] },
            { OR: [{ email: { equals: 'blocked@example.test', mode: 'insensitive' } }] },
          ],
        },
      }),
    );
    expect(match).toEqual({
      reason: 'Do not contact',
      matchedOn: 'email',
      scope: 'campaign',
    });
  });

  it('matches Vietnamese company variants with the shared identity normalizer', async () => {
    mocks.suppressionFindMany.mockResolvedValue([
      {
        email: null,
        domain: null,
        company: 'Sao B\u1EAFc TNHH',
        campaignId: null,
        reason: 'Contract restriction',
      },
    ]);

    const match = await findResearchSuppression({
      tenantId: 'tenant-a',
      campaignId: 'campaign-1',
      company: 'C\u00F4ng ty TNHH Sao B\u1EAFc',
    });


    expect(mocks.suppressionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-a',
          AND: [
            { OR: [{ campaignId: null }, { campaignId: 'campaign-1' }] },
            { OR: [{ company: { not: null } }] },
          ],
        },
      }),
    );
    expect(match).toEqual({
      reason: 'Contract restriction',
      matchedOn: 'company',
      scope: 'tenant',
    });
  });

  it('does not query suppression entries when no identifier can match', async () => {
    const match = await findResearchSuppression({
      tenantId: 'tenant-a',
      campaignId: 'campaign-1',
    });

    expect(match).toBeNull();
    expect(mocks.suppressionFindMany).not.toHaveBeenCalled();
  });
});
