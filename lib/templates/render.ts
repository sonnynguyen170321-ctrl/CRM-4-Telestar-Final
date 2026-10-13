/**
 * Merge-field rendering for outreach templates (SKILL.md §4) - the one renderer. The composer
 * preview, the send route, the sequence worker and the email worker all call `renderTemplate`.
 *
 * Variables (namespaced in the picker, flat in the text):
 *  - Lead:    {{firstName}} {{lastName}} {{title}} {{email}} {{phone}} {{linkedin}}
 *  - Company: {{company}} {{website}} {{domain}} {{industry}} {{country}} {{city}} {{headcount}} {{campaignName}}
 *  - Sender:  {{senderFirstName}} {{senderFullName}} {{senderTitle}} {{senderPhone}}
 *             {{senderCalendarLink}} {{senderSignatureName}} ({{sdrName}} / {{sdrTitle}} are aliases)
 *  - Time (in the LEAD's timezone): {{greeting}} {{dayOfWeek}} {{nextWeekday}} {{localTime}}
 *  - AI (saved per lead, rep-editable, never invented): {{ai.icebreaker}} {{ai.painPoint}} {{ai.valueProp}}
 *             {{ai.companySummary}} {{ai.whyNow}} {{ai.personalLine}}
 *
 * Syntax, all of it parsed by hand - nothing here evaluates anything:
 *  - fallback            {{firstName|there}}
 *  - helpers             {{company|capitalize}} {{company|upper|your company}} (lower, upper, capitalize, first-word)
 *  - conditionals        {{#if title}}...{{else}}...{{/if}} (nestable; true when the field has a value)
 *  - spintax             {Hi|Hello|Hey} - one option, chosen deterministically from the lead and the
 *                        template so a retry sends the same words
 *
 * Missing values render as '' - never "undefined". Unknown fields stay visible so they get noticed.
 *
 * Pure module (no prisma import) so it can be shared by server routes and client-side previews.
 */

import { isHtml } from '@/lib/email/sanitize';
import { getLocalTime, isValidTimezone } from '@/lib/automation/timezone';
import { inferTimezone } from '@/lib/time/inferTimezone';

export interface RenderAiVariables {
  icebreaker?: string | null;
  painPoint?: string | null;
  valueProp?: string | null;
  companySummary?: string | null;
  whyNow?: string | null;
  personalLine?: string | null;
}

export interface RenderLead {
  /** Seeds spintax so the same lead gets the same words on a retry. */
  id?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedIn?: string | null;
  /** IANA zone the lead works in; when absent it is inferred from the country or phone, else unknown. */
  timezone?: string | null;
  account?: {
    website?: string | null;
    domain?: string | null;
    canonicalDomain?: string | null;
    industry?: string | null;
    country?: string | null;
    size?: number | null;
    staffCountRange?: string | null;
  } | null;
  campaign?: { name?: string | null } | null;
  /** Saved AI variables for this lead (LeadAiInsight.variablesJson). Empty means not generated. */
  aiVariables?: RenderAiVariables | null;
}

export interface RenderSdr {
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  calendarLink?: string | null;
}

export interface RenderOptions {
  /** The clock, for the time-aware variables. Defaults to now. */
  now?: Date;
}

const ROLE_TITLES: Record<string, string> = {
  director: 'Director',
  floor_manager: 'Floor Manager',
  team_lead: 'Team Lead',
  sdr: 'Sales Development Representative',
  leadgen: 'Lead Generation Specialist',
};

export const AI_VARIABLE_KEYS = ['icebreaker', 'painPoint', 'valueProp', 'companySummary', 'whyNow', 'personalLine'] as const;
export type AiVariableKey = (typeof AI_VARIABLE_KEYS)[number];

/** Longest value any variable may insert, so one field cannot swamp an email. */
const DEFAULT_VALUE_CAP = 200;
const VALUE_CAPS: Record<string, number> = {
  'ai.icebreaker': 400,
  'ai.painPoint': 400,
  'ai.valueProp': 400,
  'ai.companySummary': 600,
  'ai.whyNow': 400,
  'ai.personalLine': 400,
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Single-line, bounded: a value never carries a line break into a header or a runaway block into a body. */
function cleanValue(value: string | null | undefined, field: string): string {
  const flat = (value ?? '').replace(/\s+/g, ' ').trim();
  const cap = VALUE_CAPS[field] ?? DEFAULT_VALUE_CAP;
  return flat.length > cap ? `${flat.slice(0, cap - 1).trimEnd()}…` : flat;
}

function leadTimezone(lead: RenderLead): string | null {
  if (lead.timezone && isValidTimezone(lead.timezone)) return lead.timezone;
  const inferred = inferTimezone({ country: lead.account?.country, phone: lead.phone });
  return inferred && isValidTimezone(inferred.timezone) ? inferred.timezone : null;
}

/** Greeting, weekday, next working day and wall-clock time where the lead is. Empty when the zone is unknown. */
function timeContext(lead: RenderLead, now: Date): Record<string, string> {
  const zone = leadTimezone(lead);
  if (!zone) return { greeting: '', dayOfWeek: '', nextWeekday: '', localTime: '' };
  const local = getLocalTime(now, zone);
  const hour = local.hour % 24;
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  // Friday, Saturday and Sunday all point at Monday.
  const nextDay = local.dayOfWeek >= 5 || local.dayOfWeek === 0 ? 1 : local.dayOfWeek + 1;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return {
    greeting,
    dayOfWeek: WEEKDAYS[local.dayOfWeek],
    nextWeekday: WEEKDAYS[nextDay],
    localTime: `${hour12}:${String(local.minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`,
  };
}

export function buildMergeContext(lead: RenderLead, sdr?: RenderSdr, options: RenderOptions = {}): Record<string, string> {
  const account = lead.account ?? null;
  const fullName = [sdr?.firstName, sdr?.lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const senderTitle = sdr?.jobTitle?.trim() || (sdr?.role && ROLE_TITLES[sdr.role]) || '';
  const headcount = account?.size ? String(account.size) : (account?.staffCountRange ?? '');

  const ctx: Record<string, string> = {
    firstName: lead.firstName ?? '',
    lastName: lead.lastName ?? '',
    company: lead.company ?? '',
    title: lead.title ?? '',
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    linkedin: lead.linkedIn ?? '',
    website: account?.website ?? '',
    domain: account?.domain ?? account?.canonicalDomain ?? '',
    industry: account?.industry ?? '',
    country: account?.country ?? '',
    // The CRM keeps no city for a lead or account today; the variable stays empty (and warns) until one exists.
    city: '',
    headcount,
    campaignName: lead.campaign?.name ?? '',
    senderFirstName: sdr?.firstName ?? '',
    senderFullName: fullName,
    senderTitle,
    senderPhone: sdr?.phone ?? '',
    senderCalendarLink: sdr?.calendarLink ?? '',
    senderSignatureName: fullName,
    sdrName: fullName,
    sdrTitle: senderTitle,
    ...timeContext(lead, options.now ?? new Date()),
  };
  for (const key of AI_VARIABLE_KEYS) ctx[`ai.${key}`] = lead.aiVariables?.[key] ?? '';
  for (const field of Object.keys(ctx)) ctx[field] = cleanValue(ctx[field], field);
  return ctx;
}

/** The pattern of one `{{field}}`, `{{field|fallback}}` or `{{field|helper|fallback}}` tag. */
export const MERGE_FIELD_SOURCE = String.raw`\{\{\s*([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)?)\s*(?:\|([^}]*))?\}\}`;
const MERGE_FIELD_RE = new RegExp(MERGE_FIELD_SOURCE, 'g');

/** The fields a template may name (the keys of `buildMergeContext`). */
export const MERGE_FIELD_NAMES = [
  'firstName', 'lastName', 'title', 'email', 'phone', 'linkedin',
  'company', 'website', 'domain', 'industry', 'country', 'city', 'headcount', 'campaignName',
  'senderFirstName', 'senderFullName', 'senderTitle', 'senderPhone', 'senderCalendarLink', 'senderSignatureName',
  'sdrName', 'sdrTitle',
  'greeting', 'dayOfWeek', 'nextWeekday', 'localTime',
  'ai.icebreaker', 'ai.painPoint', 'ai.valueProp', 'ai.companySummary', 'ai.whyNow', 'ai.personalLine',
] as const;

// ── Helpers and the text after `|` ──────────────────────────────────────────

const HELPERS: Record<string, (value: string) => string> = {
  lower: (v) => v.toLowerCase(),
  upper: (v) => v.toUpperCase(),
  capitalize: (v) => v.replace(/(^|\s)(\S)/g, (_m, space: string, ch: string) => space + ch.toUpperCase()),
  'first-word': (v) => v.split(/\s+/)[0] ?? '',
};
export const MERGE_HELPER_NAMES = Object.keys(HELPERS);

/**
 * The text after the first `|`: any leading helper names, then the fallback. `company|capitalize`
 * is a helper, `company|your company` a fallback, `company|upper|your company` both.
 */
export function parseTagTail(tail: string | undefined): { helpers: string[]; fallback: string } {
  if (tail === undefined) return { helpers: [], fallback: '' };
  const parts = tail.split('|');
  const helpers: string[] = [];
  while (parts.length > 0 && Object.prototype.hasOwnProperty.call(HELPERS, parts[0].trim().toLowerCase())) {
    helpers.push(parts.shift()!.trim().toLowerCase());
  }
  return { helpers, fallback: parts.join('|').trim() };
}

// ── Conditionals ───────────────────────────────────────────────────────────

type CondBranch = { field: string; then: CondNode[]; otherwise: CondNode[] };
type CondNode = string | CondBranch;
const COND_TOKEN_RE = /\{\{\s*(?:#if\s+([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)?)|(else)|(\/if))\s*\}\}/g;

function parseConditionals(text: string): CondNode[] | null {
  const root: CondNode[] = [];
  const stack: Array<{ node: CondBranch; inElse: boolean }> = [];
  const current = (): CondNode[] => {
    const top = stack[stack.length - 1];
    return top ? (top.inElse ? top.node.otherwise : top.node.then) : root;
  };
  let last = 0;
  for (const match of text.matchAll(COND_TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > last) current().push(text.slice(last, index));
    last = index + match[0].length;
    if (match[1]) {
      const node: CondBranch = { field: match[1], then: [], otherwise: [] };
      current().push(node);
      stack.push({ node, inElse: false });
    } else if (match[2]) {
      const top = stack[stack.length - 1];
      if (!top || top.inElse) return null;
      top.inElse = true;
    } else {
      if (stack.length === 0) return null;
      stack.pop();
    }
  }
  if (stack.length > 0) return null; // an {{#if}} never closed: leave the text as written
  if (last < text.length) root.push(text.slice(last));
  return root;
}

function renderCond(nodes: CondNode[], has: (field: string) => boolean): string {
  return nodes
    .map((n) => (typeof n === 'string' ? n : renderCond(has(n.field) ? n.then : n.otherwise, has)))
    .join('');
}

/** Own properties only: `constructor` or `__proto__` in a template must never reach the prototype chain. */
function hasValue(context: Readonly<Record<string, string>>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(context, field) && (context[field] ?? '').trim() !== '';
}

/** Keep the branch of each `{{#if field}}` the context selects. Malformed blocks are left as written. */
export function resolveConditionals(text: string, context: Readonly<Record<string, string>>): string {
  if (!text.includes('{{')) return text;
  const tree = parseConditionals(text);
  if (!tree) return text;
  return renderCond(tree, (field) => hasValue(context, field));
}

// ── Spintax ────────────────────────────────────────────────────────────────

const ZWSP = '​';

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Index just past a `{{...}}` unit that starts at `i`, or -1 when it never closes. */
function skipTag(s: string, i: number): number {
  const end = s.indexOf('}}', i + 2);
  return end === -1 ? -1 : end + 2;
}

/** Index of the `}` closing the single `{` at `open`, or -1. `{{...}}` units inside are skipped whole. */
function findSpinClose(s: string, open: number): number {
  let depth = 0;
  for (let j = open + 1; j < s.length; j++) {
    if (s[j] === '{' && s[j + 1] === '{') {
      const next = skipTag(s, j);
      if (next === -1) return -1;
      j = next - 1;
    } else if (s[j] === '{') depth++;
    else if (s[j] === '}') {
      if (depth === 0) return j;
      depth--;
    }
  }
  return -1;
}

function splitSpinOptions(inner: string): string[] {
  const options: string[] = [];
  let depth = 0;
  let start = 0;
  for (let j = 0; j < inner.length; j++) {
    if (inner[j] === '{' && inner[j + 1] === '{') {
      const next = skipTag(inner, j);
      if (next === -1) break;
      j = next - 1;
    } else if (inner[j] === '{') depth++;
    else if (inner[j] === '}') depth--;
    else if (inner[j] === '|' && depth === 0) {
      options.push(inner.slice(start, j));
      start = j + 1;
    }
  }
  options.push(inner.slice(start));
  return options;
}

/**
 * Replace each `{A|B|C}` by one option, chosen by a hash of the seed and the group's position, so the
 * same lead and template always read the same. A `{` with no `|` is ordinary text.
 */
export function resolveSpintax(text: string, seed: string): string {
  // The seed holds the whole template; hash it once, not once per group.
  const seedHash = fnv1a(seed);
  let counter = 0;
  const walk = (s: string): string => {
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (s[i] === '{' && s[i + 1] === '{') {
        const next = skipTag(s, i);
        if (next === -1) return out + s.slice(i);
        out += s.slice(i, next);
        i = next;
        continue;
      }
      if (s[i] === '{' && s[i + 1] !== ZWSP) {
        const close = findSpinClose(s, i);
        if (close !== -1) {
          const options = splitSpinOptions(s.slice(i + 1, close));
          if (options.length > 1) {
            const choice = fnv1a(`${seedHash}#${counter++}`) % options.length;
            out += walk(options[choice]);
            i = close + 1;
            continue;
          }
        }
      }
      out += s[i];
      i++;
    }
    return out;
  };
  return walk(text);
}

// ── Values ─────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A merge value goes in as data, never as markup, another merge field or spintax.
 *
 *  - In an HTML template the value is HTML-escaped: a company called `<img src=x onerror=...>`
 *    must arrive as text.
 *  - A zero-width space is put after every `{`. A body is rendered more than once on its way out
 *    (the route or sequence worker, then the email worker); without this a first name of
 *    `{{lastName}}` or `{a|b}` would be expanded by the second pass.
 *
 * The fallback text is written by the template's author and is left as written.
 */
function asMergeData(value: string, htmlTemplate: boolean): string {
  const safe = htmlTemplate ? escapeHtml(value) : value;
  return safe.replace(/\{/g, `{${ZWSP}`);
}

export function renderTemplate(text: string, lead: RenderLead, sdr?: RenderSdr, options: RenderOptions = {}): string {
  const ctx = buildMergeContext(lead, sdr, options);
  const htmlTemplate = isHtml(text);
  const branched = resolveConditionals(text, ctx);
  const spun = resolveSpintax(branched, `${lead.id ?? ''}|${text}`);
  return spun.replace(MERGE_FIELD_RE, (match, field: string, tail?: string) => {
    if (!Object.prototype.hasOwnProperty.call(ctx, field)) return match; // unknown field - leave visible so it gets noticed
    const { helpers, fallback } = parseTagTail(tail);
    const value = helpers.reduce((acc, name) => HELPERS[name](acc), ctx[field]);
    return value !== '' ? asMergeData(value, htmlTemplate) : fallback;
  });
}

/** A subject is one line: whatever the template or a value carried, no CR/LF reaches the header. */
export function renderSubject(text: string, lead: RenderLead, sdr?: RenderSdr, options: RenderOptions = {}): string {
  return renderTemplate(text.replace(/[\r\n]+/g, ' '), lead, sdr, options).replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
}
