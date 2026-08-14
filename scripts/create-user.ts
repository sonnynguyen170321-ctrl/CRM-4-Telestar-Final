/**
 * Create or update a non-Director user on a deployed box.
 *
 * This is the tool for rotating or deactivating the demo accounts. `create-admin` is not:
 * it hardcodes `role: 'director'`, so pointing it at an SDR rotates the password *and*
 * promotes the account. Use this script, which only writes the fields you pass.
 *
 * Usage:
 *   npm run create-user -- --email sdr@telestar.vn --password 'strong-pass' --role sdr
 *   npm run create-user -- --email sdr@telestar.vn --deactivate
 */
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';

const raw = new PrismaClient();
const roles = ['director', 'floor_manager', 'team_lead', 'sdr', 'leadgen_manager', 'leadgen'] as const;
type Role = (typeof roles)[number];

const MIN_PASSWORD_LENGTH = 8;

export interface UpsertUserInput {
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: Role;
  /** Explicit activation state. `undefined` leaves an existing account as it is. */
  isActive?: boolean;
  tenantId?: string;
}

export interface UpsertUserResult {
  outcome: 'created' | 'updated';
  /** True when the write revoked existing sessions by moving `authVersion`. */
  sessionsRevoked: boolean;
}

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

const hasFlag = (flag: string): boolean => process.argv.includes(flag);

const usage = () => {
  console.error(
    "Usage: npm run create-user -- --email user@domain.com [--password 'password'] " +
      "[--first-name 'First'] [--last-name 'Last'] [--role sdr] [--activate | --deactivate]"
  );
};

/**
 * Create or update a user, exported so the `authVersion` guarantee below can be tested.
 *
 * Sessions here are stateless JWTs revalidated against `User.authVersion`. Any change that
 * is supposed to cut off access — a password rotation, a demotion, a deactivation — has to
 * move that column, or the old tokens keep working until they expire. That is precisely the
 * bug this script is reached for: rotating the published `telestar2026` off the demo
 * accounts. Mirrors `scripts/create-admin.ts` and `app/api/settings/password`.
 */
export async function upsertUser(input: UpsertUserInput): Promise<UpsertUserResult> {
  const email = input.email.trim().toLowerCase();
  const tenantId = input.tenantId ?? 'default-tenant';

  await raw.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: { id: tenantId, name: 'Default Tenant' },
  });

  return tenantStorage.run({ tenantId, bypassRls: true }, async () => {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (!existing) {
      if (!input.password || !input.firstName || !input.lastName || !input.role) {
        throw new Error('Creating a user requires --password, --first-name, --last-name, and --role');
      }
      await prisma.user.create({
        data: {
          email,
          password: await hash(input.password, 12),
          firstName: input.firstName,
          lastName: input.lastName,
          role: input.role,
          isActive: input.isActive ?? true,
        },
      });
      return { outcome: 'created', sessionsRevoked: false };
    }

    const data: Record<string, unknown> = {};
    if (input.password) data.password = await hash(input.password, 12);
    if (input.firstName) data.firstName = input.firstName;
    if (input.lastName) data.lastName = input.lastName;
    if (input.role) data.role = input.role;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    if (Object.keys(data).length === 0) {
      throw new Error(
        'No changes requested. Pass --password, --role, --first-name, --last-name, --activate or --deactivate.'
      );
    }

    // Only the fields that govern access revoke sessions. Renaming someone should not sign
    // them out; changing their password, their role or their active state must.
    const revokes =
      Boolean(input.password) ||
      (input.role !== undefined && input.role !== existing.role) ||
      (input.isActive !== undefined && input.isActive !== existing.isActive);

    if (revokes) data.authVersion = { increment: 1 };

    await prisma.user.update({ where: { email }, data: data as never });
    return { outcome: 'updated', sessionsRevoked: revokes };
  });
}

async function main() {
  const email = (arg('--email') ?? '').trim().toLowerCase();
  const password = arg('--password');
  const firstName = (arg('--first-name') ?? '').trim();
  const lastName = (arg('--last-name') ?? '').trim();
  const role = arg('--role') as Role | undefined;
  const activate = hasFlag('--activate') || hasFlag('--active');
  const deactivate = hasFlag('--deactivate');

  if (!email) {
    usage();
    throw new Error('--email is required');
  }
  if (activate && deactivate) {
    throw new Error('Pass either --activate or --deactivate, not both.');
  }
  if (role && !roles.includes(role)) {
    throw new Error(`Invalid role "${role}". Supported roles: ${roles.join(', ')}`);
  }
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  let isActive: boolean | undefined;
  if (activate) isActive = true;
  if (deactivate) isActive = false;

  const result = await upsertUser({
    email,
    password,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    role,
    isActive,
  });

  if (result.outcome === 'created') {
    console.log(`OK: created ${email} (${role})`);
    return;
  }

  console.log(`OK: updated ${email}`);
  if (password) console.log('OK: password reset');
  if (role) console.log(`OK: role set to ${role}`);
  if (activate) console.log('OK: user activated');
  if (deactivate) console.log('OK: user deactivated');
  console.log(
    result.sessionsRevoked
      ? 'OK: existing sessions revoked (authVersion incremented)'
      : 'NOTE: sessions left intact — no access-governing field changed'
  );
}

// Only run as a CLI. Importing this module — the tests do — must not write a user.
if ((process.argv[1] ?? '').includes('create-user')) {
  main()
    .then(async () => {
      await (prisma as unknown as { $disconnect?: () => Promise<void> }).$disconnect?.();
      await raw.$disconnect();
    })
    .catch(async (err) => {
      console.error('FAIL:', err instanceof Error ? err.message : err);
      await (prisma as unknown as { $disconnect?: () => Promise<void> }).$disconnect?.();
      await raw.$disconnect();
      process.exit(1);
    });
}
