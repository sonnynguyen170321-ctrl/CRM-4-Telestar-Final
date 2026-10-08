import { describe, expect, it } from 'vitest';

import { isParkedText } from '../fetchWebsite';

describe('isParkedText', () => {
  it('recognises a parked-domain page', () => {
    expect(isParkedText('This domain is for sale. Buy this domain today!')).toBe(true);
  });

  it('does not flag a real company page', () => {
    expect(isParkedText('We maintain, repair and overhaul aircraft engines.')).toBe(false);
  });
});
