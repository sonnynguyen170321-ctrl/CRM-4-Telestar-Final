// Soft-404 / thin-page detector. The crawler already drops hard 404s (HTTP >= 400), but a
// `/hiring` or `/careers` page that returns HTTP 200 with a "page not found" body — or a page
// whose only content is nav/footer boilerplate — still reaches fact extraction and produces
// false signals ("hiring", random insights). This gate excludes those pages BEFORE extraction
// so nothing is derived from a dead page. Pure; deterministic; no network.

export type PageQualityInput = {
  title?: string | null;
  h1?: string | null;
  mainText: string;
};

// Phrases that, when they dominate a page, mean it's an error / empty / not-found shell.
const SOFT_404_PATTERNS: RegExp[] = [
  /\bpage not found\b/i,
  /\b404\b[^0-9]/i,
  // NOTE: a bare "not found" is intentionally NOT here — it flags legit content (e.g. a blog
  // titled "Solving not found errors"). Only specific error-shell phrasing counts.
  /\b(page|content) (?:you(?:'re| are) looking for )?(?:doesn'?t|does not|no longer) exist/i,
  /\bno longer (?:available|exists)\b/i,
  /\bthis page (?:isn'?t|is not) available\b/i,
  /\b(?:oops|sorry)[!,. ].{0,40}\b(?:not found|doesn'?t exist|can'?t find|couldn'?t find)/i,
  /\bwe (?:can'?t|could ?n'?t) find (?:the|that) page\b/i,
  /\berror 404\b/i,
];

// A real content page carries more than a nav bar + footer. Below this the page is treated as
// thin (no usable evidence). Tuned low so genuine short pages (e.g. a lean about page) survive.
const MIN_CONTENT_CHARS = 160;

export function isLowQualityPage(input: PageQualityInput): boolean {
  const main = (input.mainText ?? "").trim();

  // Thin: not enough real content to extract anything trustworthy.
  if (main.length < MIN_CONTENT_CHARS) return true;

  // Soft-404: an error/not-found shell returning HTTP 200. Require the not-found phrasing in the
  // heading (title/h1) or the leading body text AND a short overall body — a real 404 shell is
  // short, whereas a long article that merely mentions "not found" in passing is genuine content.
  const heading = `${input.title ?? ""} ${input.h1 ?? ""}`.trim();
  const lead = main.slice(0, 400);
  const hasNotFoundPhrasing =
    (heading.length > 0 && SOFT_404_PATTERNS.some((pattern) => pattern.test(heading))) ||
    SOFT_404_PATTERNS.some((pattern) => pattern.test(lead));
  if (hasNotFoundPhrasing && main.length < 600) return true;

  return false;
}
