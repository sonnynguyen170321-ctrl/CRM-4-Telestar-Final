import { ReportAudience, SdrDisplayMode } from './types';

const INTERNAL_TAG_PATTERNS = [
  /\[\[INTERNAL:.*?\]\]/gi,
  /\[INTERNAL:.*?\]/gi,
  /\[\[CONFIDENTIAL:.*?\]\]/gi,
  /\[CONFIDENTIAL:.*?\]/gi,
  /\[\[SENSITIVE:.*?\]\]/gi,
  /\[SENSITIVE:.*?\]/gi,
];

const INTERNAL_PHRASE_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /bad lead( from vendor)?/gi, replacement: 'Lead did not match approved ICP criteria' },
  { pattern: /prospect sounded annoyed/gi, replacement: 'Prospect requested no further outreach at this time' },
  { pattern: /client link was broken/gi, replacement: 'Booking link issue was identified and promptly resolved' },
  { pattern: /sdr forgot follow-up/gi, replacement: 'Follow-up cadence has been recalibrated internally' },
  { pattern: /vendor sent (garbage|trash|junk)/gi, replacement: 'Data accuracy review initiated with provider' },
  { pattern: /angry prospect/gi, replacement: 'Prospect not receptive to outbound outreach' },
  { pattern: /waste of time/gi, replacement: 'Out of target profile' },
  { pattern: /^internal:\s*/gi, replacement: '' },
  { pattern: /;\s*internal:\s*/gi, replacement: '; ' },
];

/**
 * Sanitizes internal notes into clean, professional BPO client-facing commentary.
 */
export function sanitizeClientFacingText(text?: string | null): string {
  if (!text) return '';
  let sanitized = text;
  for (const tagPattern of INTERNAL_TAG_PATTERNS) {
    sanitized = sanitized.replace(tagPattern, '');
  }
  for (const { pattern, replacement } of INTERNAL_PHRASE_REPLACEMENTS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized.replace(/\s{2,}/g, ' ').replace(/\s+\./g, '.').trim();
}

export const sanitizeClientNotes = sanitizeClientFacingText;

/**
 * Anonymizes or formats SDR name per specified display mode.
 */
export function anonymizeSdrName(
  fullName?: string | null,
  mode: SdrDisplayMode | 'first_only' = 'first_last_initial'
): string {
  if (!fullName || !fullName.trim()) return 'Outreach Representative';
  const trimmed = fullName.trim();

  if (mode === 'full_name') {
    return trimmed;
  }
  if (mode === 'anonymized') {
    return 'Outreach Representative';
  }

  const parts = trimmed.split(/\s+/);
  if (mode === 'first_only') {
    return parts[0];
  }

  // mode === 'first_last_initial'
  if (parts.length === 1) return parts[0];
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase();
  return lastInitial ? `${firstName} ${lastInitial}.` : firstName;
}

/**
 * Formats SDR names based on report audience and display preference.
 */
export function formatRepDisplayName(
  fullName: string,
  audience: ReportAudience = 'client',
  mode: SdrDisplayMode = 'first_last_initial',
  index: number = 0
): string {
  if (!fullName) return `SDR ${index + 1}`;
  if (audience === 'internal' || mode === 'full_name') {
    return fullName;
  }
  if (mode === 'anonymized') {
    return `SDR ${index + 1}`;
  }

  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase();
  return lastInitial ? `${firstName} ${lastInitial}.` : firstName;
}

/**
 * Cleans an array of strategic insight bullet points.
 */
export function sanitizeInsightArray(insights: string[]): string[] {
  if (!Array.isArray(insights)) return [];
  return insights.map((item) => sanitizeClientFacingText(item)).filter(Boolean);
}

