import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * No route stores a plaintext OAuth token beside its ciphertext.
 *
 * The OAuth upsert (lib/email/oauthAccounts.ts) and the adapters' token-refresh hooks null the
 * plaintext columns and keep only encAccessToken / encRefreshToken, and EmailService reads the
 * encrypted column first. app/api/email/accounts still wrote the raw token alongside the
 * encrypted one, which made the encryption decorative for that row.
 */
const ROOT = process.cwd();

describe('email account token storage', () => {
  it('app/api/email/accounts writes accessToken/refreshToken as null', () => {
    const src = readFileSync(path.join(ROOT, 'app/api/email/accounts/route.ts'), 'utf8');
    expect(src).toMatch(/accessToken:\s*null,\s*\n\s*refreshToken:\s*null,/);
    expect(src).not.toMatch(/accessToken:\s*rawAccessToken/);
  });

  it('the OAuth upsert keeps nulling the plaintext columns', () => {
    const src = readFileSync(path.join(ROOT, 'lib/email/oauthAccounts.ts'), 'utf8');
    expect(src).toMatch(/accessToken:\s*null/);
    expect(src).toMatch(/encAccessToken/);
  });
});
