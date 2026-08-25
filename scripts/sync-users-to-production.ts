const PROD_URL = process.env.PROD_URL || 'https://crm.telestar.cloud';
const PASSWORD_RAW = process.env.PROD_PASSWORD || 'Telestar2026';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'dean@telestar.vn';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Telestar2026';

interface UserSpec {
  email: string;
  firstName: string;
  lastName: string;
  role: 'director' | 'floor_manager' | 'team_lead' | 'sdr' | 'leadgen_manager' | 'leadgen';
  managerEmail?: string | null;
}

const USERS_TO_SYNC: UserSpec[] = [
  // ── Floor Managers & Leadgen Managers ──────────────────────────────────────
  { email: 'sonny@telestar.vn', firstName: 'Sonny', lastName: 'Nguyen', role: 'floor_manager', managerEmail: 'dean@telestar.vn' },
  { email: 'sonny@itelestar.com', firstName: 'Sonny', lastName: 'Nguyen', role: 'floor_manager', managerEmail: 'dean@telestar.vn' },
  { email: 'alayna@telestar.vn', firstName: 'Alayna', lastName: '', role: 'floor_manager', managerEmail: 'dean@telestar.vn' },
  { email: 'alayna@itelestar.com', firstName: 'Alayna', lastName: '', role: 'floor_manager', managerEmail: 'dean@telestar.vn' },
  { email: 'dominic@telestar.vn', firstName: 'Dominic', lastName: '', role: 'leadgen_manager', managerEmail: 'dean@telestar.vn' },
  { email: 'dominic@itelestar.com', firstName: 'Dominic', lastName: '', role: 'leadgen_manager', managerEmail: 'dean@telestar.vn' },

  // ── Leadgen Reps ─────────────────────────────────────────────────────────
  { email: 'alex@telestar.vn', firstName: 'Alex', lastName: '', role: 'leadgen', managerEmail: 'dominic@telestar.vn' },
  { email: 'priya@telestar.vn', firstName: 'Priya', lastName: '', role: 'leadgen', managerEmail: 'dominic@telestar.vn' },

  // ── Team Leads (@telestar.vn & @itelestar.com) ────────────────────────────
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

async function loginAsAdmin(): Promise<string> {
  console.log(`1. Authenticating as ${ADMIN_EMAIL} on ${PROD_URL}...`);
  const csrfRes = await fetch(`${PROD_URL}/api/auth/csrf`);
  if (!csrfRes.ok) {
    throw new Error(`Failed to reach ${PROD_URL}/api/auth/csrf: ${csrfRes.status} ${csrfRes.statusText}`);
  }
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.csrfToken;
  const initialCookies = csrfRes.headers.get('set-cookie') || '';

  const loginRes = await fetch(`${PROD_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': initialCookies,
    },
    body: new URLSearchParams({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      csrfToken,
      json: 'true',
    }),
    redirect: 'manual',
  });

  const setCookies = typeof loginRes.headers.getSetCookie === 'function'
    ? loginRes.headers.getSetCookie()
    : [loginRes.headers.get('set-cookie') || ''];

  const allCookiesStr = setCookies.join('; ');
  const redirectLoc = loginRes.headers.get('location');

  if (redirectLoc && redirectLoc.includes('error=')) {
    throw new Error(`Authentication failed on production: redirect to ${redirectLoc}`);
  }

  const match =
    allCookiesStr.match(/__Secure-authjs\.session-token=([^;]+)/) ||
    allCookiesStr.match(/authjs\.session-token=([^;]+)/);

  if (!match) {
    throw new Error(
      `Failed to obtain session token on production. Status: ${loginRes.status}, Location: ${redirectLoc}, Cookies: ${setCookies.map(c => c.split(';')[0]).join(', ')}`
    );
  }

  const cookieName = match[0].split('=')[0];
  const cookieHeader = `${cookieName}=${match[1]}`;
  console.log(`   ✅ ${ADMIN_EMAIL} authenticated successfully on production`);
  return cookieHeader;
}

async function main() {
  console.log('========================================================================');
  console.log(`🚀 LIVE PRODUCTION SYNC: PROVISIONING USERS TO ${PROD_URL}`);
  console.log('========================================================================\n');

  const cookie = await loginAsAdmin();

  // 1. Fetch current users on production
  console.log('\n2. Fetching current production users...');
  const adminRes = await fetch(`${PROD_URL}/api/admin/users`, {
    headers: { Cookie: cookie },
  });
  if (!adminRes.ok) {
    throw new Error(`Failed to fetch admin users: ${adminRes.status} ${await adminRes.text()}`);
  }
  const adminData = await adminRes.json();
  const existingUsers: any[] = adminData.users || [];
  console.log(`   Found ${existingUsers.length} existing users on production.`);

  const emailToId = new Map<string, string>();
  existingUsers.forEach((u: any) => emailToId.set(u.email.toLowerCase(), u.id));

  // 2. Create/Update Non-SDRs (Managers and Team Leads) first
  console.log('\n3. Provisioning Managers & Team Leads on production...');
  const managersAndLeads = USERS_TO_SYNC.filter((u) => u.role !== 'sdr');
  for (const u of managersAndLeads) {
    const createRes = await fetch(`${PROD_URL}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName || 'Staff',
        role: u.role,
        password: PASSWORD_RAW,
      }),
    });

    const resJson = await createRes.json().catch(() => ({}));
    if (createRes.ok || createRes.status === 409) {
      console.log(`   ✅ ${u.role}: ${u.firstName} (${u.email}) is ready`);
    } else {
      console.error(`   ❌ Failed on ${u.email}:`, resJson);
    }
  }

  // Refresh user map for manager IDs
  const refreshedRes = await fetch(`${PROD_URL}/api/admin/users`, { headers: { Cookie: cookie } });
  const refreshedData = await refreshedRes.json();
  const refreshedUsers: any[] = refreshedData.users || [];
  refreshedUsers.forEach((u: any) => emailToId.set(u.email.toLowerCase(), u.id));

  // 3. Create SDRs with manager linkages
  console.log('\n4. Provisioning SDRs on production...');
  const sdrs = USERS_TO_SYNC.filter((u) => u.role === 'sdr');
  for (const sdr of sdrs) {
    const managerId = sdr.managerEmail ? emailToId.get(sdr.managerEmail.toLowerCase()) : null;

    const createRes = await fetch(`${PROD_URL}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        email: sdr.email,
        firstName: sdr.firstName,
        lastName: sdr.lastName || 'SDR',
        role: sdr.role,
        password: PASSWORD_RAW,
        managerId: managerId || undefined,
      }),
    });

    const resJson = await createRes.json().catch(() => ({}));
    if (createRes.ok) {
      console.log(`   ✅ SDR created: ${sdr.firstName} (${sdr.email}) -> Manager: ${sdr.managerEmail ?? 'None'}`);
    } else if (createRes.status === 409) {
      console.log(`   ℹ️ SDR already exists: ${sdr.firstName} (${sdr.email})`);
    } else {
      console.error(`   ❌ Failed to create SDR ${sdr.email}:`, resJson);
    }
  }

  // 4. Final verification query against production
  console.log('\n5. Final Production Verification Query:');
  const finalRes = await fetch(`${PROD_URL}/api/admin/users`, {
    headers: { Cookie: cookie },
  });
  const finalData = await finalRes.json();
  const allFinalUsers: any[] = finalData.users || [];

  console.log('\n========================================================================');
  console.log(`🎉 LIVE PRODUCTION ROSTER (${PROD_URL}) — ${allFinalUsers.length} Users Active`);
  console.log('========================================================================\n');

  console.table(
    allFinalUsers.map((u: any) => ({
      email: u.email,
      name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.name,
      role: u.role,
      active: u.isActive,
      manager: u.managerName ?? 'None',
    }))
  );
}

main().catch(console.error);
