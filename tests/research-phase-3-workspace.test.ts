import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireResearchRunner: vi.fn(),
  requireTenantId: vi.fn(),
  planResearchRunQueries: vi.fn(),
}));

vi.mock('@/app/api/research/guard', () => ({
  requireResearchRunner: mocks.requireResearchRunner,
}));
vi.mock('@/lib/api/tenant', () => ({
  requireTenantId: mocks.requireTenantId,
}));
vi.mock('@/lib/research/discovery', () => ({
  planResearchRunQueries: mocks.planResearchRunQueries,
}));

import { POST as previewQueries } from '@/app/api/research/preview/route';

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('research query preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireResearchRunner.mockResolvedValue({
      id: 'manager-1',
      email: 'manager@example.test',
      firstName: 'Research',
      lastName: 'Manager',
      role: 'team_lead',
      tenantId: 'tenant-a',
    });
    mocks.requireTenantId.mockReturnValue('tenant-a');
  });

  it('uses the shared deterministic planner and returns only ten samples', async () => {
    mocks.planResearchRunQueries.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        query: `query-${index + 1}`,
        hints: ['SaaS'],
      })),
    );

    const response = await previewQueries(
      new NextRequest('http://localhost/api/research/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'company',
          icpVersionId: 'icp-v1',
          queryLimit: 100,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(12);
    expect(body.queries).toHaveLength(10);
    expect(mocks.planResearchRunQueries).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      kind: 'company',
      icpVersionId: 'icp-v1',
      queryLimit: 100,
      builderParams: null,
    });
  });

  it('rejects a manager query budget above the role cap before planning', async () => {
    const response = await previewQueries(
      new NextRequest('http://localhost/api/research/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'company', queryLimit: 1000 }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 'research_query_limit_exceeded',
    });
    expect(mocks.planResearchRunQueries).not.toHaveBeenCalled();
  });
});

describe('phase 3 research workspace contract', () => {
  it('surfaces the cockpit, run rail, pipeline tabs, bulk action, and safe controls', () => {
    const workspace = source('components/research/ResearchWorkspace.tsx');
    expect(workspace).toContain('Research workspace');
    expect(workspace).toContain('Provider ready');
    expect(workspace).toContain('Run history');
    expect(workspace).toContain('Needs review');
    expect(workspace).toContain('Dismissed');
    expect(workspace).toContain('Promote selected');
    expect(workspace).toContain('Pause after this batch');
    expect(workspace).toContain('queriesRun === 0');
  });

  it('requires a real preview and supports all four builder modes', () => {
    const builder = source('components/research/ResearchRunBuilder.tsx');
    for (const mode of ['ICP', 'BUILDER', 'COMPANY_CONTACTS', 'LOOKALIKE']) {
      expect(builder).toContain(mode);
    }
    expect(builder).toContain('/api/research/preview');
    expect(builder).toContain('preview.payloadFingerprint !== payloadFingerprint');
    expect(builder).toContain('requestedFingerprint = payloadFingerprint');
    expect(builder).toContain('disabled={!preview || preview.payloadFingerprint !== payloadFingerprint || creating}');
  });

  it('loads tenant-scoped evidence and annotates already-known candidates', () => {
    const drawer = source('components/research/ResearchCandidateDrawer.tsx');
    const readModel = source('lib/research/readModel.ts');
    expect(drawer).toContain('/api/research/candidates/');
    expect(drawer).toContain('Evidence ledger');
    expect(drawer).toContain('Provider attempts');
    expect(readModel).toContain('previouslyPromoted: taken.has');
    expect(readModel).toContain(
      "where: { tenantId, ...(query.runId ? { runId: query.runId } : {}) }",
    );
  });

  it('renders evidence as parsed facts with the raw snippet one click away', () => {
    // A 1,500-character Exa highlight used to be printed as one paragraph. The card parses it
    // (display-only) and keeps the original reachable; attempts fall back to the run's own,
    // because discovery attempts carry runId and not candidateId.
    const drawer = source('components/research/ResearchCandidateDrawer.tsx');
    const card = source('components/research/EvidenceCard.tsx');
    const readModel = source('lib/research/readModel.ts');
    expect(drawer).toContain("import EvidenceCard from '@/components/research/EvidenceCard'");
    expect(drawer).not.toContain('{item.sourceSnippet}</p>');
    expect(card).toContain('parseEvidenceFacts(item.sourceSnippet)');
    expect(card).toContain('<details');
    expect(card).toContain('aria-expanded={expanded}');
    expect(card).toContain('rel="noopener noreferrer"');
    expect(readModel).toContain('where: candidateAttemptsWhere({ tenantId, candidateId, runId })');
    expect(readModel).toContain('runScoped: attemptCandidateId === null');
  });
  it('keeps published ICPs readable by both pool users and research managers', () => {
    const versionsRoute = source('app/api/icp/versions/route.ts');
    expect(versionsRoute).toContain('canAccessPool(user.role)');
    expect(versionsRoute).toContain('user.apiKey');
    expect(versionsRoute).toContain('canUseResearch(user, "read")');
    expect(versionsRoute).toContain('where: { tenantId, status: "published" }');
  });
});
