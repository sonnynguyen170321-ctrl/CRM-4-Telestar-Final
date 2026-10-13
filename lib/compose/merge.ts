/**
 * Merge-field helpers for the composer: find the `{{field}}` tags in a draft, say which ones the
 * real lead (or sender) has no value for, and add a fallback in place.
 *
 * Pure, client and server, and built on the same pattern `renderTemplate` uses so the composer
 * and the send path can never disagree about what counts as a tag.
 */
import { MERGE_FIELD_NAMES, MERGE_FIELD_SOURCE, MERGE_HELPER_NAMES, parseTagTail, resolveConditionals } from '@/lib/templates/render';

export { MERGE_FIELD_NAMES, MERGE_HELPER_NAMES };
export type MergeFieldName = (typeof MERGE_FIELD_NAMES)[number];

export const MERGE_FIELD_LABELS: Record<MergeFieldName, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  title: 'Job title',
  email: 'Email',
  phone: 'Phone',
  linkedin: 'LinkedIn URL',
  company: 'Company',
  website: 'Website',
  domain: 'Domain',
  industry: 'Industry',
  country: 'Country',
  city: 'City',
  headcount: 'Headcount',
  campaignName: 'Campaign name',
  senderFirstName: 'My first name',
  senderFullName: 'My full name',
  senderTitle: 'My title',
  senderPhone: 'My phone',
  senderCalendarLink: 'My calendar link',
  senderSignatureName: 'My signature name',
  sdrName: 'My name (alias)',
  sdrTitle: 'My title (alias)',
  greeting: 'Greeting (lead local time)',
  dayOfWeek: 'Day of week (lead local)',
  nextWeekday: 'Next working day (lead local)',
  localTime: 'Local time (lead)',
  'ai.icebreaker': 'AI icebreaker',
  'ai.painPoint': 'AI pain point',
  'ai.valueProp': 'AI value proposition',
  'ai.companySummary': 'AI company summary',
  'ai.whyNow': 'AI why now',
  'ai.personalLine': 'AI personal line',
};

export interface MergeFieldGroup {
  id: 'lead' | 'company' | 'sender' | 'time' | 'ai';
  label: string;
  fields: readonly MergeFieldName[];
}

/** The picker's sections, in order. Every name in MERGE_FIELD_NAMES is in exactly one group. */
export const MERGE_FIELD_GROUPS: readonly MergeFieldGroup[] = [
  { id: 'lead', label: 'Lead', fields: ['firstName', 'lastName', 'title', 'email', 'phone', 'linkedin'] },
  { id: 'company', label: 'Company', fields: ['company', 'website', 'domain', 'industry', 'country', 'city', 'headcount', 'campaignName'] },
  {
    id: 'sender',
    label: 'Sender',
    fields: ['senderFirstName', 'senderFullName', 'senderTitle', 'senderPhone', 'senderCalendarLink', 'senderSignatureName', 'sdrName', 'sdrTitle'],
  },
  { id: 'time', label: 'Time (lead local)', fields: ['greeting', 'dayOfWeek', 'nextWeekday', 'localTime'] },
  {
    id: 'ai',
    label: 'AI (generate per lead)',
    fields: ['ai.icebreaker', 'ai.painPoint', 'ai.valueProp', 'ai.companySummary', 'ai.whyNow', 'ai.personalLine'],
  },
];

export interface MergePickerItem {
  id: string;
  label: string;
  hint: string;
  group: string;
  /** What gets inserted when it differs from `{{id}}` (syntax help rows). */
  insert?: string;
}

/** Picker rows for the variable list: grouped fields, then the syntax help. */
export function mergePickerItems(): MergePickerItem[] {
  const fields = MERGE_FIELD_GROUPS.flatMap((group) =>
    group.fields.map((field) => ({ id: field, label: MERGE_FIELD_LABELS[field], hint: `{{${field}}}`, group: group.label })),
  );
  return [...fields, ...MERGE_SYNTAX_HELP.map((row) => ({ ...row, group: 'Syntax help' }))];
}

/** Syntax snippets for the picker's help section: what to type and what it does. */
export const MERGE_SYNTAX_HELP: ReadonlyArray<{ id: string; label: string; insert: string; hint: string }> = [
  { id: 'syntax-fallback', label: 'Fallback', insert: '{{firstName|there}}', hint: 'Used when the lead has no value' },
  { id: 'syntax-helper', label: 'Capitalise / upper / lower', insert: '{{company|capitalize}}', hint: 'lower, upper, capitalize, first-word' },
  { id: 'syntax-if', label: 'Conditional', insert: '{{#if title}}As {{title}}, {{else}}{{/if}}', hint: 'Text only when a field has a value' },
  { id: 'syntax-spintax', label: 'Spintax', insert: '{Hi|Hello|Hey}', hint: 'One option per lead, same on retries' },
];

export function isMergeFieldName(value: string): value is MergeFieldName {
  return (MERGE_FIELD_NAMES as readonly string[]).includes(value);
}

export interface MergeTagRef {
  /** The tag as written, e.g. `{{firstName|there}}`. */
  raw: string;
  field: string;
  /** The text after `|`, trimmed; null when the tag has no fallback. */
  fallback: string | null;
  /** The field is one the renderer fills in. An unknown one is left visible on purpose. */
  known: boolean;
}

export function findMergeTags(text: string): MergeTagRef[] {
  const tags: MergeTagRef[] = [];
  for (const match of text.matchAll(new RegExp(MERGE_FIELD_SOURCE, 'g'))) {
    const fallback = parseTagTail(match[2]).fallback;
    tags.push({ raw: match[0], field: match[1], fallback: fallback === '' ? null : fallback, known: isMergeFieldName(match[1]) });
  }
  return tags;
}

export interface MissingMergeValue {
  field: MergeFieldName;
  raw: string;
}

/**
 * The tags that would render as nothing: a known field, no value for it in `context`, and no
 * `|fallback`. Each field is reported once. A tag with a fallback is not missing — the fallback
 * is what the prospect will read.
 */
export function findMissingMergeValues(text: string, context: Readonly<Record<string, string>>): MissingMergeValue[] {
  const missing: MissingMergeValue[] = [];
  const seen = new Set<string>();
  // Only the branches this lead would read count: a tag inside an untaken {{#if}} is not missing.
  for (const tag of findMergeTags(resolveConditionals(text, context))) {
    if (!tag.known || tag.fallback !== null || seen.has(tag.field)) continue;
    if ((context[tag.field] ?? '').trim() !== '') continue;
    seen.add(tag.field);
    missing.push({ field: tag.field as MergeFieldName, raw: tag.raw });
  }
  return missing;
}

/**
 * Give every bare `{{field}}` in `text` the fallback `{{field|fallback}}`. A tag that already has
 * one is left alone. The fallback is stripped of `}` and `|` and line breaks, which would end or
 * split the tag.
 */
export function addMergeFallback(text: string, field: string, fallback: string): string {
  const safe = fallback.replace(/[}|\r\n]/g, ' ').trim();
  if (!safe) return text;
  return text.replace(new RegExp(MERGE_FIELD_SOURCE, 'g'), (whole, name: string, tail?: string) => {
    if (name !== field) return whole;
    const { helpers, fallback: existing } = parseTagTail(tail);
    if (existing !== '') return whole;
    return `{{${[name, ...helpers, safe].join('|')}}}`;
  });
}

/** A short, neutral fallback suggestion for a field (what a rep would type). */
export const SUGGESTED_FALLBACKS: Partial<Record<MergeFieldName, string>> = {
  firstName: 'there',
  lastName: '',
  company: 'your company',
  title: 'your role',
  greeting: 'Hello',
  industry: 'your industry',
  senderTitle: 'your contact',
};
