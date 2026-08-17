import { prisma } from '@/lib/prisma';

export interface CampaignDiagnosisReport {
  campaignId: string;
  campaignName: string;
  totalLeads: number;
  sampleSizeAdequate: boolean;
  primaryHypothesis: string;
  supportingHypotheses: string[];
  metricsSummary: {
    enrolledCount: number;
    repliedCount: number;
    bounceCount: number;
    replyRatePercent: number;
    bounceRatePercent: number;
  };
  recommendedInterventions: string[];
}

/**
 * 🎯 CAMPAIGN DIAGNOSTIC ENGINE (Sections 52 & 53)
 * Multi-hypothesis attribution engine with sample-size awareness.
 */
export async function diagnoseCampaignPerformance(params: {
  campaignId: string;
  tenantId: string;
}): Promise<CampaignDiagnosisReport | null> {
  const { campaignId, tenantId } = params;

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId },
    select: {
      id: true,
      name: true,
      leads: {
        select: {
          id: true,
          stage: true,
          emailInvalid: true,
          sequenceStatus: true,
        },
      },
    },
  });

  if (!campaign) return null;

  const totalLeads = campaign.leads.length;
  const sampleSizeAdequate = totalLeads >= 30;

  const enrolledCount = campaign.leads.filter((l) => l.sequenceStatus !== null).length;
  const repliedCount = campaign.leads.filter((l) => l.stage === 'replied' || l.stage === 'meeting_booked' || l.stage === 'won').length;
  const bounceCount = campaign.leads.filter((l) => l.emailInvalid).length;

  const replyRatePercent = enrolledCount > 0 ? Math.round((repliedCount / enrolledCount) * 100) : 0;
  const bounceRatePercent = totalLeads > 0 ? Math.round((bounceCount / totalLeads) * 100) : 0;

  const supportingHypotheses: string[] = [];
  const recommendedInterventions: string[] = [];
  let primaryHypothesis = 'Campaign is performing within expected variance.';

  // 1. Check Sample Size
  if (!sampleSizeAdequate) {
    supportingHypotheses.push(
      `Sample size (${totalLeads} leads) is too small to declare definitive conversion trends. Treat metrics as preliminary.`
    );
  }

  // 2. High Bounce Rate Check
  if (bounceRatePercent >= 8) {
    primaryHypothesis = 'DELIVERABILITY & LIST HYGIENE RISK: Elevated bounce rate is harming sender domain reputation.';
    supportingHypotheses.push(
      `Bounce rate of ${bounceRatePercent}% exceeds the 5% industry threshold. Senders risk spam filtering.`
    );
    recommendedInterventions.push('Run list through email validation provider before launching further sequences.');
  }
  // 3. Low Reply Rate on Active Sequences
  else if (enrolledCount >= 20 && replyRatePercent < 3) {
    primaryHypothesis = 'COPY & VALUE PROPOSITION FRICTION: Low reply conversion despite active sequence enrollment.';
    supportingHypotheses.push(
      `Only ${replyRatePercent}% of enrolled leads replied. Email copy or offer angle may not be compelling to target ICP.`
    );
    recommendedInterventions.push('A/B test subject lines and shorten step 1 copy to focus on a single pain point.');
  }
  // 4. Strong Conversion
  else if (replyRatePercent >= 10) {
    primaryHypothesis = 'HIGH-PERFORMING CAMPAIGN: Strong ICP alignment and positive response rate.';
    recommendedInterventions.push('Scale lead volume into this campaign and replicate template across sister territories.');
  }

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    totalLeads,
    sampleSizeAdequate,
    primaryHypothesis,
    supportingHypotheses,
    metricsSummary: {
      enrolledCount,
      repliedCount,
      bounceCount,
      replyRatePercent,
      bounceRatePercent,
    },
    recommendedInterventions,
  };
}
