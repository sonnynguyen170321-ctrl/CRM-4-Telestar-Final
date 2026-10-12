/**
 * The parsing and commit rules behind the ICP list fields (`components/icp/ChipInput.tsx`).
 *
 * A list field holds `string[]`. The rep types freely, spaces included, and a chip is made when they
 * press Enter, a comma or Tab, or paste several values at once. Pure functions, so the rules are
 * tested without a browser.
 */

/** Characters that end one value and start the next when typed or pasted. */
const SEPARATORS = /[,;\n\r\t]+/;

/** Hard cap on one list, so a pasted spreadsheet column cannot bloat a rule set. */
export const MAX_CHIPS = 200;

/** Longest single value kept. */
export const MAX_CHIP_LENGTH = 120;

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** "a, b; c\nd" becomes ["a", "b", "c", "d"]. Inner spaces are kept ("Head of Sales"), edges trimmed. */
export function splitChips(raw: string): string[] {
  return raw
    .split(SEPARATORS)
    .map((part) => part.replace(/\s+/g, ' ').trim().slice(0, MAX_CHIP_LENGTH))
    .filter(Boolean);
}

/** Add every value found in `raw`, skipping ones already present (case-insensitive). Never mutates. */
export function addChips(current: readonly string[], raw: string): string[] {
  const seen = new Set(current.map((item) => item.toLowerCase()));
  const next = [...current];
  for (const part of splitChips(raw)) {
    const key = part.toLowerCase();
    if (seen.has(key) || next.length >= MAX_CHIPS) continue;
    seen.add(key);
    next.push(part);
  }
  return next;
}

/** Remove one value (case-insensitive). */
export function removeChip(current: readonly string[], value: string): string[] {
  const key = value.toLowerCase();
  return current.filter((item) => item.toLowerCase() !== key);
}

/** Drop the last chip: Backspace in an empty box. */
export function removeLastChip(current: readonly string[]): string[] {
  return current.slice(0, -1);
}

/**
 * Suggestions for what has been typed: prefix matches first, then other substring matches, ignoring
 * case and accents, never offering something already chosen.
 */
export function filterSuggestions(
  all: readonly string[],
  query: string,
  chosen: readonly string[],
  limit = 8,
): string[] {
  const needle = fold(query).trim();
  if (!needle) return [];
  const taken = new Set(chosen.map((item) => item.toLowerCase()));
  const prefix: string[] = [];
  const inner: string[] = [];
  for (const option of all) {
    if (taken.has(option.toLowerCase())) continue;
    const folded = fold(option);
    if (folded.startsWith(needle)) prefix.push(option);
    else if (folded.includes(needle)) inner.push(option);
  }
  return [...prefix, ...inner].slice(0, limit);
}

/** Move the highlighted suggestion, wrapping at both ends. `-1` means none is highlighted. */
export function moveHighlight(index: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return -1;
  if (index < 0) return direction === 1 ? 0 : count - 1;
  return (index + direction + count) % count;
}

export type ChipKeyAction =
  | { type: 'commit-draft' }
  | { type: 'commit-suggestion' }
  | { type: 'remove-last' }
  | { type: 'move'; direction: 1 | -1 }
  | { type: 'close' }
  | { type: 'none' };

/**
 * What a key press does. `none` leaves the browser's default alone, so Tab on an empty box still
 * moves focus and Enter on an empty box still submits nothing special.
 */
export function chipKeyAction(input: {
  key: string;
  draft: string;
  highlighted: number;
  suggestionCount: number;
  /** True while an IME is composing (Vietnamese Telex etc.): Enter then belongs to the IME. */
  composing?: boolean;
}): ChipKeyAction {
  const { key, draft, highlighted, suggestionCount, composing } = input;
  if (composing) return { type: 'none' };
  const hasDraft = draft.trim().length > 0;
  switch (key) {
    case 'Enter':
      if (highlighted >= 0 && highlighted < suggestionCount) return { type: 'commit-suggestion' };
      return hasDraft ? { type: 'commit-draft' } : { type: 'none' };
    case ',':
    case ';':
      return hasDraft ? { type: 'commit-draft' } : { type: 'none' };
    case 'Tab':
      if (highlighted >= 0 && highlighted < suggestionCount) return { type: 'commit-suggestion' };
      return hasDraft ? { type: 'commit-draft' } : { type: 'none' };
    case 'Backspace':
      return draft === '' ? { type: 'remove-last' } : { type: 'none' };
    case 'ArrowDown':
      return suggestionCount > 0 ? { type: 'move', direction: 1 } : { type: 'none' };
    case 'ArrowUp':
      return suggestionCount > 0 ? { type: 'move', direction: -1 } : { type: 'none' };
    case 'Escape':
      return suggestionCount > 0 ? { type: 'close' } : { type: 'none' };
    default:
      return { type: 'none' };
  }
}
