/**
 * Typed access to the audit fixture written by `scripts/e2e-audit-fixture.ts`.
 *
 * Specs must never hardcode an id or an email. Reading them from the manifest is what lets
 * the fixture be re-created between batches without touching a single spec, and it is what
 * keeps the audit off seeded demo rows entirely.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type RoleKey =
  | 'director'
  | 'floorManager'
  | 'teamLead'
  | 'sdrA'
  | 'sdrB'
  | 'leadgenManager'
  | 'leadgen'
  | 'directorB'
  | 'sdrTenantB';

export type FixtureUser = {
  id: string;
  email: string;
  role: string;
  tenantId: string;
};

export type Fixture = {
  generatedAt: string;
  tenants: { a: string; b: string };
  users: Record<RoleKey, FixtureUser>;
  leads: { sdrA: string; sdrB: string; tenantB: string };
  clientA: string;
  clientB: string;
  campaignA: string;
  campaignB: string;
  mailboxA: string;
  mailboxB: string;
};

const MANIFEST = path.join(process.cwd(), 'e2e', '.fixture.json');

let cached: Fixture | null = null;

export function fixture(): Fixture {
  if (cached) return cached;
  try {
    cached = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Fixture;
  } catch {
    throw new Error(
      `Audit fixture missing at ${MANIFEST}. Create it first:\n` +
        `  ALLOW_E2E_FIXTURE=1 E2E_PASSWORD='…' node node_modules/tsx/dist/cli.mjs scripts/e2e-audit-fixture.ts`
    );
  }
  return cached;
}

/**
 * The fixture password. Deliberately has no default: a default would silently fall back to
 * something, and the one thing everybody would fall back to is the published demo password.
 */
export function fixturePassword(): string {
  const pw = process.env.E2E_PASSWORD;
  if (!pw) throw new Error('E2E_PASSWORD is not set.');
  if (pw === 'telestar2026') {
    throw new Error('E2E_PASSWORD is the published demo password. Use a run-scoped value.');
  }
  return pw;
}

/** Where a role's signed-in browser state lives. One file per role — never shared. */
export function storageStatePath(role: RoleKey): string {
  return path.join(process.cwd(), 'playwright', '.auth', `${role}.json`);
}
