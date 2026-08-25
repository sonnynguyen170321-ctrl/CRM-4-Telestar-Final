import { hash } from 'bcryptjs';
import { createAdminClient } from '@/lib/db/adminClient.mjs';

const prisma = createAdminClient();
const TENANT_ID = 'default-tenant';
const DEFAULT_PASSWORD = process.env.USER_RESTORE_PASSWORD || 'Telestar2026';

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

  // 4. Purge all other @telestar.vn accounts (only dean@telestar.vn is retained)
  const deanId = emailToId.get('dean@telestar.vn');
  const allowedEmails = new Set(OFFICIAL_USERS.map((u) => u.email.toLowerCase().trim()));

  const extraUsers = await prisma.user.findMany({
    where: {
      OR: [
        { email: { endsWith: '@telestar.vn', not: 'dean@telestar.vn' } },
        { email: { notIn: Array.from(allowedEmails) } },
      ],
    },
    select: { id: true, email: true },
  });

  if (extraUsers.length > 0 && deanId) {
    console.log(`\n🧹 Purging ${extraUsers.length} extra/deprecated users (e.g. non-Dean @telestar.vn)...`);
    const extraIds = extraUsers.map((u) => u.id);

    // Reassign key relations to Dean
    const safeUpdate = async (model: string, args: any) => {
      try {
        if ((prisma as any)[model]?.updateMany) {
          await (prisma as any)[model].updateMany(args);
        }
      } catch {}
    };

    await safeUpdate('lead', { where: { assignedToId: { in: extraIds } }, data: { assignedToId: deanId } });
    await safeUpdate('lead', { where: { claimedById: { in: extraIds } }, data: { claimedById: null } });
    await safeUpdate('contact', { where: { assignedToId: { in: extraIds } }, data: { assignedToId: deanId } });
    await safeUpdate('contact', { where: { relationshipOwnerId: { in: extraIds } }, data: { relationshipOwnerId: deanId } });
    await safeUpdate('account', { where: { assignedToId: { in: extraIds } }, data: { assignedToId: deanId } });
    await safeUpdate('campaign', { where: { managerId: { in: extraIds } }, data: { managerId: deanId } });
    await safeUpdate('sequence', { where: { createdById: { in: extraIds } }, data: { createdById: deanId } });
    await safeUpdate('template', { where: { createdById: { in: extraIds } }, data: { createdById: deanId } });
    await safeUpdate('task', { where: { userId: { in: extraIds } }, data: { userId: deanId } });
    await safeUpdate('task', { where: { assignedToId: { in: extraIds } }, data: { assignedToId: deanId } });
    await safeUpdate('note', { where: { userId: { in: extraIds } }, data: { userId: deanId } });
    await safeUpdate('note', { where: { createdById: { in: extraIds } }, data: { createdById: deanId } });
    await safeUpdate('opportunity', { where: { ownerId: { in: extraIds } }, data: { ownerId: deanId } });
    await safeUpdate('opportunity', { where: { createdById: { in: extraIds } }, data: { createdById: deanId } });
    await safeUpdate('user', { where: { managerId: { in: extraIds } }, data: { managerId: deanId } });

    // Clean up personal join records
    const safeDelete = async (model: string, args: any) => {
      try {
        if ((prisma as any)[model]?.deleteMany) {
          await (prisma as any)[model].deleteMany(args);
        }
      } catch {}
    };

    await safeDelete('notification', { where: { userId: { in: extraIds } } });
    await safeDelete('activity', { where: { userId: { in: extraIds } } });
    await safeDelete('emailAccount', { where: { userId: { in: extraIds } } });
    await safeDelete('userRoleAssignment', { where: { userId: { in: extraIds } } });

    // Delete users
    await prisma.user.deleteMany({ where: { id: { in: extraIds } } });
    console.log(`✅ Cleaned up ${extraUsers.length} deprecated user accounts.`);
  }

  // 5. Output Summary Verification
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

  console.log(`\n✅ Active Official Team Roster (${activeUsers.length} accounts):`);
  console.table(activeUsers);
  console.log(`\n🔑 Default Password for all accounts: "${DEFAULT_PASSWORD}"`);
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
