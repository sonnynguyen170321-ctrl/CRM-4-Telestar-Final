import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Google will not publish the OAuth app without a public privacy policy and terms link, so these
 * two pages must load with no session — and opening them must not open anything next to them.
 */
describe('the proxy exemption for the legal pages', () => {
  const matcher = readFileSync(join(process.cwd(), 'proxy.ts'), 'utf8').match(/'\/\(\(\?!([^)]*)\)\.\*\)'/)?.[1] ?? '';
  const exempt = (path: string) => new RegExp(`^/(?!${matcher}).*`).test(path) === false;

  it('serves /privacy and /terms without a session', () => {
    expect(exempt('/privacy')).toBe(true);
    expect(exempt('/terms')).toBe(true);
  });

  it('does not exempt lookalikes or anything beneath them', () => {
    expect(exempt('/privacy-settings')).toBe(false);
    expect(exempt('/privacy/export')).toBe(false);
    expect(exempt('/terms/admin')).toBe(false);
    expect(exempt('/termsheet')).toBe(false);
    expect(exempt('/leads')).toBe(false);
  });
});

describe('the legal pages', () => {
  const page = (name: string) => readFileSync(join(process.cwd(), 'app', name, 'page.tsx'), 'utf8');

  it('carry the Google API Limited Use statement', () => {
    expect(page('privacy')).toContain('Google API Services User Data Policy');
    expect(page('privacy')).toContain('Limited Use requirements');
  });

  it('read no session and no data', () => {
    for (const name of ['privacy', 'terms']) {
      expect(page(name)).not.toMatch(/prisma|getServerSession|requireAuth|auth\(\)|fetch\(/);
    }
  });
});
