/**
 * Provision the internal roster into a NON-PRODUCTION database.
 *
 * This utility used to be capable of destroying the instance it ran against, and of
 * publishing the credentials it set. Three properties are load-bearing now, and each
 * has a regression test in `tests/restore-internal-users.test.ts`:
 *
 * 1. **It refuses any target that is not local.** The check is an allowlist of local
 *    hosts, not a denylist of production ones: an unrecognised remote host is refused
 *    rather than having to be enumerated first. Provisioning the production roster is
 *    the safe cutover tool's job (`scripts/cutover/safe-cutover-tool.ts`), which is
 *    manifest-driven, hashed, and fails closed on an unmet precondition.
 *
 * 2. **It deletes nothing.** The previous step 4 selected deletion candidates with
 *    `{ email: { notIn: allowedEmails } }` and **no `tenantId` predicate**, on the RLS
 *    bypass client — so it matched, and deleted, every user of every other tenant on
 *    the instance. Reassignment ran through `try { … } catch {}` helpers, so a failed
 *    foreign-key move was discarded and the delete proceeded anyway. Removing users is
 *    now exclusively the cutover manifest's decision (TEL-P0-010).
 *
 * 3. **No account shares a password, and no password is ever printed.** Every account
 *    gets its own 32-byte random secret. They are written to an operator-nominated file
 *    outside this repository — required, never defaulted — and nothing reaches stdout
 *    (TEL-P0-009).
 *
 * Every write happens in one transaction, so an injected mid-run failure rolls the whole
 * thing back rather than leaving a half-provisioned roster nobody knows about.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { hash } from 'bcryptjs';

import approvedRoster from './cutover/approved-roster.json';
import { getDatabaseFingerprint } from './cutover/safe-cutover-tool';

export const TENANT_ID = 'default-tenant';

/**
 * Hosts this script accepts. An allowlist rather than a denylist: the failure mode of a
 * forgotten denylist entry is destroying the wrong database, and the failure mode of a
 * forgotten allowlist entry is a refusal the operator can read.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal', 'postgres']);

export function isLocalFingerprint(fingerprint: string): boolean {
  const host = fingerprint.split(':')[0];
  return LOCAL_HOSTS.has(host);
}

/** Throws unless the connected database is local. Called before anything opens a write. */
export function assertLocalTarget(fingerprint: string): void {
  if (fingerprint === 'unknown-database') {
    throw new Error(
      'REFUSED: DATABASE_URL is unset or unparseable, so this process cannot prove which database it would write to. ' +
        'Set DATABASE_URL to a local instance.'
    );
  }
  if (!isLocalFingerprint(fingerprint)) {
    throw new Error(
      `REFUSED: [${fingerprint}] is not a local database. This utility provisions development and rehearsal ` +
        'instances only. Roster changes to production go through the manifest-driven cutover tool ' +
        '(scripts/cutover/safe-cutover-tool.ts), which hashes what it intends to do and refuses on any unmet ' +
        `precondition. Local hosts: ${[...LOCAL_HOSTS].join(', ')}.`
    );
  }
}

/**
 * A distinct secret per account. The old code hashed one string — supplied or, worse,
 * defaulted to a literal committed to a public repository — and assigned it to all 44,
 * so one disclosure was a disclosure of every account.
 */
export function generatePassword(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Where the generated credentials are written. Required, and refused inside the working
 * tree: a credentials file that lands in the repository is one `git add .` from being the
 * defect this replaced.
 */
export function resolveCredentialSink(rawArg: string | undefined, repoRoot: string, cwd: string): string {
  if (!rawArg || rawArg.trim() === '') {
    throw new Error(
      'REFUSED: --credentials-out=<path> is required. Each account is given its own random password, and this ' +
        'file is the only record of them. Nominate a path outside the repository.'
    );
  }
  const resolved = path.resolve(cwd, rawArg.trim());
  const root = path.resolve(repoRoot);
  const rel = path.relative(root, resolved);
  if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new Error(
      `REFUSED: [${resolved}] is inside the repository. Credentials written there can be committed. ` +
        'Nominate a path outside the working tree.'
    );
  }
  return resolved;
}

/**
 * The hierarchy below exists only here — `approved-roster.json` carries no `managerEmail`,
 * and is hashed into the cutover manifest, so it is not the place to add one. Two lists of
 * who should exist can drift, though, and a drifted roster provisions the wrong people. So
 * this one is held to that one: same addresses, same roles, same tenant, or nothing runs.
 */
export function assertRosterMatchesApproved(
  roster: ReadonlyArray<{ email: string; role: string }>,
  approved: ReadonlyArray<{ email: string; role: string; tenantId: string }>
): void {
  const errors: string[] = [];
  const norm = (e: string) => e.toLowerCase().trim();

  const approvedByEmail = new Map(approved.map((u) => [norm(u.email), u]));
  const rosterByEmail = new Map(roster.map((u) => [norm(u.email), u]));

  for (const [email, entry] of rosterByEmail) {
    const match = approvedByEmail.get(email);
    if (!match) {
      errors.push(`${email} is provisioned here but is not on the approved roster`);
      continue;
    }
    if (match.role !== entry.role) {
      errors.push(`${email}: this script says ${entry.role}, the approved roster says ${match.role}`);
    }
    if (match.tenantId !== TENANT_ID) {
      errors.push(`${email}: approved for tenant ${match.tenantId}, but this script provisions ${TENANT_ID}`);
    }
  }
  for (const email of approvedByEmail.keys()) {
    if (!rosterByEmail.has(email)) {
      errors.push(`${email} is on the approved roster but is not provisioned here`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `REFUSED: this script's roster and scripts/cutover/approved-roster.json disagree:\n  - ${errors.join('\n  - ')}`
    );
  }
}

export interface RosterUser {
  email: string;
  firstName: string;
  lastName: string;
  role: 'director' | 'floor_manager' | 'team_lead' | 'sdr' | 'leadgen_manager' | 'leadgen';
  managerEmail?: string | null;
}

export const OFFICIAL_USERS: RosterUser[] = [
  // ── Directors ─────────────────────────────────────────────────────────────
  { email: 'dean@telestar.vn', firstName: 'Dean', lastName: 'Nguyen', role: 'director', managerEmail: null },
  { email: 'sonnynguyenofficial@gmail.com', firstName: 'Sonny', lastName: 'Nguyen', role: 'director', managerEmail: null },

  // ── Floor Managers ────────────────────────────────────────────────────────
  { email: 'sonny@itelestar.com', firstName: 'Sonny', lastName: 'Nguyen', role: 'floor_manager', managerEmail: 'dean@telestar.vn' },
  { email: 'alayna@itelestar.com', firstName: 'Alayna', lastName: '', role: 'floor_manager', managerEmail: 'dean@telestar.vn' },

  // ── Leadgen Managers & Leadgen ───────────────────────────────────────────
  { email: 'dominic@itelestar.com', firstName: 'Dominic', lastName: '', role: 'leadgen_manager', managerEmail: 'dean@telestar.vn' },
  { email: 'alex@itelestar.com', firstName: 'Alex', lastName: '', role: 'leadgen', managerEmail: 'dominic@itelestar.com' },
  { email: 'priya@itelestar.com', firstName: 'Priya', lastName: '', role: 'leadgen', managerEmail: 'dominic@itelestar.com' },

  // ── Team Leads ────────────────────────────────────────────────────────────
  { email: 'branndon@itelestar.com', firstName: 'Branndon', lastName: '', role: 'team_lead', managerEmail: 'sonny@itelestar.com' },
  { email: 'jackie@itelestar.com', firstName: 'Jackie', lastName: '', role: 'team_lead', managerEmail: 'sonny@itelestar.com' },
  { email: 'vie@itelestar.com', firstName: 'Vie', lastName: '', role: 'team_lead', managerEmail: 'sonny@itelestar.com' },
  { email: 'meixi@itelestar.com', firstName: 'Meixi', lastName: '', role: 'team_lead', managerEmail: 'sonny@itelestar.com' },
  { email: 'hayden@itelestar.com', firstName: 'Hayden', lastName: '', role: 'team_lead', managerEmail: 'alayna@itelestar.com' },
  { email: 'selina@itelestar.com', firstName: 'Selina', lastName: '', role: 'team_lead', managerEmail: 'alayna@itelestar.com' },
  { email: 'kim@itelestar.com', firstName: 'Kim', lastName: '', role: 'team_lead', managerEmail: 'alayna@itelestar.com' },
  { email: 'celine.phan@itelestar.com', firstName: 'Celine', lastName: 'Phan', role: 'team_lead', managerEmail: 'alayna@itelestar.com' },

  // ── SDRs (@itelestar.com) ─────────────────────────────────────────────────
  // Kim's Pod
  { email: 'hailey@itelestar.com', firstName: 'Hailey', lastName: '', role: 'sdr', managerEmail: 'kim@itelestar.com' },

  // Celine's Pod
  { email: 'jason@itelestar.com', firstName: 'Jason', lastName: '', role: 'sdr', managerEmail: 'celine.phan@itelestar.com' },
  { email: 'andrew@itelestar.com', firstName: 'Andrew', lastName: '', role: 'sdr', managerEmail: 'celine.phan@itelestar.com' },
  { email: 'tina@itelestar.com', firstName: 'Tina', lastName: '', role: 'sdr', managerEmail: 'celine.phan@itelestar.com' },
  { email: 'channy@itelestar.com', firstName: 'Channy', lastName: '', role: 'sdr', managerEmail: 'celine.phan@itelestar.com' },
  { email: 'kade@itelestar.com', firstName: 'Kade', lastName: '', role: 'sdr', managerEmail: 'celine.phan@itelestar.com' },
  // Meixi's Pod
  { email: 'nancy@itelestar.com', firstName: 'Nancy', lastName: '', role: 'sdr', managerEmail: 'meixi@itelestar.com' },
  { email: 'jay@itelestar.com', firstName: 'Jay', lastName: '', role: 'sdr', managerEmail: 'meixi@itelestar.com' },
  { email: 'victor@itelestar.com', firstName: 'Victor', lastName: '', role: 'sdr', managerEmail: 'meixi@itelestar.com' },
  { email: 'lily@itelestar.com', firstName: 'Lily', lastName: '', role: 'sdr', managerEmail: 'meixi@itelestar.com' },

  // Hayden's Pod
  { email: 'cecilia@itelestar.com', firstName: 'Cecilia', lastName: '', role: 'sdr', managerEmail: 'hayden@itelestar.com' },
  { email: 'kai@itelestar.com', firstName: 'Kai', lastName: '', role: 'sdr', managerEmail: 'hayden@itelestar.com' },
  { email: 'gigi@itelestar.com', firstName: 'Gigi', lastName: '', role: 'sdr', managerEmail: 'hayden@itelestar.com' },
  { email: 'jacob@itelestar.com', firstName: 'Jacob', lastName: '', role: 'sdr', managerEmail: 'hayden@itelestar.com' },
  { email: 'amber@itelestar.com', firstName: 'Amber', lastName: '', role: 'sdr', managerEmail: 'hayden@itelestar.com' },

  // Branndon's Pod
  { email: 'eli@itelestar.com', firstName: 'Eli', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },
  { email: 'quinn@itelestar.com', firstName: 'Quinn', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },
  { email: 'mavis@itelestar.com', firstName: 'Mavis', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },
  { email: 'vincent@itelestar.com', firstName: 'Vincent', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },
  { email: 'annie@itelestar.com', firstName: 'Annie', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },

  // Vie's Pod
  { email: 'dan@itelestar.com', firstName: 'Dan', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },
  { email: 'ann@itelestar.com', firstName: 'Ann', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },
  { email: 'kate@itelestar.com', firstName: 'Kate', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },
  { email: 'arthur@itelestar.com', firstName: 'Arthur', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },
  { email: 'emily@itelestar.com', firstName: 'Emily', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },

  // Jackie's Pod
  { email: 'danny@itelestar.com', firstName: 'Danny', lastName: '', role: 'sdr', managerEmail: 'jackie@itelestar.com' },
  { email: 'helen@itelestar.com', firstName: 'Helen', lastName: '', role: 'sdr', managerEmail: 'jackie@itelestar.com' },
  { email: 'aimee@itelestar.com', firstName: 'Aimee', lastName: '', role: 'sdr', managerEmail: 'jackie@itelestar.com' },
  { email: 'caine@itelestar.com', firstName: 'Caine', lastName: '', role: 'sdr', managerEmail: 'jackie@itelestar.com' },
];

async function main() {
  const cwd = process.cwd();
  // npm runs scripts from the package root. Derived rather than hard-coded so the guard in
  // `resolveCredentialSink` is comparing against the real tree.
  const repoRoot = process.cwd();

  // Every refusal happens before a client is constructed, so a rejected invocation never
  // opens a connection to the database it just declined to write to. The admin client is
  // imported here, not at module scope, for the same reason: importing this file to test its
  // guards must not construct a Prisma client or evaluate the RLS-bypass contract.
  const fingerprint = getDatabaseFingerprint();
  assertLocalTarget(fingerprint);

  const outArg = process.argv.find((a) => a.startsWith('--credentials-out='))?.split('=').slice(1).join('=');
  const credentialSink = resolveCredentialSink(outArg, repoRoot, cwd);

  assertRosterMatchesApproved(OFFICIAL_USERS, approvedRoster.approvedUsers);

  console.log(`🔄 Provisioning ${OFFICIAL_USERS.length} internal accounts into [${fingerprint}]...`);

  // One secret per account, generated before the transaction so a bcrypt failure cannot
  // abort a run that has already written.
  const credentials = new Map<string, string>();
  const hashes = new Map<string, string>();
  for (const user of OFFICIAL_USERS) {
    const email = user.email.toLowerCase().trim();
    const password = generatePassword();
    credentials.set(email, password);
    hashes.set(email, await hash(password, 12));
  }

  const { createAdminClient } = await import('@/lib/db/adminClient.mjs');
  const prisma = createAdminClient();

  try {
    // One transaction: an injected failure at any point rolls back every write rather than
    // leaving a roster half-provisioned with no record of where it stopped.
    const provisioned = await prisma.$transaction(async (tx: any) => {
      await tx.tenant.upsert({
        where: { id: TENANT_ID },
        update: { name: 'Telestar Revenue Delivery' },
        create: { id: TENANT_ID, name: 'Telestar Revenue Delivery' },
      });

      const emailToId = new Map<string, string>();
      for (const user of OFFICIAL_USERS) {
        const normalizedEmail = user.email.toLowerCase().trim();
        const password = hashes.get(normalizedEmail)!;
        const upserted = await tx.user.upsert({
          where: { email: normalizedEmail },
          update: {
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            password,
            isActive: true,
            authVersion: { increment: 1 },
            tenantId: TENANT_ID,
          },
          create: {
            email: normalizedEmail,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            password,
            isActive: true,
            tenantId: TENANT_ID,
          },
        });
        emailToId.set(normalizedEmail, upserted.id);
      }

      for (const user of OFFICIAL_USERS) {
        const normalizedEmail = user.email.toLowerCase().trim();
        const userId = emailToId.get(normalizedEmail);
        const managerId = user.managerEmail ? emailToId.get(user.managerEmail.toLowerCase().trim()) : null;
        if (!userId) continue;

        // Scoped by tenant as well as by id. The id came from this run's own upserts, so the
        // predicate is redundant today — and it is the predicate whose absence made the old
        // step 4 a cross-tenant delete, so it is stated rather than assumed.
        const linked = await tx.user.updateMany({
          where: { id: userId, tenantId: TENANT_ID },
          data: { managerId: managerId ?? null },
        });
        if (linked.count !== 1) {
          throw new Error(
            `Manager link for ${normalizedEmail} matched ${linked.count} rows in tenant ${TENANT_ID}, expected 1. Rolling back.`
          );
        }
      }

      return emailToId.size;
    });

    // Written only once the transaction has committed, so the file never describes accounts
    // that were rolled back.
    mkdirSync(path.dirname(credentialSink), { recursive: true });
    writeFileSync(
      credentialSink,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          databaseFingerprint: fingerprint,
          tenantId: TENANT_ID,
          note: 'One-time credentials. Distribute over a secure channel, require a change at first login, then delete this file. Never commit it.',
          accounts: [...credentials.entries()].map(([email, password]) => ({ email, password })),
        },
        null,
        2
      ) + '\n',
      { mode: 0o600 }
    );

    // The roster is read back from the database rather than echoed from the input, so the
    // summary reports what was actually written. Passwords appear nowhere in it.
    const activeUsers = await prisma.user.findMany({
      where: { tenantId: TENANT_ID },
      select: { email: true, role: true, firstName: true, isActive: true },
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
    });

    console.log(`\n✅ Provisioned ${provisioned} accounts; tenant ${TENANT_ID} now holds ${activeUsers.length}.`);
    console.table(activeUsers);
    console.log(`\n🔑 Per-account credentials written to ${credentialSink} (mode 0600). Not printed, and not in this repository.`);
    console.log('   Distribute securely, require a password change at first login, then delete the file.');
    console.log('\nℹ️  This utility removes nothing. Retiring accounts is the cutover manifest\'s decision:');
    console.log('   npm run prod:cutover:plan → verify → rehearse → execute → postcheck');
  } finally {
    await (prisma as any).$disconnect?.();
  }
}

if (
  process.argv[1]?.endsWith('restore-internal-users.ts') ||
  process.argv[1]?.endsWith('restore-internal-users.js')
) {
  main().catch((err) => {
    console.error('❌ Failed to provision users:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
