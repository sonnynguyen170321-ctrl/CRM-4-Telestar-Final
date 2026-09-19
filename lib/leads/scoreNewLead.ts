/**
 * What every lead gets the moment it exists, whichever door it came through.
 *
 * There are five ways a `Lead` is created — the New Lead modal, Import CSV, pool → convert,
 * the contact-intelligence assignment, and the v1 API — and until 2026-09-19 only the first
 * scored anything. On production 987 of 1,138 leads had a null `engagementScore`, every Judy
 * import among them, and no lead anywhere had an ICP verdict because there was nowhere to put
 * one. The list page read the stored null; the panel recomputed a live 0. Two answers to one
 * question, and neither was "here is how well this lead fits the campaign".
 *
 * This is the one place all five doors call. Two scores, two meanings, both written:
 *
 *  - engagement — `scoreLead`, the canonical behavioural scorer: replies, opens, meetings.
 *    For a fresh lead that is 0 / no_engagement, which is true, and a stored 0 is not a null:
 *    "looked, nothing yet" rather than "never looked".
 *  - ICP fit — `scoreLeadIcp`, the same engine the pool uses, against the campaign's ICP.
 *    NOT SCORED when the campaign has none, said out loud in the result.
 *
 * Never throws. Scoring is a consequence of creation, not a precondition: an import row must
 * not fail because the ICP could not be read. Failures are logged with the lead id so they can
 * be found and re-run through the rescore endpoint.
 */
import { prisma } from '@/lib/prisma';
import { scoreLead } from '@/lib/leads/scoring';
import { scoreLeadIcp, type ScoreLeadIcpResult } from '@/lib/leads/icpScoring';

export type NewLeadScores = {
  engagementScore: number | null;
  icp: ScoreLeadIcpResult | { status: 'error'; message: string };
};

export async function scoreNewLead(params: { tenantId: string; leadId: string }): Promise<NewLeadScores> {
  const { tenantId, leadId } = params;
  const out: NewLeadScores = { engagementScore: null, icp: { status: 'error', message: 'not attempted' } };

  try {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      include: { _count: { select: { meetings: true } } },
    });
    if (lead) {
      const engagement = scoreLead({ ...lead, meetingCount: lead._count.meetings });
      await prisma.lead.update({ where: { id: leadId }, data: { engagementScore: engagement.score } });
      out.engagementScore = engagement.score;
    }
  } catch (err) {
    console.error(`[scoreNewLead] engagement scoring failed for lead ${leadId}:`, err);
  }

  try {
    out.icp = await scoreLeadIcp({ tenantId, leadId });
  } catch (err) {
    console.error(`[scoreNewLead] ICP scoring failed for lead ${leadId}:`, err);
    out.icp = { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  return out;
}
