/**
 * Create (or promote) the first production admin — a Director account.
 *
 * Production must NOT run `npm run db:seed`: that wipes data and creates demo users with
 * a shared password. Use this instead, once, after `prisma migrate deploy`.
 *
 * Usage:
 *   npm run create-admin -- --email you@co.com --password 'strong-pass' --name 'Your Name'
 *   # or via env:
 *   ADMIN_EMAIL=you@co.com ADMIN_PASSWORD='strong-pass' ADMIN_NAME='Your Name' npm run create-admin
 */
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';

const raw = new PrismaClient();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

/**
 * Create or promote a Director, exported so the `authVersion` guarantee below can be tested.
 * Returns what happened, so a caller can tell a promotion from a fresh account.
 */
export async function upsertDirector(input: {
  email: string;
  password: string;
  name?: string;
  tenantId?: string;
}): Promise<'created' | 'updated'> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hash(input.password, 12);
  const [firstName, ...rest] = (input.name ?? 'Admin').trim().split(' ');
  const tenantId = input.tenantId ?? 'default-tenant';

  await raw.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: { id: tenantId, name: 'Default Tenant' },
  });

  return tenantStorage.run({ tenantId, bypassRls: true }, async () => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.update({
        where: { email },
        // `authVersion` must move with the password. Sessions are stateless JWTs, so without
        // this the old password stops working while every token minted under it keeps full
        // access until it expires — exactly backwards for the case this script is used in:
        // rotating a credential that is known or published. Matches what
        // `app/api/settings/password` does for a self-service change.
        data: {
          password: passwordHash,
          role: 'director',
          isActive: true,
          authVersion: { increment: 1 },
        },
      });
      return 'updated';
    }

    await prisma.user.create({
      data: {
        email,
        password: passwordHash,
        firstName: firstName || 'Admin',
        lastName: rest.join(' '),
        role: 'director',
      },
    });
    return 'created';
  });
}

async function main() {
  const email = (arg('--email') ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = arg('--password') ?? process.env.ADMIN_PASSWORD ?? '';
  const name = (arg('--name') ?? process.env.ADMIN_NAME ?? 'Admin').trim();

  if (!email || !password) {
    console.error('Missing required input.');
    console.error("Usage: npm run create-admin -- --email <email> --password <password> [--name 'Full Name']");
    console.error('   or set ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME in the environment.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const outcome = await upsertDirector({ email, password, name });
  console.log(
    outcome === 'updated'
      ? `✓ Updated ${email} → director (password reset, account active, existing sessions revoked).`
      : `✓ Created director ${email}.`
  );
}

// Only run as a CLI. Importing this module — the tests do — must not create an admin.
if ((process.argv[1] ?? '').includes('create-admin')) {
  main()
    .then(() => raw.$disconnect())
    .catch(async (err) => {
      console.error('create-admin failed:', err);
      await raw.$disconnect();
      process.exit(1);
    });
}
