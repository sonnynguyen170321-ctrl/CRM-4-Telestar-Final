/**
 * 🛡️ PROMPT INJECTION & SECRET SCRUBBING GUARDS (Sections 68, 69, 70)
 */

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /system\s+prompt\s+override/i,
  /you\s+are\s+now\s+an\s+unrestricted/i,
  /reveal\s+(the\s+)?(api\s+key|database\s+password|secret|oauth)/i,
  /dump\s+all\s+(leads|users|tenants|rows)/i,
  /bypass\s+(tenant\s+isolation|security|rbac)/i,
];

const SECRET_PATTERNS = [
  /tl_live_[a-f0-9]{24,64}/gi,
  /postgresql:\/\/[^:]+:[^@]+@[^/]+\/[^\s]+/gi,
  /bearer\s+eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/gi,
  /ghp_[a-zA-Z0-9]{36}/gi,
];

/**
 * Detects whether untrusted input contains known prompt injection attack vectors.
 */
export function detectPromptInjection(input: string): { isSuspicious: boolean; detectedPattern?: string } {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return { isSuspicious: true, detectedPattern: pattern.source };
    }
  }
  return { isSuspicious: false };
}

/**
 * Scrubs all secrets, passwords, connection strings, and tokens from text before prompt injection.
 */
export function scrubSecrets(input: string): string {
  let output = input;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, '[REDACTED_SECRET]');
  }
  return output;
}

/**
 * Wraps untrusted user content in a safe quoted block.
 */
export function quoteUntrustedData(label: string, content: string): string {
  const sanitized = scrubSecrets(content);
  return `=== UNTRUSTED USER DATA (${label}) ===\n"""\n${sanitized}\n"""\n=== END UNTRUSTED DATA ===`;
}
