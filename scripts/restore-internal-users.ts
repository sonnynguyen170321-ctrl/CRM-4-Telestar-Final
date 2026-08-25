import { hash } from 'bcryptjs';
import { createAdminClient } from '@/lib/db/adminClient.mjs';

const prisma = createAdminClient();
const TENANT_ID = 'default-tenant';
const DEFAULT_PASSWORD = process.env.USER_RESTORE_PASSWORD || 'telestar2026';

interface RosterUser {
  email: string;
  firstName: string;
  lastName: string;
  role: 'director' | 'floor_manager' | 'team_lead' | 'sdr' | 'leadgen_manager' | 'leadgen';
  managerEmail?: string | null;
}

const OFFICIAL_USERS: RosterUser[] = [
  // ── Directors ─────────────────────────────────────────────────────────────
  { email: 'dean@telestar.vn', firstName: 'Dean', lastName: 'Nguyen', role: 'director', managerEmail: null },
  { email: 'sonnynguyenofficial@gmail.com', firstName: 'Sonny', lastName: 'Nguyen', role: 'director', managerEmail: null },

  // ── Floor Managers ────────────────────────────────────────────────────────
  { email: 'sonny@telestar.vn', firstName: 'Sonny', lastName: 'Nguyen', role: 'floor_manager', managerEmail: 'dean@telestar.vn' },
  { email: 'sonny@itelestar.com', firstName: 'Sonny', lastName: 'Nguyen', role: 'floor_manager', managerEmail: 'dean@telestar.vn' },
  { email: 'alayna@telestar.vn', firstName: 'Alayna', lastName: '', role: 'floor_manager', managerEmail: 'dean@telestar.vn' },
  { email: 'alayna@itelestar.com', firstName: 'Alayna', lastName: '', role: 'floor_manager', managerEmail: 'dean@telestar.vn' },

  // ── Leadgen Managers & Leadgen ───────────────────────────────────────────
  { email: 'dominic@telestar.vn', firstName: 'Dominic', lastName: '', role: 'leadgen_manager', managerEmail: 'dean@telestar.vn' },
  { email: 'dominic@itelestar.com', firstName: 'Dominic', lastName: '', role: 'leadgen_manager', managerEmail: 'dean@telestar.vn' },
  { email: 'alex@telestar.vn', firstName: 'Alex', lastName: '', role: 'leadgen', managerEmail: 'dominic@telestar.vn' },
  { email: 'priya@telestar.vn', firstName: 'Priya', lastName: '', role: 'leadgen', managerEmail: 'dominic@telestar.vn' },

  // ── Team Leads ────────────────────────────────────────────────────────────
  { email: 'brandon@telestar.vn', firstName: 'Brandon', lastName: '', role: 'team_lead', managerEmail: 'sonny@telestar.vn' },
  { email: 'branndon@itelestar.com', firstName: 'Branndon', lastName: '', role: 'team_lead', managerEmail: 'sonny@itelestar.com' },
  { email: 'jackie@telestar.vn', firstName: 'Jackie', lastName: '', role: 'team_lead', managerEmail: 'sonny@telestar.vn' },
  { email: 'jackie@itelestar.com', firstName: 'Jackie', lastName: '', role: 'team_lead', managerEmail: 'sonny@itelestar.com' },
  { email: 'vie@telestar.vn', firstName: 'Vie', lastName: '', role: 'team_lead', managerEmail: 'sonny@telestar.vn' },
  { email: 'vie@itelestar.com', firstName: 'Vie', lastName: '', role: 'team_lead', managerEmail: 'sonny@itelestar.com' },
  { email: 'meixi@telestar.vn', firstName: 'Meixi', lastName: '', role: 'team_lead', managerEmail: 'sonny@telestar.vn' },
  { email: 'hayden@telestar.vn', firstName: 'Hayden', lastName: '', role: 'team_lead', managerEmail: 'alayna@telestar.vn' },
  { email: 'selina@telestar.vn', firstName: 'Selina', lastName: '', role: 'team_lead', managerEmail: 'alayna@telestar.vn' },
  { email: 'kim@telestar.vn', firstName: 'Kim', lastName: '', role: 'team_lead', managerEmail: 'alayna@telestar.vn' },

  // ── SDRs (@telestar.vn) ───────────────────────────────────────────────────
  { email: 'lan.pham@telestar.vn', firstName: 'Lan', lastName: 'Pham', role: 'sdr', managerEmail: 'brandon@telestar.vn' },
  { email: 'david.miller@telestar.vn', firstName: 'David', lastName: 'Miller', role: 'sdr', managerEmail: 'brandon@telestar.vn' },
  { email: 'vy.hoang@telestar.vn', firstName: 'Vy', lastName: 'Hoang', role: 'sdr', managerEmail: 'jackie@telestar.vn' },
  { email: 'carlos.reyes@telestar.vn', firstName: 'Carlos', lastName: 'Reyes', role: 'sdr', managerEmail: 'vie@telestar.vn' },

  // ── SDRs (@itelestar.com) ─────────────────────────────────────────────────
  { email: 'eli@itelestar.com', firstName: 'Eli', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },
  { email: 'quinn@itelestar.com', firstName: 'Quinn', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },
  { email: 'mavis@itelestar.com', firstName: 'Mavis', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },
  { email: 'vincent@itelestar.com', firstName: 'Vincent', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },
  { email: 'annie@itelestar.com', firstName: 'Annie', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },
  { email: 'dan@itelestar.com', firstName: 'Dan', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },
  { email: 'ann@itelestar.com', firstName: 'Ann', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },
  { email: 'kate@itelestar.com', firstName: 'Kate', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },
  { email: 'arthur@itelestar.com', firstName: 'Arthur', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },
  { email: 'emily@itelestar.com', firstName: 'Emily', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },
  { email: 'danny@itelestar.com', firstName: 'Danny', lastName: '', role: 'sdr', managerEmail: 'jackie@itelestar.com' },
  { email: 'helen@itelestar.com', firstName: 'Helen', lastName: '', role: 'sdr', managerEmail: 'jackie@itelestar.com' },
  { email: 'aimee@itelestar.com', firstName: 'Aimee', lastName: '', role: 'sdr', managerEmail: 'jackie@itelestar.com' },
  { email: 'caine@itelestar.com', firstName: 'Caine', lastName: '', role: 'sdr', managerEmail: 'jackie@itelestar.com' },
];

async function main() {
  console.log('🔄 Restoring and Activating Official Internal User Accounts...');
  const hashedPassword = await hash(DEFAULT_PASSWORD, 12);

  // 1. Ensure Tenant
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: { name: 'Telestar Revenue Delivery' },
    create: { id: TENANT_ID, name: 'Telestar Revenue Delivery' },
  });

  // 2. Upsert users
  const emailToId = new Map<string, string>();
  for (const user of OFFICIAL_USERS) {
    const normalizedEmail = user.email.toLowerCase().trim();
    const upserted = await prisma.user.upsert({
      where: { email: normalizedEmail },
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
        email: normalizedEmail,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        password: hashedPassword,
        isActive: true,
        tenantId: TENANT_ID,
      },
    });
    emailToId.set(normalizedEmail, upserted.id);
  }

  // 3. Link Manager Hierarchy
  for (const user of OFFICIAL_USERS) {
    const normalizedEmail = user.email.toLowerCase().trim();
    const userId = emailToId.get(normalizedEmail);
    const managerId = user.managerEmail ? emailToId.get(user.managerEmail.toLowerCase().trim()) : null;

    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { managerId: managerId ?? null },
      });
    }
  }

  // 4. Output Summary Verification
  const activeUsers = await prisma.user.findMany({
    where: { tenantId: TENANT_ID },
    select: {
      email: true,
      role: true,
      firstName: true,
      isActive: true,
    },
    orderBy: [{ role: 'asc' }, { email: 'asc' }],
  });

  console.log(`\n✅ Successfully restored and confirmed ${activeUsers.length} active internal accounts:`);
  console.table(activeUsers);
  console.log(`\n🔑 Default Password for restored accounts: "${DEFAULT_PASSWORD}"`);
}

main()
  .then(async () => {
    await (prisma as any).$disconnect?.();
  })
  .catch(async (err) => {
    console.error('❌ Failed to restore users:', err instanceof Error ? err.message : err);
    await (prisma as any).$disconnect?.();
    process.exit(1);
  });
