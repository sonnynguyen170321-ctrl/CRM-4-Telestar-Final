const PROD_URL = 'https://crm.telestar.cloud';
const PASSWORD_RAW = 'Telestar2026';

const USERS_TO_SYNC = [
  // ── Team Leads ────────────────────────────────────────────────────────────
  { email: 'branndon@itelestar.com', firstName: 'Branndon', lastName: '', role: 'team_lead' },
  { email: 'vie@itelestar.com', firstName: 'Vie', lastName: '', role: 'team_lead' },
  { email: 'jackie@itelestar.com', firstName: 'Jackie', lastName: '', role: 'team_lead' },

  // ── Branndon SDRs ─────────────────────────────────────────────────────────
  { email: 'eli@itelestar.com', firstName: 'Eli', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },
  { email: 'quinn@itelestar.com', firstName: 'Quinn', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },
  { email: 'mavis@itelestar.com', firstName: 'Mavis', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },
  { email: 'vincent@itelestar.com', firstName: 'Vincent', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },
  { email: 'annie@itelestar.com', firstName: 'Annie', lastName: '', role: 'sdr', managerEmail: 'branndon@itelestar.com' },

  // ── Vie SDRs ──────────────────────────────────────────────────────────────
  { email: 'dan@itelestar.com', firstName: 'Dan', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },
  { email: 'ann@itelestar.com', firstName: 'Ann', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },
  { email: 'kate@itelestar.com', firstName: 'Kate', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },
  { email: 'arthur@itelestar.com', firstName: 'Arthur', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },
  { email: 'emily@itelestar.com', firstName: 'Emily', lastName: '', role: 'sdr', managerEmail: 'vie@itelestar.com' },

  // ── Jackie SDRs ───────────────────────────────────────────────────────────
  { email: 'danny@itelestar.com', firstName: 'Danny', lastName: '', role: 'sdr', managerEmail: 'jackie@itelestar.com' },
  { email: 'helen@itelestar.com', firstName: 'Helen', lastName: '', role: 'sdr', managerEmail: 'jackie@itelestar.com' },
  { email: 'aimee@itelestar.com', firstName: 'Aimee', lastName: '', role: 'sdr', managerEmail: 'jackie@itelestar.com' },
  { email: 'caine@itelestar.com', firstName: 'Caine', lastName: '', role: 'sdr', managerEmail: 'jackie@itelestar.com' },
];

async function loginAsDean(): Promise<string> {
  console.log('1. Authenticating as Dean on production...');
  const csrfRes = await fetch(`${PROD_URL}/api/auth/csrf`);
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
      email: 'dean@telestar.vn',
      password: 'Telestar2026',
      csrfToken,
      json: 'true',
    }),
    redirect: 'manual',
  });

  const sessionCookie = loginRes.headers.get('set-cookie');
  if (!sessionCookie || !sessionCookie.includes('session-token')) {
    throw new Error('Failed to obtain production session cookie');
  }

  // Extract session token cookie
  const match = sessionCookie.match(/__Secure-authjs\.session-token=([^;]+)/);
  if (!match) {
    throw new Error('Session token not found in cookies');
  }

  const cookieHeader = `__Secure-authjs.session-token=${match[1]}`;
  console.log('   ✅ Dean authenticated on production');
  return cookieHeader;
}

async function main() {
  console.log('========================================================================');
  console.log('🚀 LIVE PRODUCTION SYNC: PROVISIONING USERS TO crm.telestar.cloud');
  console.log('========================================================================\n');

  const cookie = await loginAsDean();

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
  console.log(`   Found ${existingUsers.length} existing users on production:`);
  console.log(existingUsers.map((u: any) => `   - ${u.email} (${u.role})`).join('\n'));

  const emailToId = new Map<string, string>();
  existingUsers.forEach((u: any) => emailToId.set(u.email.toLowerCase(), u.id));

  // 2. Create/Update Team Leads first
  console.log('\n3. Provisioning Team Leads on production...');
  const teamLeads = USERS_TO_SYNC.filter((u) => u.role === 'team_lead');
  for (const tl of teamLeads) {
    const createRes = await fetch(`${PROD_URL}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        email: tl.email,
        firstName: tl.firstName,
        lastName: tl.lastName || 'Lead',
        role: tl.role,
        password: PASSWORD_RAW,
      }),
    });

    const resJson = await createRes.json();
    if (createRes.ok || createRes.status === 409) {
      const userRes = await fetch(`${PROD_URL}/api/admin/users`, { headers: { Cookie: cookie } });
      const currentList = (await userRes.json()).users;
      const found = currentList.find((u: any) => u.email.toLowerCase() === tl.email.toLowerCase());
      if (found) {
        emailToId.set(tl.email.toLowerCase(), found.id);
        console.log(`   ✅ Team Lead ready on production: ${tl.firstName} (${tl.email}) [ID: ${found.id}]`);
      }
    } else {
      console.error(`   ❌ Failed to create ${tl.email}:`, resJson);
    }
  }

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

    const resJson = await createRes.json();
    if (createRes.ok) {
      console.log(`   ✅ SDR created on production: ${sdr.firstName} (${sdr.email}) -> Manager: ${sdr.managerEmail}`);
    } else if (createRes.status === 409) {
      console.log(`   ℹ️ SDR already exists on production: ${sdr.firstName} (${sdr.email})`);
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

  console.log('========================================================================');
  console.log(`🎉 LIVE PRODUCTION ROSTER (https://crm.telestar.cloud) — ${allFinalUsers.length} Users`);
  console.log('========================================================================\n');

  console.table(
    allFinalUsers.map((u: any) => ({
      email: u.email,
      name: u.name,
      role: u.role,
      active: u.isActive,
      manager: u.managerName ?? 'None',
    }))
  );
}

main().catch(console.error);
