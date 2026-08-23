import { describe, it, expect } from 'vitest';
import { checkRlsContract } from '@/lib/env-contract';

/**
 * `DB_RLS_ENFORCED=true` without `CRM_MAINTENANCE_URL` is a silent outage, and this codebase
 * has now produced that exact shape four separate times:
 *
 *   - every client report share link read as "invalid or expired"
 *   - 25 raw SQL statements touched zero rows, including the email quota reserve, which
 *     stops outbound with no error anywhere
 *   - 22 operational tools reported clean, empty, wrong answers
 *   - the policies became role-targeted, so `app.bypass_rls` grants the application role
 *     nothing at all and every cross-tenant path needs a different connection
 *
 * None of those raise. An empty result is not an error, which is what makes the class so
 * expensive to find — the previous three were each found by measuring, not by a failing test.
 * So the fourth is a startup check instead of a line in a runbook.
 */
describe('the RLS enablement contract', () => {
  it('is satisfied when RLS is not enforced — every deployment today', () => {
    // The check must be completely inert until someone turns RLS on, or it becomes a startup
    // failure for people who never asked for any of this.
    expect(checkRlsContract({}).ok).toBe(true);
    expect(checkRlsContract({ DB_RLS_ENFORCED: 'false' }).ok).toBe(true);
    expect(checkRlsContract({ DATABASE_URL: 'postgresql://x/y' }).ok).toBe(true);
  });

  it('rejects enforcement without a maintenance connection', () => {
    const result = checkRlsContract({ DB_RLS_ENFORCED: 'true' });
    expect(result.ok).toBe(false);
    expect(result.enforced).toBe(true);
    expect(result.maintenanceConfigured).toBe(false);
    // The message has to name the variable and say what breaks, because the symptom it
    // prevents is silence — there will be nothing else to go on.
    expect(result.reason).toContain('CRM_MAINTENANCE_URL');
    expect(result.reason).toMatch(/zero rows/i);
  });

  it('is satisfied when both are configured', () => {
    const result = checkRlsContract({
      DB_RLS_ENFORCED: 'true',
      CRM_MAINTENANCE_URL: 'postgresql://crm_maintenance:pw@localhost:5432/crm',
    });
    expect(result.ok).toBe(true);
    expect(result.maintenanceConfigured).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('treats a blank maintenance URL as absent', () => {
    // An empty value is what a half-filled .env produces, and it would otherwise read as
    // configured — the failure would then land at the first cross-tenant query instead of
    // at startup, which is the whole thing this exists to avoid.
    for (const blank of ['', '   ']) {
      const result = checkRlsContract({ DB_RLS_ENFORCED: 'true', CRM_MAINTENANCE_URL: blank });
      expect(result.ok, `blank value ${JSON.stringify(blank)} must not count`).toBe(false);
    }
  });

  it('only treats the exact string "true" as enforcement', () => {
    // Matches how DB_RLS_ENFORCED is read in lib/prisma.ts. A value of "1" or "yes" does not
    // enable RLS there, so it must not trip the contract here either — the two must agree or
    // the check fires when nothing is enforced.
    for (const value of ['1', 'yes', 'TRUE ', 'enabled']) {
      const result = checkRlsContract({ DB_RLS_ENFORCED: value });
      expect(result.enforced, `${JSON.stringify(value)} should not read as enforced`).toBe(
        value.trim().toLowerCase() === 'true'
      );
    }
  });
});
