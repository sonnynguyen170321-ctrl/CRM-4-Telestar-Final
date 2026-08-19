/**
 * Telestar AI Security & Prompt Injection Defense Guards (Directive Phase 27 §92, §93).
 * External content sanitization and adversarial injection detection.
 */

export interface InjectionInspectionResult {
  isSafe: boolean;
  sanitizedData: string;
  detectedThreatPatterns: string[];
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /reveal\s+(the\s+)?(system\s+prompt|instructions|secret|api\s*key|database)/i,
  /you\s+are\s+now\s+(in\s+developer\s+mode|unrestricted|dan)/i,
  /system\s*:\s*override/i,
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /\bDROP\s+TABLE\b/i,
  /\bDELETE\s+FROM\b/i,
];

export function sanitizeAndInspectUntrustedData(rawInput: string): InjectionInspectionResult {
  const detectedThreatPatterns: string[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(rawInput)) {
      detectedThreatPatterns.push(pattern.source);
    }
  }

  // Wrap in safe data boundaries
  const sanitizedData = `[UNTRUSTED_EXTERNAL_DATA_START]\n${rawInput.trim()}\n[UNTRUSTED_EXTERNAL_DATA_END]`;

  return {
    isSafe: detectedThreatPatterns.length === 0,
    sanitizedData,
    detectedThreatPatterns,
  };
}
