import { describe, it, expect } from 'vitest';
import {
  assertDestructiveSeedAllowed,
  describeSeedTarget,
  looksLikeCloudSql,
  parsePostgresUrl,
  resolveDemoPassword,
  SeedGuardError,
  DESTRUCTIVE_SEED_CONFIRMATION,
} from '@/lib/seed-guard';

/**
 * The demo seed deletes every tenant and user with no filter and no prompt. These tests are
 * the thing standing between a mistyped DATABASE_URL and an empty production database, so
 * they assert refusal on each condition independently rather than trusting one catch-all.
 */

const LOCAL = 'postgresql://postgres:postgres@localhost:5432/telestar_crm_dev';
const ok = (over: Partial<Parameters<typeof assertDestructiveSeedAllowed>[0]> = {}) => ({
  nodeEnv: 'development',
  databaseUrl: LOCAL,
  confirmation: DESTRUCTIVE_SEED_CONFIRMATION,
  ...over,
});

describe('assertDestructiveSeedAllowed — the happy path', () => {
  it('allows a local development database with the confirmation set', () => {
    const target = assertDestructiveSeedAllowed(ok());
    expect(target).toEqual({ host: 'localhost', database: 'telestar_crm_dev', nodeEnv: 'development' });
  });

  it('accepts each approved database-name marker', () => {
    for (const name of ['crm_dev', 'crm_development', 'crm_test', 'local_crm', 'TELESTAR_TEST']) {
      const url = `postgresql://postgres:postgres@127.0.0.1:5432/${name}`;
      expect(() => assertDestructiveSeedAllowed(ok({ databaseUrl: url })), name).not.toThrow();
    }
  });
});

describe('assertDestructiveSeedAllowed — refusals', () => {
  it('refuses without the confirmation variable', () => {
    expect(() => assertDestructiveSeedAllowed(ok({ confirmation: undefined }))).toThrow(SeedGuardError);
    expect(() => assertDestructiveSeedAllowed(ok({ confirmation: undefined }))).toThrow(
      /I_UNDERSTAND_THIS_DELETES_ALL_DATA/
    );
  });

  it('refuses a confirmation that is close but not exact', () => {
    expect(() => assertDestructiveSeedAllowed(ok({ confirmation: 'yes' }))).toThrow(SeedGuardError);
    expect(() =>
      assertDestructiveSeedAllowed(ok({ confirmation: 'i_understand_this_deletes_all_data' }))
    ).toThrow(SeedGuardError);
  });

  it('refuses when NODE_ENV is production, even with the confirmation set', () => {
    expect(() => assertDestructiveSeedAllowed(ok({ nodeEnv: 'production' }))).toThrow(/production/);
    // and points the operator at the non-destructive path
    expect(() => assertDestructiveSeedAllowed(ok({ nodeEnv: 'production' }))).toThrow(/create-admin/);
  });

  it('refuses a Cloud SQL target over TCP', () => {
    const url = 'postgresql://crm:pw@10.20.30.40:5432/telestar_crm_dev?host=/cloudsql/proj:asia:inst';
    expect(() => assertDestructiveSeedAllowed(ok({ databaseUrl: url }))).toThrow(/managed database/);
  });

  it('refuses other managed providers by hostname', () => {
    for (const host of [
      'db.abcdef.supabase.co',
      'ep-cool-name-123.ap-southeast-1.aws.neon.tech',
      'crm.abcdefgh.ap-southeast-1.rds.amazonaws.com',
    ]) {
      const url = `postgresql://u:p@${host}:5432/telestar_crm_dev`;
      expect(() => assertDestructiveSeedAllowed(ok({ databaseUrl: url })), host).toThrow(SeedGuardError);
    }
  });

  it('refuses any non-local hostname', () => {
    const url = 'postgresql://u:p@192.0.2.10:5432/telestar_crm_dev';
    expect(() => assertDestructiveSeedAllowed(ok({ databaseUrl: url }))).toThrow(/not local/);
  });

  it('refuses a database name that is not clearly disposable', () => {
    const url = 'postgresql://postgres:postgres@localhost:5432/telestar_crm';
    expect(() => assertDestructiveSeedAllowed(ok({ databaseUrl: url }))).toThrow(/does not contain/);
  });

  it('refuses when DATABASE_URL is missing or unparseable', () => {
    expect(() => assertDestructiveSeedAllowed(ok({ databaseUrl: undefined }))).toThrow(/not set/);
    expect(() => assertDestructiveSeedAllowed(ok({ databaseUrl: 'not-a-url' }))).toThrow(/could not be parsed/);
  });

  it('refuses production before it even considers the confirmation', () => {
    // Ordering matters: a production operator who supplies the magic string must still be
    // refused, and must be told why in terms of the environment rather than the token.
    const err = (() => {
      try {
        assertDestructiveSeedAllowed(ok({ nodeEnv: 'production' }));
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err?.message).toMatch(/production/);
    expect(err?.message).not.toMatch(/Re-run with/);
  });
});

describe('parsePostgresUrl', () => {
  it('reads host and database from a normal DSN', () => {
    expect(parsePostgresUrl(LOCAL)).toEqual({ host: 'localhost', database: 'telestar_crm_dev' });
  });

  it('prefers the socket host when the authority is empty', () => {
    const url = 'postgresql:///telestar_crm?host=/cloudsql/proj:region:inst';
    expect(parsePostgresUrl(url)).toEqual({ host: '/cloudsql/proj:region:inst', database: 'telestar_crm' });
  });

  it('returns nulls instead of throwing on garbage', () => {
    expect(parsePostgresUrl('nonsense')).toEqual({ host: null, database: null });
  });
});

describe('looksLikeCloudSql', () => {
  it('detects the socket path and managed hostnames', () => {
    expect(looksLikeCloudSql('postgresql:///db?host=/cloudsql/p:r:i')).toBe(true);
    expect(looksLikeCloudSql('postgresql://u:p@x.supabase.co:5432/db')).toBe(true);
    expect(looksLikeCloudSql('postgresql://u:p@localhost:5432/db')).toBe(false);
  });
});

describe('describeSeedTarget', () => {
  it('names the environment, host and database so the target is never a surprise', () => {
    const banner = describeSeedTarget({ host: 'localhost', database: 'crm_dev', nodeEnv: 'development' });
    expect(banner).toContain('localhost');
    expect(banner).toContain('crm_dev');
    expect(banner).toContain('development');
    expect(banner).toMatch(/deletes every tenant/i);
  });
});

describe('resolveDemoPassword', () => {
  it('allows default password in development or test mode', () => {
    const pass = resolveDemoPassword(undefined, 'development');
    expect(pass).toBe('TelestarDemo!2026');
  });

  it('allows custom password in development', () => {
    const pass = resolveDemoPassword('CustomDevPass123!', 'development');
    expect(pass).toBe('CustomDevPass123!');
  });

  it('rejects missing password in production', () => {
    expect(() => resolveDemoPassword(undefined, 'production')).toThrow(SeedGuardError);
    expect(() => resolveDemoPassword('', 'production')).toThrow(/DEMO_PASSWORD environment variable is required/);
  });

  it('rejects public default password in production', () => {
    expect(() => resolveDemoPassword('TelestarDemo!2026', 'production')).toThrow(
      /known public default/
    );
  });

  it('rejects passwords shorter than 12 characters in production', () => {
    expect(() => resolveDemoPassword('short123', 'production')).toThrow(/at least 12 characters/);
  });

  it('accepts strong secret password in production', () => {
    const pass = resolveDemoPassword('SuperSecretDemoPassword2026!#', 'production');
    expect(pass).toBe('SuperSecretDemoPassword2026!#');
  });
});
