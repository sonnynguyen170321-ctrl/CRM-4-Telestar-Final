/**
 * Deterministic fixture for the Playwright deep audit.
 *
 * Creates its own users, tenants, clients, campaigns and leads under a `PW_AUDIT` /
 * `@audit.test` namespace so the audit never depends on seeded demo rows and never reuses
 * `telestar2026`, which is published in this repository.
 *
 * Purely **additive and idempotent** — every write is an upsert and there is not a single
 * `deleteMany` here. That is deliberate: `prisma/seed-demo.ts` is destructive and guarded
 * accordingly, whereas this script has to be safe to re-run between batches.
 *
 * Two tenants exist so §9 (tenant isolation) has something to test. Two SDRs report to the
 * same team lead and share one campaign so §8 (IDOR) has a real pair: each owns a lead the
 * other must not be able to reach.
 *
 * Uses a bare `PrismaClient` on purpose. The extension in `lib/prisma.ts` resolves the tenant
 * from the session, and there is no session in a CLI script; passing `tenantId` explicitly is
 * both simpler and more honest about what is being written where.
 *
 * Usage:
 *   ALLOW_E2E_FIXTURE=1 E2E_PASSWORD='<strong>' node node_modules/tsx/dist/cli.mjs scripts/e2e-audit-fixture.ts
 *   ALLOW_E2E_FIXTURE=1 node node_modules/tsx/dist/cli.mjs scripts/e2e-audit-fixture.ts --prune
 */
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createAdminClient } from '@/lib/db/adminClient.mjs';

const prisma = createAdminClient();

export const TENANT_A = 'pw-audit-tenant-a';
export const TENANT_B = 'pw-audit-tenant-b';

/** Every fixture identity. `key` is what specs refer to; `email` is what signs in. */
const USERS = [
  { key: 'director', email: 'pw.director@audit.test', role: 'director', tenant: TENANT_A, manager: null },
  { key: 'floorManager', email: 'pw.fm@audit.test', role: 'floor_manager', tenant: TENANT_A, manager: 'director' },
  { key: 'teamLead', email: 'pw.tl@audit.test', role: 'team_lead', tenant: TENANT_A, manager: 'floorManager' },
  { key: 'sdrA', email: 'pw.sdr.a@audit.test', role: 'sdr', tenant: TENANT_A, manager: 'teamLead' },
  { key: 'sdrB', email: 'pw.sdr.b@audit.test', role: 'sdr', tenant: TENANT_A, manager: 'teamLead' },
  { key: 'leadgenManager', email: 'pw.lgm@audit.test', role: 'leadgen_manager', tenant: TENANT_A, manager: 'floorManager' },
  { key: 'leadgen', email: 'pw.lg@audit.test', role: 'leadgen', tenant: TENANT_A, manager: 'leadgenManager' },
  // Tenant B exists only to be unreachable from tenant A.
  { key: 'directorB', email: 'pw.director.b@audit.test', role: 'director', tenant: TENANT_B, manager: null },
  { key: 'sdrTenantB', email: 'pw.sdr.tb@audit.test', role: 'sdr', tenant: TENANT_B, manager: 'directorB' },
] as const;

type UserKey = (typeof USERS)[number]['key'];

function assertSafeTarget(): void {
  if (process.env.ALLOW_E2E_FIXTURE !== '1') {
    throw new Error('Refusing to run without ALLOW_E2E_FIXTURE=1.');
  }
  const url = process.env.DATABASE_URL ?? '';
  if (!url) throw new Error('DATABASE_URL is not set.');
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  // The fixture writes real rows. Restricting it to loopback is what keeps a mistyped
  // DATABASE_URL from creating audit users on a deployed database.
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to write fixture data to non-local host "${host}".`);
  }
}

/**
 * Delete disposable accounts left behind by individual specs.
 *
 * Several tests mint a throwaway user (sign-out, session revocation, work transfer, the
 * impact gate) because acting on a fixture role would invalidate its stored session or its
 * campaign membership. They deactivate it afterwards rather than deleting it, since a user
 * with audit rows, leads or tasks cannot simply be removed.
 *
 * That is correct per-test behaviour and untidy in aggregate: after a few dozen runs the
 * table carries a hundred-plus inactive `@audit.test` rows. Vitest shares this database and
 * several of its suites are already sensitive to what else is in it, so letting the residue
 * grow without limit eventually makes a documented flakiness worse.
 *
 * Deletion is attempted one row at a time and failures are counted, not thrown: a user still
 * referenced by an audit row or a lead *should* survive, and that is a foreign key doing its
 * job rather than an error. Fixture roles are never touched.
 */
async function prune(): Promise<void> {
  // `USERS` is `as const`, so its emails narrow to a literal union — widen to plain
  // strings or `has()` refuses any address that is not one of the nine fixture roles.
  const fixtureEmails = new Set<string>(USERS.map((u) => u.email as string));
  const candidates = await prisma.user.findMany({
    where: { email: { endsWith: '@audit.test' }, isActive: false },
    select: { id: true, email: true },
  });

  let deleted = 0;
  let retained = 0;
  for (const user of candidates) {
    if (fixtureEmails.has(user.email)) continue;
    try {
      await prisma.user.delete({ where: { id: user.id } });
      deleted++;
    } catch {
      retained++;
    }
  }
  console.log(`OK: pruned ${deleted} disposable users (${retained} still referenced, left alone)`);
}

async function main(): Promise<void> {
  assertSafeTarget();

  if (process.argv.includes('--prune')) {
    await prune();
    return;
  }

  const password = process.env.E2E_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('E2E_PASSWORD must be set and at least 12 characters.');
  }
  if (password === 'telestar2026') {
    throw new Error('E2E_PASSWORD must not be the published demo password.');
  }
  const passwordHash = await hash(password, 12);

  for (const id of [TENANT_A, TENANT_B]) {
    await prisma.tenant.upsert({
      where: { id },
      update: {},
      create: { id, name: `PW Audit ${id.endsWith('-a') ? 'A' : 'B'}` },
    });
  }

  // Two passes: create everyone first, then wire `managerId`, so a manager always exists
  // by the time someone points at it regardless of array order.
  const ids: Partial<Record<UserKey, string>> = {};
  for (const u of USERS) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      update: { password: passwordHash, role: u.role as never, isActive: true, tenantId: u.tenant },
      create: {
        email: u.email,
        password: passwordHash,
        firstName: 'PW',
        lastName: u.key,
        role: u.role as never,
        isActive: true,
        tenantId: u.tenant,
      },
      select: { id: true },
    });
    ids[u.key] = row.id;
  }
  for (const u of USERS) {
    if (!u.manager) continue;
    await prisma.user.update({
      where: { id: ids[u.key]! },
      data: { managerId: ids[u.manager as UserKey]! },
    });
  }

  const built: Record<string, unknown> = {};

  for (const [tenantId, suffix, ownerKeys] of [
    [TENANT_A, 'A', ['sdrA', 'sdrB'] as UserKey[]],
    [TENANT_B, 'B', ['sdrTenantB'] as UserKey[]],
  ] as const) {
    const client = await prisma.client.upsert({
      where: { id: `pw-audit-client-${suffix.toLowerCase()}` },
      update: {},
      create: {
        id: `pw-audit-client-${suffix.toLowerCase()}`,
        name: `PW_AUDIT_CLIENT_${suffix}`,
        industry: 'Testing',
        contactName: 'PW Audit',
        contactEmail: `client.${suffix.toLowerCase()}@audit.test`,
        tenantId,
      },
    });

    const campaign = await prisma.campaign.upsert({
      where: { id: `pw-audit-campaign-${suffix.toLowerCase()}` },
      update: {},
      create: {
        id: `pw-audit-campaign-${suffix.toLowerCase()}`,
        clientId: client.id,
        name: `PW_AUDIT_CAMPAIGN_${suffix}`,
        startDate: new Date('2026-01-01T00:00:00Z'),
        tenantId,
      },
    });

    // Campaign membership drives the account axis in `getLeadWhereScope`, so the leadgen
    // member and both SDRs must actually be members for the scoping tests to mean anything.
    const memberKeys: UserKey[] =
      tenantId === TENANT_A ? ['sdrA', 'sdrB', 'leadgen', 'teamLead'] : ['sdrTenantB'];
    for (const key of memberKeys) {
      await prisma.campaignSdr.upsert({
        where: { campaignId_userId: { campaignId: campaign.id, userId: ids[key]! } },
        update: {},
        create: { campaignId: campaign.id, userId: ids[key]!, tenantId },
      });
    }

    for (const ownerKey of ownerKeys) {
      const label = ownerKey.toUpperCase();
      await prisma.lead.upsert({
        where: { id: `pw-audit-lead-${ownerKey.toLowerCase()}` },
        update: { assignedToId: ids[ownerKey]!, campaignId: campaign.id },
        create: {
          id: `pw-audit-lead-${ownerKey.toLowerCase()}`,
          firstName: 'PW',
          lastName: label,
          company: `PW_AUDIT_CO_${label}`,
          email: `lead.${ownerKey.toLowerCase()}@audit.test`,
          normalizedEmail: `lead.${ownerKey.toLowerCase()}@audit.test`,
          assignedToId: ids[ownerKey]!,
          campaignId: campaign.id,
          tenantId,
        },
      });
    }

    // One email account per tenant, owned by that tenant's first SDR.
    //
    // Tenant B's exists specifically so PW-AUDIT-002 can be settled by experiment: the
    // automation cap route resolves the account's own tenant rather than the caller's, and
    // without a foreign account to aim at, that test can only skip. No credentials are set —
    // nothing here is ever asked to send.
    const accountOwner = ownerKeys[0]!;
    await prisma.emailAccount.upsert({
      where: { id: `pw-audit-mailbox-${suffix.toLowerCase()}` },
      update: {},
      create: {
        id: `pw-audit-mailbox-${suffix.toLowerCase()}`,
        userId: ids[accountOwner]!,
        email: `mailbox.${suffix.toLowerCase()}@audit.test`,
        provider: 'imap_smtp',
        isActive: true,
        tenantId,
      },
    });

    built[`client${suffix}`] = client.id;
    built[`campaign${suffix}`] = campaign.id;
    built[`mailbox${suffix}`] = `pw-audit-mailbox-${suffix.toLowerCase()}`;
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    tenants: { a: TENANT_A, b: TENANT_B },
    users: Object.fromEntries(
      USERS.map((u) => [u.key, { id: ids[u.key], email: u.email, role: u.role, tenantId: u.tenant }])
    ),
    leads: {
      sdrA: 'pw-audit-lead-sdra',
      sdrB: 'pw-audit-lead-sdrb',
      tenantB: 'pw-audit-lead-sdrtenantb',
    },
    ...built,
  };

  const out = path.join(process.cwd(), 'e2e', '.fixture.json');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`OK: fixture written to ${path.relative(process.cwd(), out)}`);
  console.log(`OK: ${USERS.length} users across 2 tenants`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('FAIL:', err instanceof Error ? err.message : err);
    await prisma.$disconnect();
    process.exit(1);
  });
