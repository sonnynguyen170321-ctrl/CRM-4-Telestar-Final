/**
 * Merge-field rendering for outreach templates (SKILL.md §4).
 *
 * Supported fields: {{firstName}} {{lastName}} {{company}} {{title}}
 * {{email}} {{phone}} {{sdrName}} {{sdrTitle}}, plus fallback syntax
 * {{firstName|there}}. Missing values render as '' — never "undefined".
 *
 * Pure module (no prisma import) so it can be shared by server routes
 * and client-side template previews.
 */

import { isHtml } from '@/lib/email/sanitize';

export interface RenderLead {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface RenderSdr {
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
}

const ROLE_TITLES: Record<string, string> = {
  director: 'Director',
  floor_manager: 'Floor Manager',
  team_lead: 'Team Lead',
  sdr: 'Sales Development Representative',
  leadgen: 'Lead Generation Specialist',
};

export function buildMergeContext(lead: RenderLead, sdr?: RenderSdr): Record<string, string> {
  const sdrName = [sdr?.firstName, sdr?.lastName].filter(Boolean).join(' ');
  return {
    firstName: lead.firstName ?? '',
    lastName: lead.lastName ?? '',
    company: lead.company ?? '',
    title: lead.title ?? '',
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    sdrName,
    sdrTitle: (sdr?.role && ROLE_TITLES[sdr.role]) || '',
  };
}

/** Source of the merge-tag pattern, for callers that scan text without rendering it. */
export const MERGE_FIELD_SOURCE = String.raw`\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*(?:\|([^}]*))?\}\}`;
const MERGE_FIELD_RE = new RegExp(MERGE_FIELD_SOURCE, 'g');

/** The fields a template may name (the keys of `buildMergeContext`). */
export const MERGE_FIELD_NAMES = ['firstName', 'lastName', 'company', 'title', 'email', 'phone', 'sdrName', 'sdrTitle'] as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A merge value goes in as data, never as markup or as another merge field.
 *
 *  - In an HTML template the value is HTML-escaped: a company called `<img src=x onerror=...>`
 *    must arrive as text.
 *  - A value containing `{{` has a zero-width space put between the braces. A body is rendered
 *    more than once on its way out (the route or sequence worker, then the email worker); without
 *    this a first name of `{{lastName}}` would be expanded by the second pass.
 *
 * The fallback text is written by the template's author and is left as written.
 */
function asMergeData(value: string, htmlTemplate: boolean): string {
  const safe = htmlTemplate ? escapeHtml(value) : value;
  return safe.replace(/\{\{/g, '{\u200B{');
}

export function renderTemplate(text: string, lead: RenderLead, sdr?: RenderSdr): string {
  const ctx = buildMergeContext(lead, sdr);
  const htmlTemplate = isHtml(text);
  return text.replace(MERGE_FIELD_RE, (match, field: string, fallback?: string) => {
    if (!(field in ctx)) return match; // unknown field — leave visible so it gets noticed
    const value = ctx[field];
    return value !== '' ? asMergeData(value, htmlTemplate) : (fallback ?? '').trim();
  });
}
