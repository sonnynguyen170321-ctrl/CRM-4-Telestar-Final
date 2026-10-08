import { describe, expect, it } from 'vitest';

import { isParkedText } from '../fetchWebsite';

describe('isParkedText', () => {
  it('recognises a parked-domain page', () => {
    expect(isParkedText('This domain is for sale. Buy this domain today!')).toBe(true);
  });

  it('does not flag a real company page', () => {
    expect(isParkedText('We maintain, repair and overhaul aircraft engines.')).toBe(false);
  });

  it("does not treat a long registrar or broker page as parked", () => {
    const broker = `Domain for sale marketplace. ${"Browse thousands of premium names, compare prices and make an offer. ".repeat(60)}`;
    expect(isParkedText(broker)).toBe(false);
  });

  it("does not treat 'related searches' alone as parked", () => {
    expect(isParkedText("Related searches: aircraft maintenance providers, MRO software, airline engineering")).toBe(false);
  });
});
