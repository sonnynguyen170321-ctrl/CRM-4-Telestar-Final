/**
 * What `evaluate_lead_quality` tells the assistant when nothing has been configured.
 *
 * `meetsAnyRequirement` is `matches.some(m => m.fullyMet)`, and with no requirement rows that is
 * `[].some(...)` — `false`. Literally correct, and the wrapper turned it into a verdict:
 *
 *     Lead <id>: does not fully meet the campaign lead requirements.
 *
 * `CampaignLeadRequirement` has never held a row in production, so every lead ever scored came
 * back as failing criteria that do not exist. The library underneath is honest about this — its
 * summary says "No open lead requirement for this campaign — nothing to measure this lead
 * against" — but the sentence in front of it is what the model reads as the answer, and it is the
 * reason the operator reported scoring as useless.
 *
 * "We have no criteria" and "it fails the criteria" are different statements. This pins them apart.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const mockEvaluate = vi.fn();
vi.mock('@/lib/leadgen/qualification', () => ({
  evaluateLeadQuality: (...a: unknown[]) => mockEvaluate(...a),
  LeadQualityAccessError: class extends Error {},
}));

const { executeTool } = await import('@/lib/ai/tools');

const CTX = {
  tenantId: 't1',
  sessionUser: { id: 'u1', tenantId: 't1', role: 'sdr' },
} as never;

const run = (leadId = 'lead-1') => executeTool('evaluate_lead_quality', { leadId }, CTX);

const assessment = (over: Record<string, unknown> = {}) => ({
  leadId: 'lead-1',
  meetsAnyRequirement: false,
  requirements: [],
  duplicateKey: null,
  duplicateLeadIds: [],
  citedEvidenceIds: [],
  summary: 'No open lead requirement for this campaign — nothing to measure this lead against.',
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('evaluate_lead_quality — nothing configured', () => {
  it('does not claim the lead failed requirements that do not exist', async () => {
    mockEvaluate.mockResolvedValue(assessment());

    const out = await run();

    expect(out).not.toMatch(/does not fully meet/i);
    expect(out.toLowerCase()).toContain('no open lead requirement');
  });

  it('says what to do about it, rather than leaving a dead end', async () => {
    mockEvaluate.mockResolvedValue(assessment());
    const out = await run();
    expect(out.toLowerCase()).toMatch(/configure|set up|add/);
  });
});

describe('evaluate_lead_quality — requirements exist', () => {
  const withRequirement = (fullyMet: boolean) =>
    assessment({
      meetsAnyRequirement: fullyMet,
      requirements: [
        { requirementId: 'req-1', campaignId: 'c1', met: ['industry'], unmet: fullyMet ? [] : ['size'], unknown: [], fullyMet },
      ],
      summary: 'requirement req-1: 1 met, 0 unmet, 0 unknown; no research evidence yet',
    });

  it('still reports a genuine miss as a miss', async () => {
    mockEvaluate.mockResolvedValue(withRequirement(false));
    const out = await run();
    expect(out).toMatch(/does not fully meet/i);
  });

  it('still reports a genuine match as a match', async () => {
    mockEvaluate.mockResolvedValue(withRequirement(true));
    const out = await run();
    expect(out).toMatch(/\bmeets\b/i);
    expect(out).not.toMatch(/does not fully meet/i);
  });

  it('keeps naming duplicates when there are any', async () => {
    mockEvaluate.mockResolvedValue(
      assessment({ ...withRequirement(false), duplicateLeadIds: ['lead-7', 'lead-9'] })
    );
    const out = await run();
    expect(out).toContain('lead-7');
    expect(out).toContain('lead-9');
  });
});
