/**
 * Prompt-injection detection and secret scrubbing for untrusted text.
 *
 * "Untrusted" here means what `AGENTS.md` means by it: prospect emails, lead notes, imported
 * fields, scraped web content and old agent transcripts. Imperative text inside any of those is
 * content to handle, never policy to follow.
 *
 * ## Why the secret list is the shape it is
 *
 * It previously held four patterns — `tl_live_`, Postgres URLs, bearer JWTs and `ghp_` — and
 * covered **none of the three credential formats this deployment actually holds**. A model or
 * tool that echoed `OPENAI_API_KEY` back into a response would have had it passed through
 * untouched. That was not a theoretical gap: the provider outage of 2026-08-21 involved reading
 * provider errors, and OpenAI's own 401 body quotes a partially-masked key.
 *
 * The rule for adding a pattern: it must match a credential format something in this system can
 * plausibly hold or receive, and it must not match ordinary CRM prose. Both halves are asserted
 * in `tests/telestar-ai-certification-evals.test.ts` — a scrubber that redacts sentences is one
 * that gets switched off.
 *
 * ## Two modules became one
 *
 * `lib/ai/securityGuards.ts` was a second, separate implementation with a different and partly
 * broader injection list. Two security controls with two opinions is worse than either alone,
 * because a reader auditing "is injection handled" finds one of them and stops. Its patterns are
 * merged here and it is deleted.
 */

/**
 * Injection vectors, merged from both former implementations.
 *
 * Deliberately conservative: each entry describes an instruction aimed at the model rather than
 * a topic a user might legitimately raise. "Show me the database schema" is a fair CRM question;
 * "reveal the system prompt" is not.
 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /system\s+prompt\s+override/i,
  /system\s*:\s*override/i,
  /you\s+are\s+now\s+an?\s+(unrestricted|developer\s+mode|dan\b)/i,
  /you\s+are\s+now\s+in\s+developer\s+mode/i,
  /reveal\s+(the\s+)?(system\s+prompt|instructions|api\s*key|database\s+password|secret|oauth)/i,
  /dump\s+all\s+(leads|users|tenants|rows|database\s+credentials)/i,
  /bypass\s+(tenant\s+isolation|security|rbac|authorization)/i,
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/i,
  /\bDROP\s+TABLE\b/i,
  /\bDELETE\s+FROM\b/i,
];

/**
 * Credential formats. Ordered longest-prefix first so a more specific pattern wins.
 *
 * `sk-proj-` precedes the generic `sk-` for that reason. Lengths are minimums, not exact:
 * providers lengthen keys without notice, and a pattern pinned to today's length silently stops
 * matching tomorrow's key.
 */
const SECRET_PATTERNS = [
  // Telestar's own API tokens.
  /tl_(live|test)_[a-f0-9]{24,64}/gi,
  // Database and cache URLs carrying a password.
  /postgres(ql)?:\/\/[^:\s]+:[^@\s]+@[^\s]+/gi,
  /rediss?:\/\/[^:\s]+:[^@\s]+@[^\s]+/gi,
  /mongodb(\+srv)?:\/\/[^:\s]+:[^@\s]+@[^\s]+/gi,
  // The three AI provider credentials this deployment holds.
  /sk-proj-[A-Za-z0-9_-]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /AIza[A-Za-z0-9_-]{30,}/g,
  /gsk_[A-Za-z0-9]{20,}/g,
  // Other credentials that reach this system through integrations and logs.
  /ghp_[A-Za-z0-9]{36}/g,
  /gho_[A-Za-z0-9]{36}/g,
  /github_pat_[A-Za-z0-9_]{40,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/gi,
  /AKIA[0-9A-Z]{16}/g,
  /bearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

export const REDACTION_PLACEHOLDER = '[REDACTED_SECRET]';

/** Detects whether untrusted input contains a known prompt-injection vector. */
export function detectPromptInjection(input: string): { isSuspicious: boolean; detectedPattern?: string } {
  for (const pattern of INJECTION_PATTERNS) {
    // `lastIndex` is irrelevant here: none of the injection patterns carry /g.
    if (pattern.test(input)) {
      return { isSuspicious: true, detectedPattern: pattern.source };
    }
  }
  return { isSuspicious: false };
}

/**
 * Removes credential-shaped substrings from text.
 *
 * Applied to text on its way *out* — a model completion, a tool result, an error body — as well
 * as to untrusted text on its way in. Scrubbing only the inbound direction protects nothing:
 * the leak path that matters is a secret reaching a user, not a user sending one.
 */
export function scrubSecrets(input: string): string {
  let output = input;
  for (const pattern of SECRET_PATTERNS) {
    // Each pattern is module-level and several carry /g, which makes `lastIndex` stateful
    // across calls. `String.replace` resets it for /g patterns, but re-creating the regex per
    // call removes the question entirely rather than relying on that.
    output = output.replace(new RegExp(pattern.source, pattern.flags), REDACTION_PLACEHOLDER);
  }
  return output;
}

/**
 * Wraps untrusted content in an explicit boundary, with credentials removed.
 *
 * The boundary is not a security control on its own — a model can be talked across it. It is a
 * labelling control: it tells the model which span is data, so that the constitution's rule
 * about untrusted content has something to refer to.
 */
export function quoteUntrustedData(label: string, content: string): string {
  const sanitized = scrubSecrets(content);
  return `=== UNTRUSTED USER DATA (${label}) ===\n"""\n${sanitized}\n"""\n=== END UNTRUSTED DATA ===`;
}
