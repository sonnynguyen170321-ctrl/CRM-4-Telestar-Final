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

/**
 * Lowercase, NFC, accent-stripped, whitespace-collapsed, typographic apostrophes made plain.
 * "Giám Đốc" and "giam doc" fold the same; so do "CEO’s" and "CEO's".
 */
export function foldForMatch(value: string): string {
  return String(value ?? "")
    .normalize("NFC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[đðłøæœßı]/g, (ch) => EXTRA_FOLDS[ch] ?? ch)
    .replace(/[‘’ʼ]/g, "'")
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
  /**
   * For words an operator types into an ICP: when the term's last word has 4+ letters it also matches
   * a text word that STARTS with it ("tech" -> "technology", "health" -> "healthcare", "educat" ->
   * "educational"), and a final "e" is optional so "finance" reaches "financial". Shorter terms stay
   * whole words (plural allowed): "AI" never matches "email" or "airline", "isp" never "display",
   * "bet" never "alphabet". Never mid-word: "tech" is not found in "biotech".
   */
  prefix?: boolean;
};

const PREFIX_MIN_LETTERS = 4;

const matcherCache = new Map<string, RegExp>();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matcherFor(foldedTerm: string, options: TermMatchOptions): RegExp {
  const key = `${options.plural ? "p" : ""}${options.atStart ? "s" : ""}${options.prefix ? "x" : ""}|${foldedTerm}`;
  const cached = matcherCache.get(key);
  if (cached) return cached;

  const first = foldedTerm.charAt(0);
  const last = foldedTerm.charAt(foldedTerm.length - 1);
  const before = options.atStart ? "^[^\\p{L}\\p{N}]*" : WORD_CHAR.test(first) ? "(?<![\\p{L}\\p{N}])" : "";
  const lastWord = /\p{L}+$/u.exec(foldedTerm)?.[0] ?? "";
  let body: string;
  if (options.prefix && lastWord.length >= PREFIX_MIN_LETTERS) {
    // Word-start prefix; a final "e" is optional once the word is longer than the minimum.
    const stem = lastWord.length > PREFIX_MIN_LETTERS && foldedTerm.endsWith("e") ? foldedTerm.slice(0, -1) : foldedTerm;
    body = `${escapeRegExp(stem)}\\p{L}*`;
  } else {
    const suffix = (options.plural || options.prefix) && /\p{L}/u.test(last) ? "(?:e?s)?" : "";
    const after = WORD_CHAR.test(last) ? "(?![\\p{L}\\p{N}])" : "";
    body = `${escapeRegExp(foldedTerm)}${suffix}${after}`;
  }
  const re = new RegExp(`${before}${body}`, "u");
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

/** Remove every whole-word occurrence of `foldedTerm` from `foldedText` (both already folded). */
export function stripFoldedTerm(foldedText: string, foldedTerm: string): string {
  if (!foldedTerm || !foldedText) return foldedText;
  if (UNSPACED_SCRIPT.test(foldedTerm)) return foldedText.split(foldedTerm).join(" ").replace(/\s+/g, " ").trim();
  const re = new RegExp(matcherFor(foldedTerm, {}).source, "gu");
  return foldedText.replace(re, " ").replace(/\s+/g, " ").trim();
}
