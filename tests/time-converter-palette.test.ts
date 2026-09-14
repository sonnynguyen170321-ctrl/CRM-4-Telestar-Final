import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The "Convert time" command is wired to something.
 *
 * The palette's previous quick action ("Launch Cloud Dialer") dispatched a custom event nothing
 * listened for and did nothing when pressed. This pins the opposite shape: the entry flips
 * state in the palette, and the palette renders the overlay from that state.
 */
describe('Convert time in the command palette', () => {
  const src = readFileSync('components/CommandPalette.tsx', 'utf8');

  it('has an entry that opens the converter from local state, not an event', () => {
    expect(src).toMatch(/id: 'act_time'[\s\S]*setShowTimeConverter\(true\)/);
    expect(src).not.toMatch(/dispatchEvent\(new CustomEvent\('telestar:open-time/);
  });

  it('renders the converter when that state is set', () => {
    expect(src).toMatch(/\{showTimeConverter && <TimeConverter onClose=/);
  });

  it('claims no keyboard shortcut it does not implement', () => {
    // Shortcuts in this palette are labels only; ⌘T would also collide with the browser's new tab.
    const entry = src.match(/\{ id: 'act_time'[^\n]*\}/)?.[0] ?? '';
    expect(entry).not.toContain('shortcut:');
  });
});
