export type WarmupStage = 'new' | 'ramping_early' | 'ramping_mid' | 'ramping_late' | 'mature';

export interface WarmupScheduleStep {
  dayRange: string;
  maxDailyVolume: number;
  description: string;
}

export interface WarmupAssessment {
  stage: WarmupStage;
  accountAgeDays: number;
  totalSent: number;
  recentBounceRate: number;
  recommendedDailyCap: number;
  isVolumeSpikeDetected: boolean;
  schedule: WarmupScheduleStep[];
  recommendations: string[];
}

export const STANDARD_WARMUP_SCHEDULE: WarmupScheduleStep[] = [
  { dayRange: 'Days 1–3', maxDailyVolume: 15, description: 'Initial sender reputation seeding. Keep sending to high-engagement contacts.' },
  { dayRange: 'Days 4–7', maxDailyVolume: 30, description: 'Gradual increase. Monitor mailbox responses and bounce rates daily.' },
  { dayRange: 'Days 8–14', maxDailyVolume: 60, description: 'Scaling phase. Ensure personalization and clean contact verification.' },
  { dayRange: 'Days 15–21', maxDailyVolume: 100, description: 'Near-capacity warmup. Monitor domain reputation across all mailbox providers.' },
  { dayRange: 'Days 22+', maxDailyVolume: 150, description: 'Mature sending capacity. Maintain consistent sending patterns.' },
];

/**
 * Calculates the current warmup stage, recommended sending cap, and actionable advice
 * for an email account based on age, volume, and bounce history.
 */
export function calculateWarmupStatus(params: {
  accountCreatedAt: Date;
  totalSentLifetime: number;
  sentLast3Days: number[]; // e.g. [sentToday, sentYesterday, sent2DaysAgo]
  recentBounceRate: number; // 0.0 to 1.0
  currentConfiguredCap?: number;
}): WarmupAssessment {
  const now = new Date();
  const diffMs = now.getTime() - new Date(params.accountCreatedAt).getTime();
  const accountAgeDays = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  let stage: WarmupStage = 'new';
  let recommendedDailyCap = 15;

  if (accountAgeDays <= 3) {
    stage = 'new';
    recommendedDailyCap = 15;
  } else if (accountAgeDays <= 7) {
    stage = 'ramping_early';
    recommendedDailyCap = 30;
  } else if (accountAgeDays <= 14) {
    stage = 'ramping_mid';
    recommendedDailyCap = 60;
  } else if (accountAgeDays <= 21) {
    stage = 'ramping_late';
    recommendedDailyCap = 100;
  } else {
    stage = 'mature';
    recommendedDailyCap = params.currentConfiguredCap && params.currentConfiguredCap > 0 ? params.currentConfiguredCap : 150;
  }

  // Check for sudden volume spikes
  let isVolumeSpikeDetected = false;
  if (params.sentLast3Days.length >= 2) {
    const today = params.sentLast3Days[0] || 0;
    const previousAvg = (params.sentLast3Days.slice(1).reduce((acc, v) => acc + v, 0) / (params.sentLast3Days.length - 1)) || 1;
    if (today > 40 && today > previousAvg * 2.5) {
      isVolumeSpikeDetected = true;
    }
  }

  const recommendations: string[] = [];

  if (params.recentBounceRate > 0.05) {
    recommendedDailyCap = Math.max(10, Math.floor(recommendedDailyCap * 0.5));
    recommendations.push('Bounce rate is elevated (>5%). Warmup pace throttled by 50% to protect domain reputation.');
  } else if (params.recentBounceRate > 0.02) {
    recommendations.push('Bounce rate is in the watch zone (2–5%). Verify email lists with ZeroBounce/NeverBounce before increasing volume.');
  }

  if (isVolumeSpikeDetected) {
    recommendations.push('Sudden sending spike detected. Ramp up gradually to prevent trigger-based ISP spam filtering.');
  }

  if (stage !== 'mature') {
    recommendations.push(`Account is in ${stage.replace('_', ' ')} warmup stage (Day ${accountAgeDays}). Adhere to daily cap of ${recommendedDailyCap} emails/day.`);
  } else {
    recommendations.push('Mailbox is mature. Maintain steady daily volume and healthy engagement cadences.');
  }

  return {
    stage,
    accountAgeDays,
    totalSent: params.totalSentLifetime,
    recentBounceRate: params.recentBounceRate,
    recommendedDailyCap,
    isVolumeSpikeDetected,
    schedule: STANDARD_WARMUP_SCHEDULE,
    recommendations,
  };
}
