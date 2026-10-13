/**
 * AI on the draft: what the composer's rewrite actions are, and the guard that keeps a rewrite from
 * breaking the template.
 *
 * A draft carries syntax the renderer fills in per lead: `{{firstName|there}}`, `{{ai.icebreaker}}`,
 * spintax `{Hi|Hello}`, `{{#if title}}...{{/if}}` blocks, and images (sometimes a large inline data
 * URI). A model asked to "make it friendlier" is free to translate `{{firstName}}`, merge two spintax
 * options, or drop the block it does not understand, and the email would then go out to every lead
 * with a gap or with literal braces in it. So the model never sees them:
 *
 *  1. `protectTokens` replaces each one by a numbered placeholder (`[[T1]]`, `[[T2]]`, ...). A
 *     conditional block goes whole, its text included: what it says depends on the lead, and a
 *     rewrite cannot know which branch a reader sees.
 *  2. `validateRewrite` refuses an answer that dropped, repeated or invented a placeholder, wrote
 *     template syntax of its own, or carries a link the draft did not have; otherwise it puts the
 *     original tokens back exactly as written.
 *
 * Pure, client and server.
 */
import { isHtml } from '@/lib/email/sanitize';
import { plainTextToHtml } from './html';

export const REWRITE_ACTIONS = [
  { id: 'shorten', label: 'Shorten' },
  { id: 'friendlier', label: 'Make friendlier' },
  { id: 'formal', label: 'Make more formal' },
  { id: 'grammar', label: 'Fix grammar and spelling' },
  { id: 'translate_vi', label: 'Translate to Vietnamese' },
  { id: 'translate_en', label: 'Translate to English' },
  { id: 'custom', label: 'Rewrite with my instruction' },
] as const;

export type RewriteActionId = (typeof REWRITE_ACTIONS)[number]['id'];
export const REWRITE_ACTION_IDS = REWRITE_ACTIONS.map((a) => a.id) as [RewriteActionId, ...RewriteActionId[]];

/** The draft as sent, images included. */
export const MAX_REWRITE_INPUT_CHARS = 60_000;
/** What the model is given once tokens and images are placeholders: about 1,500 words. */
export const MAX_REWRITE_TEXT_CHARS = 10_000;
export const MAX_REWRITE_INSTRUCTION_CHARS = 300;

export interface ProtectedText {
  masked: string;
  /** The original text of placeholder `[[T{i+1}]]`. */
  tokens: string[];
}

const placeholder = (index: number) => `[[T${index + 1}]]`;
const PLACEHOLDER_RE = /\[\[T(\d+)\]\]/g;

/** End of the `{{...}}` tag starting at `i` (index after `}}`), or -1 when it never closes. */
function tagEnd(text: string, i: number): number {
  const close = text.indexOf('}}', i + 2);
  return close === -1 ? -1 : close + 2;
}

/** End of the `{{#if}}` block starting at `i`, following nested blocks, or -1 when it never closes. */
function conditionalEnd(text: string, i: number): number {
  const re = /\{\{\s*(#if\b[^}]*|\/if\s*)\}\}/g;
  re.lastIndex = i;
  let depth = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    depth += m[1].startsWith('#') ? 1 : -1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/**
 * End of the spintax group starting at `i` (a single `{` with a `|` at its own level), or -1 when
 * the brace is ordinary text. `{{...}}` inside it is skipped whole.
 */
function spintaxEnd(text: string, i: number): number {
  let depth = 0;
  let hasOption = false;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '{' && text[j + 1] === '{') {
      const next = tagEnd(text, j);
      if (next === -1) return -1;
      j = next - 1;
    } else if (text[j] === '{') depth++;
    else if (text[j] === '}') {
      depth--;
      if (depth === 0) return hasOption ? j + 1 : -1;
    } else if (text[j] === '|' && depth === 1) hasOption = true;
  }
  return -1;
}

/** The length of the token that starts at `i`, or 0 when ordinary text starts there. */
function tokenAt(text: string, i: number): number {
  const rest = text.slice(i, i + 8);
  if (/^<img\b/i.test(rest)) {
    const close = text.indexOf('>', i);
    return close === -1 ? 0 : close + 1 - i;
  }
  if (rest.startsWith('[[T')) {
    const m = /^\[\[T\d+\]\]/.exec(text.slice(i, i + 16));
    return m ? m[0].length : 0;
  }
  if (rest.startsWith('{{')) {
    const end = /^\{\{\s*#if\b/.test(text.slice(i, i + 12)) ? conditionalEnd(text, i) : -1;
    const whole = end !== -1 ? end : tagEnd(text, i);
    return whole === -1 ? 0 : whole - i;
  }
  if (rest.startsWith('{')) {
    const end = spintaxEnd(text, i);
    return end === -1 ? 0 : end - i;
  }
  return 0;
}

/** Replace every template token, image and placeholder-shaped text with a numbered placeholder. */
export function protectTokens(text: string): ProtectedText {
  const tokens: string[] = [];
  let masked = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const length = ch === '<' || ch === '{' || ch === '[' ? tokenAt(text, i) : 0;
    if (length > 0) {
      masked += placeholder(tokens.length);
      tokens.push(text.slice(i, i + length));
      i += length;
    } else {
      masked += ch;
      i++;
    }
  }
  return { masked, tokens };
}

export type RewriteRefusal = 'dropped' | 'duplicated' | 'invented' | 'added_syntax' | 'link_changed' | 'variables_changed';
export type RestoreResult = { ok: true; text: string } | { ok: false; reason: RewriteRefusal; message: string };

const braces = (text: string) => (text.match(/[{}]/g) ?? []).length;
const preview = (tokens: string[]) => {
  const shown = tokens.slice(0, 3).map((t) => (t.length > 40 ? `${t.slice(0, 37)}...` : t));
  return `${shown.join(', ')}${tokens.length > 3 ? ` and ${tokens.length - 3} more` : ''}`;
};

/** Put the original tokens back, refusing an answer that lost, repeated or made up any of them. */
export function restoreTokens(output: string, original: ProtectedText): RestoreResult {
  const seen = new Map<number, number>();
  for (const m of output.matchAll(PLACEHOLDER_RE)) {
    const index = Number(m[1]) - 1;
    seen.set(index, (seen.get(index) ?? 0) + 1);
  }
  if ([...seen.keys()].some((index) => index < 0 || index >= original.tokens.length)) {
    return { ok: false, reason: 'invented', message: 'The rewrite added template content that was not in your draft. Nothing was changed.' };
  }
  const dropped = original.tokens.filter((_, index) => !seen.has(index));
  if (dropped.length > 0) {
    return {
      ok: false,
      reason: 'dropped',
      message: `The rewrite lost ${preview(dropped)} from your draft, so it was not used. Try again or edit by hand.`,
    };
  }
  const repeated = original.tokens.filter((_, index) => (seen.get(index) ?? 0) > 1);
  if (repeated.length > 0) {
    return { ok: false, reason: 'duplicated', message: `The rewrite repeated ${preview(repeated)}, so it was not used. Try again.` };
  }
  if (braces(output) > braces(original.masked)) {
    return {
      ok: false,
      reason: 'added_syntax',
      message: 'The rewrite added variables or spintax of its own, so it was not used. Insert variables yourself with {{.',
    };
  }
  return { ok: true, text: output.replace(PLACEHOLDER_RE, (_whole, n: string) => original.tokens[Number(n) - 1]) };
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1].trim());
}

/**
 * The checks a rewrite passes before the rep sees it: tokens intact (see `restoreTokens`), and no
 * link the draft did not already have. Dropping a link is allowed (a shorter email may lose one);
 * adding or changing one is not, since a model could otherwise route a prospect anywhere.
 */
export function validateRewrite(input: string, original: ProtectedText, output: string): RestoreResult {
  const restored = restoreTokens(output, original);
  if (!restored.ok) return restored;
  const allowed = new Set(hrefs(input));
  if (hrefs(restored.text).some((href) => !allowed.has(href))) {
    return { ok: false, reason: 'link_changed', message: 'The rewrite added or changed a link, so it was not used. Try again.' };
  }
  return restored;
}

/** Every merge tag, conditional tag and spintax group in `text`, as written: what must survive a rewrite. */
export function templateTokens(text: string): string[] {
  const out: string[] = [];
  const walk = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '{' && s[i + 1] === '{') {
        const end = tagEnd(s, i);
        if (end === -1) return;
        out.push(s.slice(i, end));
        i = end - 1;
      } else if (s[i] === '{') {
        const end = spintaxEnd(s, i);
        if (end !== -1) {
          out.push(s.slice(i, end));
          i = end - 1;
        }
      }
    }
  };
  walk(text);
  return out;
}

/** Same tokens, same number of times, in any order. */
export function sameTemplateTokens(a: string, b: string): boolean {
  const x = templateTokens(a).sort();
  const y = templateTokens(b).sort();
  return x.length === y.length && x.every((token, i) => token === y[i]);
}

/** The rewrite added under the draft rather than replacing it. */
export function insertBelow(body: string, addition: string): string {
  if (!body.trim()) return addition;
  if (isHtml(body)) return `${body}${isHtml(addition) ? addition : plainTextToHtml(addition)}`;
  return `${body.replace(/\s+$/, '')}\n\n${addition}`;
}
