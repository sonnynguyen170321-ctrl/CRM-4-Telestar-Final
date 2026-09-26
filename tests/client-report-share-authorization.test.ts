import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A share link is the one artifact that leaves the tenant.
 *
 * `POST /api/client-reports/[id]/share` mints a **credential-free public URL** to a client's
 * pipeline and financials. It checked `canShareClientReport(user)` — a role gate that answers
 * "may this role mint links at all" and says nothing about *which* report. So a team lead
 * outside a client's campaigns could mint a working public link to that client's report, and
 * the link would keep working after they lost access, because it never had any.
 *
 * The export routes next door carry a comment about the same defect — "any authenticated SDR
 * could export any client's report" — and were fixed with `canViewClientReport`. This file was
 * missed, and it is the worse case: an export ends at the person who ran it, a share link does
 * not.
 *
 * `GET` had no authorization beyond being signed in, so anyone could enumerate who had shared a
 * client's report and how often it had been read. `DELETE` took `linkId` from the query string
 * and revoked it by id alone, so the report id in the URL was decorative — a link belonging to
 * another report could be revoked through it.
 *
 * The handlers are exercised through mocked auth and Prisma: what is being pinned is the
 * authorization decision, and a real database would not make that decision any more real.
 */

const requireAuth = vi.fn();
const canShareClientReport = vi.fn();
const canViewClientReport = vi.fn();
const getClientReportScope = vi.fn();
const reportFindUnique = vi.fn();
const shareLinkFindFirst = vi.fn();
const shareLinkFindMany = vi.fn();
const createShareLink = vi.fn();
const revokeShareLink = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: () => requireAuth(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientReport: { findUnique: (a: unknown) => reportFindUnique(a), update: vi.fn() },
    clientReportShareLink: {
      findFirst: (a: unknown) => shareLinkFindFirst(a),
      findMany: (a: unknown) => shareLinkFindMany(a),
    },
  },
}));

vi.mock('@/lib/client-reports/access', () => ({
  canShareClientReport: (u: unknown) => canShareClientReport(u),
  canViewClientReport: (...a: unknown[]) => canViewClientReport(...a),
  getClientReportScope: (u: unknown) => getClientReportScope(u),
}));

vi.mock('@/lib/client-reports/shareLinks', () => ({
  createShareLink: (a: unknown) => createShareLink(a),
  revokeShareLink: (a: unknown) => revokeShareLink(a),
}));

// Only  is stubbed; the module's other exports are used by the schema imports.
vi.mock('@/lib/validation/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  parseBody: async () => ({ data: {}, error: null }),
}));

const { POST, GET, DELETE } = await import('@/app/api/client-reports/[id]/share/route');

/** A team lead: allowed to mint share links in general, not entitled to every report. */
const TEAM_LEAD = { id: 'u1', role: 'team_lead', tenantId: 't1' };
const REPORT = { id: 'r1', tenantId: 't1', campaignId: 'other-campaign', status: 'approved' };

const params = Promise.resolve({ id: 'r1' });
const req = (url = 'https://crm.test/api/client-reports/r1/share') =>
  ({ nextUrl: new URL(url), url }) as never;

describe('share links are authorized against the report, not just the role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue(TEAM_LEAD);
    canShareClientReport.mockReturnValue(true);
    getClientReportScope.mockResolvedValue({ seeAll: false, campaignIds: new Set(['mine']) });
    reportFindUnique.mockResolvedValue(REPORT);
    createShareLink.mockResolvedValue({
      token: 'tok',
      shareLink: { id: 'sl1', expiresAt: null, viewCount: 0, createdAt: new Date() },
    });
  });

  it('refuses to mint a public link to a report the caller may not see', async () => {
    canViewClientReport.mockReturnValue(false);

    const res = await POST(req(), { params });

    expect(res.status).toBe(403);
    expect(
      createShareLink,
      'a refused request must not have already created the link'
    ).not.toHaveBeenCalled();
  });

  it('mints the link when the caller may see the report', async () => {
    canViewClientReport.mockReturnValue(true);

    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    expect(createShareLink).toHaveBeenCalled();
  });

  it('refuses to list who a report was shared with, to a caller who may not see it', async () => {
    canViewClientReport.mockReturnValue(false);

    const res = await GET(req(), { params });

    expect(res.status).toBe(403);
    expect(shareLinkFindMany).not.toHaveBeenCalled();
  });

  it('refuses to revoke a link on a report the caller may not see', async () => {
    canViewClientReport.mockReturnValue(false);

    const res = await DELETE(req('https://crm.test/api/client-reports/r1/share?linkId=sl9'), {
      params,
    });

    expect(res.status).toBe(403);
    expect(revokeShareLink).not.toHaveBeenCalled();
  });

  it('refuses to revoke a link that belongs to a different report', async () => {
    // `revokeShareLink` addresses the link by id alone, so without this check the report id in
    // the URL is decorative and any link id could be revoked through any report the caller
    // happens to have access to.
    canViewClientReport.mockReturnValue(true);
    shareLinkFindFirst.mockResolvedValue(null);

    const res = await DELETE(req('https://crm.test/api/client-reports/r1/share?linkId=not-mine'), {
      params,
    });

    expect(res.status).toBe(404);
    expect(revokeShareLink).not.toHaveBeenCalled();
  });

  it('revokes a link that does belong to this report', async () => {
    canViewClientReport.mockReturnValue(true);
    shareLinkFindFirst.mockResolvedValue({ id: 'sl1' });

    const res = await DELETE(req('https://crm.test/api/client-reports/r1/share?linkId=sl1'), {
      params,
    });

    expect(res.status).toBe(200);
    expect(revokeShareLink).toHaveBeenCalledWith('sl1');
  });

  it('still refuses a role that may not share at all', async () => {
    canShareClientReport.mockReturnValue(false);
    canViewClientReport.mockReturnValue(true);

    const res = await POST(req(), { params });

    expect(res.status).toBe(403);
  });
});
