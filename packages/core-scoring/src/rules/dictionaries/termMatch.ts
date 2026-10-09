// Shared term matching for the reference dictionaries (seniority, industry) and the industry dimension.
//
// Two defects this replaces (taxonomy research, 2026-10-10):
//   - Substring matching. "isp" fired inside "display", "dispute" and "disposal"; "media" inside
//     "intermediation"; "it services" inside "transit services"; "hospital" inside "hospitality".
//     Every one of those is a real LinkedIn industry label that canonicalised to the wrong key.
//   - No accent folding. A title typed "Giam doc" or "Geschaftsfuhrer" never met the dictionary's
//     "giám đốc" / "geschäftsführer", and "đ", "ł", "ø" do not decompose under NFD at all.
//
// Boundaries are Unicode letter/number edges, and only on the sides where the term itself starts or
// ends with a letter or number — so "e-commerce", "f&b" and "ex-" still match where they should.
// Scripts written without spaces between words (Chinese, Japanese, Thai, Lao, Khmer, Myanmar), and
// Korean, whose titles compound without spaces ("영업부장"), have no word edges to find, so a term in
// those scripts matches as a plain substring. Pure.

// Characters NFD leaves intact that still need a Latin base letter for comparison.
const EXTRA_FOLDS: Readonly<Record<string, string>> = {
  "đ": "d",
  "ð": "d",
  "ł": "l",
  "ø": "o",
  "æ": "ae",
  "œ": "oe",
  "ß": "ss",
  "ı": "i",
};

/** Lowercase, NFC, accent-stripped, whitespace-collapsed. "Giám Đốc" and "giam doc" fold the same. */
export function foldForMatch(value: string): string {
  return String(value ?? "")
    .normalize("NFC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[đðłøæœßı]/g, (ch) => EXTRA_FOLDS[ch] ?? ch)
    .replace(/\s+/g, " ")
    .trim();
}

const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

export type TermMatchOptions = {
  /** Also accept a trailing "s" / "es" ("bank" matches "banks"). For industry nouns, not titles. */
  plural?: boolean;
  /** The term must open the text (after leading punctuation): "former" in "Former CEO", not "CEO, former VP". */
  atStart?: boolean;
};

const matcherCache = new Map<string, RegExp>();

function matcherFor(foldedTerm: string, options: TermMatchOptions): RegExp {
  const key = `${options.plural ? "p" : ""}${options.atStart ? "s" : ""}|${foldedTerm}`;
  const cached = matcherCache.get(key);
  if (cached) return cached;

  const escaped = foldedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = foldedTerm.charAt(0);
  const last = foldedTerm.charAt(foldedTerm.length - 1);
  const before = options.atStart ? "^[^\\p{L}\\p{N}]*" : WORD_CHAR.test(first) ? "(?<![\\p{L}\\p{N}])" : "";
  const suffix = options.plural && /\p{L}/u.test(last) ? "(?:e?s)?" : "";
  const after = WORD_CHAR.test(last) ? "(?![\\p{L}\\p{N}])" : "";
  const re = new RegExp(`${before}${escaped}${suffix}${after}`, "u");
  matcherCache.set(key, re);
  return re;
}

/**
 * True when `term` appears in `text` as a whole word (or phrase). Both sides are folded here, so
 * callers may pass raw strings. An empty term never matches.
 */
export function containsTerm(text: string, term: string, options: TermMatchOptions = {}): boolean {
  return containsFoldedTerm(foldForMatch(text), foldForMatch(term), options);
}

/** `containsTerm` for callers that fold once and test many terms (both arguments already folded). */
export function containsFoldedTerm(foldedText: string, foldedTerm: string, options: TermMatchOptions = {}): boolean {
  if (!foldedTerm || !foldedText) return false;
  if (UNSPACED_SCRIPT.test(foldedTerm) && !options.atStart) return foldedText.includes(foldedTerm);
  return matcherFor(foldedTerm, options).test(foldedText);
}
