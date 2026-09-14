import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { safeHttpUrl } from '@/lib/security/safeHref';

describe('safeHttpUrl', () => {
  it.each([
    ['https://linkedin.com/in/linh', 'https://linkedin.com/in/linh'],
    ['http://example.com/x', 'http://example.com/x'],
    ['linkedin.com/in/linh', 'https://linkedin.com/in/linh'],
    ['  www.linkedin.com/in/linh  ', 'https://www.linkedin.com/in/linh'],
    ['//linkedin.com/in/linh', 'https://linkedin.com/in/linh'],
    ['HTTPS://LinkedIn.com/in/Linh', 'https://linkedin.com/in/Linh'],
  ])('accepts %s → %s', (input, expected) => {
    expect(safeHttpUrl(input)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:fetch("/api/developer/keys")',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    'file:///etc/passwd',
    'mailto:x@y.z',
    '',
    '   ',
    'https://',
    'not a url at all',
  ])('refuses %s', (input) => {
    expect(safeHttpUrl(input)).toBeNull();
  });

  it('refuses null and undefined', () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});

describe('every stored-URL href goes through safeHttpUrl', () => {
  // The three sites that rendered user-supplied URLs raw. A structural pin, because the
  // dangerous shape reads as ordinary JSX and review has already missed it three times.
  const SITES = [
    'components/leadgen-manager/PoolBrowser.tsx',
    'app/leads/page.tsx',
    'components/meetings/BookingLinkSettingsPanel.tsx',
    'components/LeadDetailPanel.tsx',
  ];
  for (const file of SITES) {
    it(`${file} has no raw linkedIn/url href`, () => {
      const src = readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(src).not.toMatch(/href=\{(item|lead|link)\.(linkedIn|url)\}/);
      expect(src).not.toMatch(/startsWith\('http'\)\s*\?\s*\w+\.linkedIn/);
      expect(src).toMatch(/safeHttpUrl\(/);
    });
  }
});
