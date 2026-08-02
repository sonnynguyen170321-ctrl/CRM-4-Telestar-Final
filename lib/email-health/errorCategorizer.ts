export type BounceCategory =
  | 'mailbox_not_found'
  | 'domain_not_found'
  | 'spam_block'
  | 'rate_limit_exceeded'
  | 'content_filtered'
  | 'dmarc_spf_failure'
  | 'mailbox_full'
  | 'transient_network_error'
  | 'unknown_bounce';

export interface CategorizedBounceResult {
  category: BounceCategory;
  isHardBounce: boolean;
  shouldPauseAccount: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
  recommendedAction: string;
}

/**
 * Parses raw SMTP bounce messages, status codes, or provider diagnostic strings
 * into a structured categorization for remediation.
 */
export function categorizeBounceError(rawReason?: string | null): CategorizedBounceResult {
  if (!rawReason || rawReason.trim() === '') {
    return {
      category: 'unknown_bounce',
      isHardBounce: false,
      shouldPauseAccount: false,
      severity: 'low',
      explanation: 'No specific bounce error details provided by recipient server.',
      recommendedAction: 'Monitor mailbox for recurring bounce events.',
    };
  }

  const reason = rawReason.toLowerCase();

  // 1. Mailbox Not Found / Invalid User (Hard Bounce)
  if (
    reason.includes('5.1.1') ||
    reason.includes('user unknown') ||
    reason.includes('recipient address rejected') ||
    reason.includes('no such user') ||
    reason.includes('mailbox not found') ||
    reason.includes('address does not exist') ||
    reason.includes('undeliverable')
  ) {
    return {
      category: 'mailbox_not_found',
      isHardBounce: true,
      shouldPauseAccount: false,
      severity: 'medium',
      explanation: 'The recipient email address does not exist or was deleted.',
      recommendedAction: 'Verify prospect email before outreach. Scrub invalid contacts from campaign list.',
    };
  }

  // 2. Domain Not Found (Hard Bounce)
  if (
    reason.includes('5.1.2') ||
    reason.includes('host not found') ||
    reason.includes('domain not found') ||
    reason.includes('no mx') ||
    reason.includes('unrouteable address')
  ) {
    return {
      category: 'domain_not_found',
      isHardBounce: true,
      shouldPauseAccount: false,
      severity: 'medium',
      explanation: 'Recipient domain has no valid mail server or domain does not exist.',
      recommendedAction: 'Remove domain from lead list. Update prospect company record.',
    };
  }

  // 3. Spam Block / Blacklist (Critical)
  if (
    reason.includes('5.7.1') ||
    reason.includes('spamhaus') ||
    reason.includes('barracuda') ||
    reason.includes('sorbs') ||
    reason.includes('blocked using') ||
    reason.includes('spamcop') ||
    reason.includes('blacklisted') ||
    reason.includes('reputation') ||
    reason.includes('poor reputation') ||
    reason.includes('rejected due to spam') ||
    reason.includes('554')
  ) {
    return {
      category: 'spam_block',
      isHardBounce: false,
      shouldPauseAccount: true,
      severity: 'critical',
      explanation: 'Outbound IP or domain is flagged on a public anti-spam blacklist or recipient ISP filter.',
      recommendedAction: 'Immediately pause mailbox. Check blacklist delisting and reduce daily sending volume.',
    };
  }

  // 4. Rate Limit / Sending Quota Exceeded (High)
  if (
    reason.includes('4.7.1') ||
    reason.includes('421') ||
    reason.includes('rate limit') ||
    reason.includes('too many connections') ||
    reason.includes('sending limit') ||
    reason.includes('sending quota') ||
    reason.includes('daily quota') ||
    reason.includes('slow down')
  ) {
    return {
      category: 'rate_limit_exceeded',
      isHardBounce: false,
      shouldPauseAccount: false,
      severity: 'high',
      explanation: 'Recipient mail server or sending provider enforced rate limits or velocity caps.',
      recommendedAction: 'Space out sequence intervals and reduce simultaneous concurrent sending threads.',
    };
  }

  // 5. DMARC / SPF / Authentication Failure (High)
  if (
    reason.includes('5.7.26') ||
    reason.includes('dkim') ||
    reason.includes('spf') ||
    reason.includes('dmarc') ||
    reason.includes('authentication required') ||
    reason.includes('unauthenticated') ||
    reason.includes('sender policy framework')
  ) {
    return {
      category: 'dmarc_spf_failure',
      isHardBounce: false,
      shouldPauseAccount: true,
      severity: 'high',
      explanation: 'Sending domain failed SPF, DKIM, or DMARC authentication checks.',
      recommendedAction: 'Inspect domain DNS records in Settings -> Email Health. Verify SPF and DMARC configuration.',
    };
  }

  // 6. Content Filtered (High)
  if (
    reason.includes('content') ||
    reason.includes('virus') ||
    reason.includes('attachment') ||
    reason.includes('policy violation') ||
    reason.includes('message rejected by filter') ||
    reason.includes('prohibited message')
  ) {
    return {
      category: 'content_filtered',
      isHardBounce: false,
      shouldPauseAccount: false,
      severity: 'high',
      explanation: 'Email template triggered recipient content security filter (e.g. spam keywords or links).',
      recommendedAction: 'Revise email copy. Remove tracked redirect links and spam trigger phrases.',
    };
  }

  // 7. Mailbox Full (Soft Bounce)
  if (
    reason.includes('4.2.2') ||
    reason.includes('mailbox full') ||
    reason.includes('over quota') ||
    reason.includes('storage limit')
  ) {
    return {
      category: 'mailbox_full',
      isHardBounce: false,
      shouldPauseAccount: false,
      severity: 'low',
      explanation: 'Recipient mailbox is temporarily full or exceeded storage limits.',
      recommendedAction: 'Retry sending in 2-3 business days or contact via phone/LinkedIn.',
    };
  }

  // 8. Transient Network Error (Soft Bounce)
  if (
    reason.includes('timeout') ||
    reason.includes('timed out') ||
    reason.includes('econnreset') ||
    reason.includes('network unreachable') ||
    reason.includes('connection refused')
  ) {
    return {
      category: 'transient_network_error',
      isHardBounce: false,
      shouldPauseAccount: false,
      severity: 'low',
      explanation: 'Temporary network connection or gateway timeout.',
      recommendedAction: 'System will automatically retry on the next retry cycle.',
    };
  }

  return {
    category: 'unknown_bounce',
    isHardBounce: false,
    shouldPauseAccount: false,
    severity: 'low',
    explanation: `Unclassified bounce: "${rawReason.slice(0, 100)}"`,
    recommendedAction: 'Monitor overall mailbox bounce rate across sequence steps.',
  };
}
