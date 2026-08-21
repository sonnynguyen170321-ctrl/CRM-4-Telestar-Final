import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { deriveIsManager } from '@/lib/authRoles';

/**
 * TEL-P0-005 — an API key authenticated as a manager regardless of who created it.
 *
 * `getSessionUser()` has two authentication paths. The session path derived `isManager` from
 * the database; the API-key path set `isManager: true` unconditionally. `requireManager()`
 * accepts anyone carrying `isManager`, and `POST /api/developer/keys` is gated only by
 * `requireAuth()` — so any authenticated user, including an SDR, could mint a key and reach
 * manager-only endpoints with it.
 *
 * The invariant, from the directive that found it:
 *
 *     API_KEY_PERMISSION <= CURRENT_USER_PERMISSION
 */

const NON_MANAGER_ROLES = ['sdr', 'leadgen', 'leadgen_manager'] as const;
const MANAGER_ROLES = ['director', 'floor_manager', 'team_lead'] as const;

describe('deriveIsManager', () => {
  it.each(MANAGER_ROLES)('is true for the manager role %s even with no reports', (role) => {
    expect(deriveIsManager(role, 0)).toBe(true);
  });

  it.each(NON_MANAGER_ROLES)('is false for %s with no reports', (role) => {
    expect(deriveIsManager(role, 0)).toBe(false);
  });

  it.each(NON_MANAGER_ROLES)('is true for %s who actually has active reports', (role) => {
    // An individual contributor with reports genuinely manages people. That was always the
    // intent of the session path, and the fix must preserve it rather than flattening
    // everything to role alone.
    expect(deriveIsManager(role, 1)).toBe(true);
  });

  it('does not treat a negative or absent report count as managerial', () => {
    expect(deriveIsManager('sdr', 0)).toBe(false);
    expect(deriveIsManager('sdr', -1)).toBe(false);
  });

  it('leadgen_manager is not a CRM manager despite the name', () => {
    // requireManager() checks director / floor_manager / team_lead. leadgen_manager manages the
    // leadgen pool, which is a different authority; it must not inherit CRM manager endpoints
    // through isManager unless it actually has reports.
    expect(deriveIsManager('leadgen_manager', 0)).toBe(false);
  });
});

describe('the API-key path derives authority instead of asserting it', () => {
  const auth = readFileSync(join(process.cwd(), 'lib', 'auth.ts'), 'utf8');

  it('no longer hardcodes isManager: true anywhere', () => {
    // This single literal was the whole defect.
    expect(auth).not.toMatch(/isManager:\s*true/);
  });

  it('both authentication paths call the same derivation', () => {
    const calls = auth.match(/isManager:\s*deriveIsManager\(/g) ?? [];
    expect(calls.length).toBe(2);
  });

  it('the API key query selects the report count it needs to derive from', () => {
    // Without this select the derivation cannot be computed and would have to guess again.
    const apiKeyBlock = auth.slice(auth.indexOf('prisma.apiKey.findUnique'), auth.indexOf('// 2. Fall back'));
    expect(apiKeyBlock).toContain('_count');
    expect(apiKeyBlock).toContain('reports');
  });

  it('still refuses a key whose creator is deactivated', () => {
    // Pre-existing guard; the fix must not have displaced it.
    expect(auth).toContain('apiKey.createdBy.isActive');
  });

  it('still refuses an inactive or expired key', () => {
    expect(auth).toMatch(/apiKey\.isActive/);
    expect(auth).toMatch(/expiresAt/);
  });
});

describe('requireManager remains the gate the escalation targeted', () => {
  const auth = readFileSync(join(process.cwd(), 'lib', 'auth.ts'), 'utf8');

  it('still accepts isManager, which is why the derivation has to be honest', () => {
    // The fix is deliberately in the derivation rather than in requireManager: an IC with
    // reports is a legitimate manager, so removing the isManager check would break them.
    const fn = auth.slice(auth.indexOf('export async function requireManager'));
    expect(fn).toContain('!user.isManager');
  });
});
