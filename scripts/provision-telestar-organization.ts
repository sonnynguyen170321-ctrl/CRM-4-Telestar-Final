import { hash } from 'bcryptjs';
import { createAdminClient } from '@/lib/db/adminClient.mjs';

const prisma = createAdminClient();
const TENANT_ID = 'default-tenant';
const PASSWORD_RAW = 'Telestar2026';

const ORG_STRUCTURE = [
  // ── Executive & Floor Managers ──────────────────────────────────────────────
  { email: 'dean@telestar.vn', firstName: 'Dean', lastName: 'Nguyen', role: 'director' as const, managerEmail: null },
  { email: 'sonny@itelestar.com', firstName: 'Sonny', lastName: 'Nguyen', role: 'floor_manager' as const, managerEmail: 'dean@telestar.vn' },
  { email: 'alayna@itelestar.com', firstName: 'Alayna', lastName: '', role: 'floor_manager' as const, managerEmail: 'dean@telestar.vn' },
  { email: 'dominic@itelestar.com', firstName: 'Dominic', lastName: '', role: 'leadgen_manager' as const, managerEmail: 'dean@telestar.vn' },

  // ── Team 1: Branndon ────────────────────────────────────────────────────────
  { email: 'branndon@itelestar.com', firstName: 'Branndon', lastName: '', role: 'team_lead' as const, managerEmail: 'sonny@itelestar.com' },
  { email: 'eli@itelestar.com', firstName: 'Eli', lastName: '', role: 'sdr' as const, managerEmail: 'branndon@itelestar.com' },
  { email: 'quinn@itelestar.com', firstName: 'Quinn', lastName: '', role: 'sdr' as const, managerEmail: 'branndon@itelestar.com' },
  { email: 'mavis@itelestar.com', firstName: 'Mavis', lastName: '', role: 'sdr' as const, managerEmail: 'branndon@itelestar.com' },
  { email: 'vincent@itelestar.com', firstName: 'Vincent', lastName: '', role: 'sdr' as const, managerEmail: 'branndon@itelestar.com' },
  { email: 'annie@itelestar.com', firstName: 'Annie', lastName: '', role: 'sdr' as const, managerEmail: 'branndon@itelestar.com' },

  // ── Team 2: Vie ─────────────────────────────────────────────────────────────
  { email: 'vie@itelestar.com', firstName: 'Vie', lastName: '', role: 'team_lead' as const, managerEmail: 'sonny@itelestar.com' },
  { email: 'dan@itelestar.com', firstName: 'Dan', lastName: '', role: 'sdr' as const, managerEmail: 'vie@itelestar.com' },
  { email: 'ann@itelestar.com', firstName: 'Ann', lastName: '', role: 'sdr' as const, managerEmail: 'vie@itelestar.com' },
  { email: 'kate@itelestar.com', firstName: 'Kate', lastName: '', role: 'sdr' as const, managerEmail: 'vie@itelestar.com' },
  { email: 'arthur@itelestar.com', firstName: 'Arthur', lastName: '', role: 'sdr' as const, managerEmail: 'vie@itelestar.com' },
  { email: 'emily@itelestar.com', firstName: 'Emily', lastName: '', role: 'sdr' as const, managerEmail: 'vie@itelestar.com' },

  // ── Team 3: Jackie ──────────────────────────────────────────────────────────
  { email: 'jackie@itelestar.com', firstName: 'Jackie', lastName: '', role: 'team_lead' as const, managerEmail: 'sonny@itelestar.com' },
  { email: 'danny@itelestar.com', firstName: 'Danny', lastName: '', role: 'sdr' as const, managerEmail: 'jackie@itelestar.com' },
  { email: 'helen@itelestar.com', firstName: 'Helen', lastName: '', role: 'sdr' as const, managerEmail: 'jackie@itelestar.com' },
  { email: 'aimee@itelestar.com', firstName: 'Aimee', lastName: '', role: 'sdr' as const, managerEmail: 'jackie@itelestar.com' },
  { email: 'caine@itelestar.com', firstName: 'Caine', lastName: '', role: 'sdr' as const, managerEmail: 'jackie@itelestar.com' },
];

async function main() {
  const hashedPassword = await hash(PASSWORD_RAW, 12);

  // 1. Ensure Tenant
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: { name: 'Telestar Revenue Delivery' },
    create: { id: TENANT_ID, name: 'Telestar Revenue Delivery' },
  });

  // 2. Upsert all users first without managerId
  const emailToId = new Map<string, string>();

  for (const user of ORG_STRUCTURE) {
    const upserted = await prisma.user.upsert({
      where: { email: user.email.toLowerCase() },
      update: {
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        password: hashedPassword,
        isActive: true,
        authVersion: { increment: 1 },
        tenantId: TENANT_ID,
      },
      create: {
        email: user.email.toLowerCase(),
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        password: hashedPassword,
        isActive: true,
        tenantId: TENANT_ID,
      },
    });
    emailToId.set(user.email.toLowerCase(), upserted.id);
  }

  // 3. Link manager hierarchy
  for (const user of ORG_STRUCTURE) {
    const userId = emailToId.get(user.email.toLowerCase());
    const managerId = user.managerEmail ? emailToId.get(user.managerEmail.toLowerCase()) : null;

    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { managerId: managerId ?? null },
      });
    }
  }

  // 4. Verification table
  const allUsers = await prisma.user.findMany({
    where: { tenantId: TENANT_ID },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      manager: { select: { email: true, firstName: true, role: true } },
      reports: { select: { email: true, firstName: true, role: true } },
    },
    orderBy: [{ role: 'asc' }, { email: 'asc' }],
  });

  console.log('========================================================================');
  console.log(`🏢 TELESTAR COMPLETE ORGANIZATION LIVE PROVISIONING (${allUsers.length} Users)`);
  console.log('========================================================================\n');

  console.table(
    allUsers.map((u) => ({
      email: u.email,
      name: `${u.firstName} ${u.lastName}`.trim(),
      role: u.role,
      active: u.isActive,
      manager: u.manager ? `${u.manager.firstName} (${u.manager.email})` : '— (None)',
      directReports: u.reports.length,
    }))
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('\n🎉 ALL 21 USERS CONFIGURED, HIERARCHY LINKED & ACTIVATED 100%');
  })
  .catch(async (err) => {
    console.error('FAIL:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
