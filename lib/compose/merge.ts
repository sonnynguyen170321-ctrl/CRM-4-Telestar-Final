/**
 * Merge-field helpers for the composer: find the `{{field}}` tags in a draft, say which ones the
 * real lead (or sender) has no value for, and add a fallback in place.
 *
 * Pure, client and server, and built on the same pattern `renderTemplate` uses so the composer
 * and the send path can never disagree about what counts as a tag.
 */
import { MERGE_FIELD_NAMES, MERGE_FIELD_SOURCE } from '@/lib/templates/render';

export { MERGE_FIELD_NAMES };
export type MergeFieldName = (typeof MERGE_FIELD_NAMES)[number];

export const MERGE_FIELD_LABELS: Record<MergeFieldName, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  company: 'Company',
  title: 'Job title',
  email: 'Email',
  phone: 'Phone',
  sdrName: 'My name',
  sdrTitle: 'My title',
};

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
    const fallback = match[2] === undefined ? null : match[2].trim();
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
  for (const tag of findMergeTags(text)) {
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
  return text.replace(new RegExp(MERGE_FIELD_SOURCE, 'g'), (whole, name: string, existing?: string) => {
    if (name !== field || (existing !== undefined && existing.trim() !== '')) return whole;
    return `{{${name}|${safe}}}`;
  });
}

/** A short, neutral fallback suggestion for a field (what a rep would type). */
export const SUGGESTED_FALLBACKS: Partial<Record<MergeFieldName, string>> = {
  firstName: 'there',
  lastName: '',
  company: 'your company',
  title: 'your role',
};
