import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TEL-P2-026: PostgreSQL application roles must be least-privilege.
 *
 * An application role requires neither CREATEROLE nor CREATEDB.
 * Every role provisioning and verification script must enforce NOCREATEROLE and NOCREATEDB.
 */
describe('database role least privilege rules', () => {
  const ROLE_FILES = [
    join('supabase', 'roles.sql'),
    join('scripts', 'verify-rls.mjs'),
    join('scripts', 'verify-rls-enablement.mjs'),
    join('scripts', 'verify-rls-app-paths.mjs'),
  ];

  it.each(ROLE_FILES)('%s explicitly declares NOCREATEROLE and NOCREATEDB for application roles', (file) => {
    if (!existsSync(file)) return;
    const source = readFileSync(join(process.cwd(), file), 'utf8');

    expect(source).toContain('NOCREATEROLE');
    expect(source).toContain('NOCREATEDB');
  });

  it('every role definition in supabase/roles.sql explicitly uses NOSUPERUSER, NOCREATEROLE, NOCREATEDB', () => {
    const rolesSql = readFileSync(join(process.cwd(), 'supabase', 'roles.sql'), 'utf8');
    const createRoleLines = rolesSql.split('\n').filter((l) => l.includes('CREATE ROLE'));

    expect(createRoleLines.length).toBeGreaterThanOrEqual(3);
    for (const line of createRoleLines) {
      expect(line).toContain('NOSUPERUSER');
      expect(line).toContain('NOCREATEROLE');
      expect(line).toContain('NOCREATEDB');
    }
  });
});
