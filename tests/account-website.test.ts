import { describe, expect, it } from 'vitest';
import { accountWebsite } from '@/lib/leads/accountWebsite';

describe('accountWebsite', () => {
  it('prefers website, then domain, then canonicalDomain', () => {
    expect(accountWebsite({ website: 'https://www.acme.com/en', domain: 'x.com', canonicalDomain: 'y.com' })).toEqual({ href: 'https://www.acme.com/en', label: 'acme.com' });
    expect(accountWebsite({ website: null, domain: 'x.com', canonicalDomain: 'y.com' })?.href).toBe('https://x.com/');
    expect(accountWebsite({ website: ' ', domain: null, canonicalDomain: 'y.com' })?.label).toBe('y.com');
  });

  it('skips an unsafe value for the next candidate and returns null when none is usable', () => {
    expect(accountWebsite({ website: 'javascript:alert(1)', domain: 'x.com' })?.href).toBe('https://x.com/');
    expect(accountWebsite({ website: 'javascript:alert(1)' })).toBeNull();
    expect(accountWebsite(null)).toBeNull();
    expect(accountWebsite({})).toBeNull();
  });
});
