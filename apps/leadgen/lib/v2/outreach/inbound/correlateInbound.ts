import { parseDsn, type ParsedDsn } from "./parseDsn";

// O7 / design B3+B14: inbound trust = correlation. An inbound message is acted on
// ONLY if it correlates to an outbound Message-ID WE actually sent (high-entropy,
// so it cannot be guessed). Un-correlatable mail is ignored — the SMTP/IMAP
// equivalent of rejecting an unsigned webhook. Pure: the caller supplies the set
// of our outbound Message-IDs (already tenant-scoped by the polled sender).

export type InboundKind = "reply" | "bounce_dsn" | "unsubscribe" | "uncorrelated";

export type InboundHeaders = {
  from?: string;
  subject?: string;
  inReplyTo?: string; // In-Reply-To header
  references?: string; // References header (space-separated Message-IDs)
  rawHeaders: string;
  rawBody: string;
};

export type CorrelatedInbound = {
  kind: InboundKind;
  correlatedMessageId: string | null;
  dsn: ParsedDsn | null;
};

function extractMessageIds(value: string | undefined): string[] {
  if (!value) return [];
  return (value.match(/<[^>\s]+>/g) ?? []).map((s) => s.trim());
}

function looksLikeUnsubscribe(headers: InboundHeaders): boolean {
  const subject = (headers.subject ?? "").toLowerCase();
  const body = (headers.rawBody ?? "").toLowerCase();
  return /\bunsubscribe\b|\bremove me\b|\bopt[\s-]?out\b/.test(subject) || /^\s*unsubscribe\s*$/im.test(body);
}

/**
 * Classify + correlate an inbound message against our outbound Message-IDs.
 * Correlation order: a DSN's original Message-ID, then reply In-Reply-To/References.
 * No match ⇒ kind "uncorrelated", correlatedMessageId null ⇒ caller IGNORES it.
 */
export function correlateInbound(
  headers: InboundHeaders,
  ourOutboundMessageIds: ReadonlySet<string>
): CorrelatedInbound {
  const dsn = parseDsn(headers.rawHeaders, headers.rawBody);

  // Bounce DSN: correlate via the original Message-ID.
  if (dsn.isDsn) {
    const id = dsn.originalMessageId;
    if (id && ourOutboundMessageIds.has(id)) {
      return { kind: "bounce_dsn", correlatedMessageId: id, dsn };
    }
    return { kind: "uncorrelated", correlatedMessageId: null, dsn };
  }

  // Reply / unsubscribe: correlate via In-Reply-To / References.
  const candidateIds = [
    ...extractMessageIds(headers.inReplyTo),
    ...extractMessageIds(headers.references),
  ];
  const matched = candidateIds.find((id) => ourOutboundMessageIds.has(id)) ?? null;

  if (!matched) {
    return { kind: "uncorrelated", correlatedMessageId: null, dsn: null };
  }
  if (looksLikeUnsubscribe(headers)) {
    return { kind: "unsubscribe", correlatedMessageId: matched, dsn: null };
  }
  return { kind: "reply", correlatedMessageId: matched, dsn: null };
}

export type InboundAction = {
  action: "ignore" | "process";
  createSuppression: boolean;
  suppressionType: "BOUNCE" | "UNSUBSCRIBE" | null;
  haltSequence: boolean;
  activityEventKind: string | null;
  retrySoftBounce: boolean;
};

/** Decide what to do with a correlated inbound event (security + Link B effects). */
export function decideInboundAction(correlated: CorrelatedInbound): InboundAction {
  if (!correlated.correlatedMessageId) {
    // Un-correlatable ⇒ ignore (cannot be trusted; B3). Never suppress/act.
    return { action: "ignore", createSuppression: false, suppressionType: null, haltSequence: false, activityEventKind: null, retrySoftBounce: false };
  }

  switch (correlated.kind) {
    case "bounce_dsn": {
      if (correlated.dsn?.isHardBounce) {
        return { action: "process", createSuppression: true, suppressionType: "BOUNCE", haltSequence: true, activityEventKind: "outreach.bounced", retrySoftBounce: false };
      }
      // soft bounce: retry/backoff, no permanent suppression
      return { action: "process", createSuppression: false, suppressionType: null, haltSequence: false, activityEventKind: "outreach.soft_bounced", retrySoftBounce: true };
    }
    case "unsubscribe":
      return { action: "process", createSuppression: true, suppressionType: "UNSUBSCRIBE", haltSequence: true, activityEventKind: "outreach.unsubscribed", retrySoftBounce: false };
    case "reply":
      return { action: "process", createSuppression: false, suppressionType: null, haltSequence: true, activityEventKind: "outreach.replied", retrySoftBounce: false };
    default:
      return { action: "ignore", createSuppression: false, suppressionType: null, haltSequence: false, activityEventKind: null, retrySoftBounce: false };
  }
}
