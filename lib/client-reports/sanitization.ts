import { ReportAudience, SdrDisplayMode } from './types';

const INTERNAL_PHRASE_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /bad lead( from vendor)?/gi, replacement: 'Lead did not match approved ICP criteria' },
  { pattern: /prospect sounded annoyed/gi, replacement: 'Prospect requested no further outreach at this time' },
  { pattern: /client link was broken/gi, replacement: 'Booking link issue was identified and promptly resolved' },
  { pattern: /sdr forgot follow-up/gi, replacement: 'Follow-up cadence has been recalibrated internally' },
  { pattern: /vendor sent (garbage|trash|junk)/gi, replacement: 'Data accuracy review initiated with provider' },
  { pattern: /angry prospect/gi, replacement: 'Prospect not receptive to outbound outreach' },
  { pattern: /waste of time/gi, replacement: 'Out of target profile' },
];

/**
 * Sanitizes internal notes into clean, professional BPO client-facing commentary.
 */
export function sanitizeClientFacingText(text?: string | null): string {
  if (!text) return '';
  let sanitized = text;
  for (const { pattern, replacement } of INTERNAL_PHRASE_REPLACEMENTS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized.trim();
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

  // mode === 'first_last_initial' (e.g. "John Smith" -> "John S.")
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase();
  return lastInitial ? `${firstName} ${lastInitial}.` : firstName;
}
