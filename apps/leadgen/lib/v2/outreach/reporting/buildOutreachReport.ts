// O8 / design B15: outreach reporting aggregation. Delivery/bounce/reply/meeting,
// per-sender health + volume vs cap, suppression blocks. Open/click are shown
// only when the verified CTD tracking runtime supplies real human events. Pure:
// the read-model loads rows and calls this.

import { effectiveDailyCap, isHealthy, type SenderForSelection } from "../senderPool/policy";

// D2 perf: the report is now fed PRE-AGGREGATED counts (computed in SQL) instead of every
// message/activity row. The loader no longer pulls thousands of rows over the wire to
// count them in JS. Output is identical for delivery/reply/sender health.
export type OutreachMessageCounts = { sent: number; bounced: number };
export type OutreachActivityCounts = { replied: number; meetingsBooked: number; unsubscribed: number };
export type SenderStatRow = SenderForSelection & { sentToday: number };
export type OutreachTrackingCounts = {
  trackingEnabled: boolean;
  uniqueOpens: number;
  uniqueClicks: number;
  totalOpens: number;
  totalClicks: number;
};

export type OutreachReport = {
  totals: {
    sent: number;
    delivered: number;
    bounced: number;
    bounceRate: number;
    replied: number;
    replyRate: number;
    meetingsBooked: number;
    unsubscribed: number;
    suppressionBlocks: number;
  };
  perSender: Array<{
    senderId: string;
    kind: string;
    displayName?: string | null;
    fromAddress?: string | null;
    sentToday: number;
    effectiveCap: number;
    capUtilization: number;
    bounceRate: number;
    complaintRate: number;
    healthy: boolean;
  }>;
  tracking:
    | {
        available: false;
      }
    | {
        available: true;
        uniqueOpens: number;
        uniqueClicks: number;
        totalOpens: number;
        totalClicks: number;
        openRate: number;
        clickRate: number;
      };
};

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

export function buildOutreachReport(input: {
  messageCounts: OutreachMessageCounts;
  activityCounts: OutreachActivityCounts;
  senders: readonly SenderStatRow[];
  suppressionBlocks?: number;
  tracking?: OutreachTrackingCounts;
}): OutreachReport {
  const { sent, bounced } = input.messageCounts;
  const { replied, meetingsBooked, unsubscribed } = input.activityCounts;
  const delivered = Math.max(0, sent - bounced);

  return {
    totals: {
      sent,
      delivered,
      bounced,
      bounceRate: rate(bounced, sent),
      replied,
      replyRate: rate(replied, delivered),
      meetingsBooked,
      unsubscribed,
      suppressionBlocks: input.suppressionBlocks ?? 0,
    },
    perSender: input.senders.map((s) => {
      const cap = effectiveDailyCap(s);
      return {
        senderId: s.id,
        kind: s.kind,
        displayName: s.displayName,
        fromAddress: s.fromAddress,
        sentToday: s.sentToday,
        effectiveCap: cap,
        capUtilization: rate(s.sentToday, cap),
        bounceRate: s.bounceRate,
        complaintRate: s.complaintRate,
        healthy: isHealthy(s),
      };
    }),
    tracking: input.tracking?.trackingEnabled
      ? {
          available: true,
          uniqueOpens: input.tracking.uniqueOpens,
          uniqueClicks: input.tracking.uniqueClicks,
          totalOpens: input.tracking.totalOpens,
          totalClicks: input.tracking.totalClicks,
          openRate: rate(input.tracking.uniqueOpens, delivered),
          clickRate: rate(input.tracking.uniqueClicks, delivered),
        }
      : { available: false },
  };
}
