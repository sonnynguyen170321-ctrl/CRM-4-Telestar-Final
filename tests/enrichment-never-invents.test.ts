import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * When research cannot run, the answer is "it did not run" — never a plausible-looking guess.
 *
 * `POST /api/ai/enrich-lead` used to answer `success: true` with a fabricated payload whenever
 * the provider was unavailable or returned unparseable JSON: a fixed tech stack of
 * CRM / Email Automation / Analytics, three generic pain points, and an icebreaker asserting
 *
 *     "We recently helped a B2B team in ${industry} double their qualified meetings
 *      by automating research-grounded outreach."
 *
 * Nothing marked it invented. The research panel rendered it exactly like real findings, and an
 * SDR would paste that sentence — about a customer we never had and a result we never produced
 * — into a cold email to a real prospect. Of everything found in this codebase, it is the only
 * defect that puts a false claim in front of a customer in our own words.
 *
 * `lib/research/leadRefinement.ts` already sets the standard: `degraded: true` with a reason,
 * nothing refined, and any rationale citing evidence it was not given is dropped. These tests
 * hold this route to it.
 */

const generateJson = vi.fn();
const requireAuth = vi.fn();
const leadFindFirst = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: () => requireAuth(),
  canAccessLead: async () => true,
  canAccessLeadId: async () => true,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead: { findFirst: (a: unknown) => leadFindFirst(a), findUnique: (a: unknown) => leadFindFirst(a) },
  },
}));

vi.mock('@/lib/ai/generation', () => ({
  generateStructured: (...a: unknown[]) => generateJson(...a),
}));

vi.mock('@/lib/tenant-context', () => ({
  tenantStorage: { run: async (_ctx: unknown, fn: () => unknown) => fn() },
}));

const LEAD = {
  id: 'lead-1',
  firstName: 'Pat',
  lastName: 'Prospect',
  company: 'Acme Robotics',
  title: 'VP Sales',
  industry: 'Manufacturing',
  email: 'pat@acme.test',
  tenantId: 't1',
  // Related rows the prompt builder walks. Omitting them is what made the first run of this
  // file fail on `.map` of undefined, long before it reached the branch under test.
  activities: [],
  notes: [],
  tasks: [],
  meetings: [],
};

/** Phrases the fabricated payload used to contain. None may ever reach the client again. */
const INVENTED = [
  'double their qualified meetings',
  'Email Automation',
  'Manual SDR prospecting workflows',
  'an active player in the',
];

describe('enrich-lead refuses rather than inventing research', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({ id: 'u1', role: 'sdr', tenantId: 't1', email: 'u@t.test' });
    leadFindFirst.mockResolvedValue(LEAD);
  });

  it('says the provider did not run, and invents nothing, when generation is unavailable', async () => {
    generateJson.mockResolvedValue({ available: false, data: null });

    const { POST } = await import('@/app/api/ai/enrich-lead/route');
    const res = await POST(
      { json: async () => ({ leadId: 'lead-1' }) } as never
    );
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.available).toBe(false);
    expect(body.data, 'no payload at all — an empty panel is the honest answer').toBeUndefined();

    const serialized = JSON.stringify(body);
    for (const phrase of INVENTED) {
      expect(serialized, `the response still contains invented copy: "${phrase}"`).not.toContain(
        phrase
      );
    }
  });

  it('says the same when the provider answers with something unparseable', async () => {
    // The old code treated "available but unreadable" identically to "unavailable", and filled
    // in the gap the same way.
    generateJson.mockResolvedValue({ available: true, data: null });

    const { POST } = await import('@/app/api/ai/enrich-lead/route');
    const res = await POST(
      { json: async () => ({ leadId: 'lead-1' }) } as never
    );
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toContain('double their qualified meetings');
  });

  it('passes real research through untouched', async () => {
    const real = {
      companySummary: 'Acme Robotics builds warehouse automation for third-party logistics.',
      industryFocus: 'Manufacturing',
      estimatedTechStack: ['HubSpot', 'PostgreSQL'],
      keyPainPoints: ['Integrating WMS data across three warehouses'],
      icebreakers: [{ id: 'a', style: 'Hook', hook: 'Saw the Hanoi facility opening', rationale: 'Recent news' }],
    };
    generateJson.mockResolvedValue({ available: true, data: real });

    const { POST } = await import('@/app/api/ai/enrich-lead/route');
    const res = await POST(
      { json: async () => ({ leadId: 'lead-1' }) } as never
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.companySummary).toBe(real.companySummary);
    expect(body.data.icebreakers).toEqual(real.icebreakers);
    // A tech stack is no longer asked for and never passed through: the model had nothing to
    // base one on (AI review, 2026-10-06).
    expect(body.data.estimatedTechStack).toEqual([]);
  });
});
