import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalizeIndustry } from '@telestar/core-scoring/rules/dictionaries/industry';

import {
  MAX_CHIPS,
  MAX_CHIP_LENGTH,
  addChips,
  chipKeyAction,
  filterSuggestions,
  moveHighlight,
  removeChip,
  removeLastChip,
  splitChips,
} from '@/lib/icp/chips';
import { COUNTRY_SUGGESTIONS, INDUSTRY_SUGGESTIONS } from '@/lib/icp/suggestions';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('splitChips', () => {
  it('splits commas, semicolons, newlines and tabs', () => {
    expect(splitChips('a, b; c\nd\te')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps spaces inside a value, so a title can be typed as words', () => {
    expect(splitChips('Head of Sales,  VP   Marketing ')).toEqual(['Head of Sales', 'VP Marketing']);
  });

  it('drops empty pieces and whitespace-only input', () => {
    expect(splitChips(',, ;\n  ,')).toEqual([]);
    expect(splitChips('')).toEqual([]);
    expect(splitChips('   ')).toEqual([]);
  });

  it('caps one value at the maximum length', () => {
    expect(splitChips('x'.repeat(MAX_CHIP_LENGTH + 50))[0]).toHaveLength(MAX_CHIP_LENGTH);
  });

  it('keeps Vietnamese and emoji text intact', () => {
    expect(splitChips('Giám đốc, Trưởng phòng; 🚀 Founder')).toEqual(['Giám đốc', 'Trưởng phòng', '🚀 Founder']);
  });
});

describe('addChips', () => {
  it('adds several pasted values at once, after the existing ones', () => {
    expect(addChips(['CEO'], 'CTO, COO; CFO')).toEqual(['CEO', 'CTO', 'COO', 'CFO']);
  });

  it('ignores duplicates in any casing, keeping the first spelling', () => {
    expect(addChips(['CEO'], 'ceo, Ceo, CTO, cto')).toEqual(['CEO', 'CTO']);
  });

  it('returns an equal list for blank input and does not mutate the original', () => {
    const current = ['CEO'];
    const next = addChips(current, '  ,  ');
    expect(next).toEqual(['CEO']);
    addChips(current, 'CTO');
    expect(current).toEqual(['CEO']);
  });

  it('stops at the list cap', () => {
    const many = Array.from({ length: MAX_CHIPS + 20 }, (_, index) => `v${index}`).join(',');
    expect(addChips([], many)).toHaveLength(MAX_CHIPS);
  });

  it('handles a large paste quickly', () => {
    const big = Array.from({ length: 10_000 }, (_, index) => `title ${index}`).join(', ');
    const started = Date.now();
    expect(addChips([], big)).toHaveLength(MAX_CHIPS);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('removing chips', () => {
  it('removes one value regardless of casing', () => {
    expect(removeChip(['CEO', 'CTO'], 'ceo')).toEqual(['CTO']);
  });

  it('removes the last chip, and is safe on an empty list', () => {
    expect(removeLastChip(['a', 'b'])).toEqual(['a']);
    expect(removeLastChip([])).toEqual([]);
  });
});

describe('filterSuggestions', () => {
  const all = ['Vietnam', 'Singapore', 'United States', 'United Kingdom', 'Austria'];

  it('puts prefix matches before other substring matches', () => {
    expect(filterSuggestions(all, 'ia', [])).toEqual(['Austria']);
    expect(filterSuggestions(all, 'un', [])).toEqual(['United States', 'United Kingdom']);
    expect(filterSuggestions(all, 's', [])[0]).toBe('Singapore');
  });

  it('ignores case and accents', () => {
    expect(filterSuggestions(['Việt Nam'], 'viet', [])).toEqual(['Việt Nam']);
    expect(filterSuggestions(all, 'VIET', [])).toEqual(['Vietnam']);
  });

  it('does not offer what is already chosen, or anything for an empty query', () => {
    expect(filterSuggestions(all, 'vietnam', ['vietnam'])).toEqual([]);
    expect(filterSuggestions(all, '  ', [])).toEqual([]);
  });

  it('respects the limit', () => {
    expect(filterSuggestions(all, 'i', [], 2)).toHaveLength(2);
  });
});

describe('moveHighlight', () => {
  it('wraps in both directions and starts from the ends', () => {
    expect(moveHighlight(-1, 3, 1)).toBe(0);
    expect(moveHighlight(-1, 3, -1)).toBe(2);
    expect(moveHighlight(2, 3, 1)).toBe(0);
    expect(moveHighlight(0, 3, -1)).toBe(2);
  });

  it('returns none when there is nothing to move through', () => {
    expect(moveHighlight(0, 0, 1)).toBe(-1);
  });
});

describe('chipKeyAction', () => {
  const base = { draft: '', highlighted: -1, suggestionCount: 0 };

  it('Enter, comma and Tab commit what was typed', () => {
    for (const key of ['Enter', ',', 'Tab']) {
      expect(chipKeyAction({ ...base, key, draft: 'Head of Sales' })).toEqual({ type: 'commit-draft' });
    }
  });

  it('leaves Enter and Tab alone on an empty box, so focus and forms behave normally', () => {
    expect(chipKeyAction({ ...base, key: 'Enter' })).toEqual({ type: 'none' });
    expect(chipKeyAction({ ...base, key: 'Tab' })).toEqual({ type: 'none' });
    expect(chipKeyAction({ ...base, key: ',' })).toEqual({ type: 'none' });
  });

  it('Backspace removes the last chip only when the box is empty', () => {
    expect(chipKeyAction({ ...base, key: 'Backspace' })).toEqual({ type: 'remove-last' });
    expect(chipKeyAction({ ...base, key: 'Backspace', draft: 'CE' })).toEqual({ type: 'none' });
  });

  it('takes the highlighted suggestion with Enter or Tab', () => {
    const state = { ...base, draft: 'vi', highlighted: 1, suggestionCount: 3 };
    expect(chipKeyAction({ ...state, key: 'Enter' })).toEqual({ type: 'commit-suggestion' });
    expect(chipKeyAction({ ...state, key: 'Tab' })).toEqual({ type: 'commit-suggestion' });
  });

  it('commits the typed text when suggestions are open but none is highlighted', () => {
    expect(chipKeyAction({ ...base, key: 'Enter', draft: 'Narnia', suggestionCount: 3 })).toEqual({ type: 'commit-draft' });
  });

  it('moves with the arrows only while suggestions exist, and Escape closes them', () => {
    expect(chipKeyAction({ ...base, key: 'ArrowDown', suggestionCount: 2 })).toEqual({ type: 'move', direction: 1 });
    expect(chipKeyAction({ ...base, key: 'ArrowUp', suggestionCount: 2 })).toEqual({ type: 'move', direction: -1 });
    expect(chipKeyAction({ ...base, key: 'ArrowDown' })).toEqual({ type: 'none' });
    expect(chipKeyAction({ ...base, key: 'Escape', suggestionCount: 2 })).toEqual({ type: 'close' });
  });

  it('does nothing while an IME is composing (Vietnamese input)', () => {
    expect(chipKeyAction({ ...base, key: 'Enter', draft: 'gia', composing: true })).toEqual({ type: 'none' });
  });
});

describe('suggestion vocabularies', () => {
  it('offers countries, once each', () => {
    expect(COUNTRY_SUGGESTIONS.length).toBeGreaterThan(50);
    expect(new Set(COUNTRY_SUGGESTIONS).size).toBe(COUNTRY_SUGGESTIONS.length);
    expect(COUNTRY_SUGGESTIONS).toContain('Vietnam');
  });

  it('offers only industry labels that score as the industry they name', () => {
    expect(INDUSTRY_SUGGESTIONS.length).toBeGreaterThan(10);
    for (const label of INDUSTRY_SUGGESTIONS) expect(canonicalizeIndustry(label)).not.toBeNull();
  });
});

describe('the ICP editors use the chip input for every list field', () => {
  const ruleEditor = source('components/icp/IcpRuleEditor.tsx');
  const points = source('components/automation/ScoringPointsEditor.tsx');

  it('has no comma-joined text box left in the rule form', () => {
    expect(ruleEditor).not.toContain(".join(', ')");
    for (const label of [
      'Target countries',
      'Excluded countries',
      'Target industries',
      'Excluded industries',
      'Accepted buyer titles',
      'Excluded buyer titles',
    ]) {
      expect(ruleEditor).toContain(`<ChipInput label="${label}"`);
    }
  });

  it('uses chips for the per-value points rows too', () => {
    expect(points).toContain('<ChipInput');
    expect(points).not.toContain(".join(', ')");
  });

  it('keeps the value a plain list and labels the combobox and its listbox', () => {
    const chip = source('components/icp/ChipInput.tsx');
    expect(chip).toContain('role="combobox"');
    expect(chip).toContain('role="listbox"');
    expect(chip).toContain('role="option"');
    expect(chip).toContain('aria-label={`Remove ${chip} from ${label}`}');
  });
});
