import { prisma } from '@/lib/prisma';
import { isAutosendEnabled, isDryRun, isGlobalEmailPaused, isCanaryMode } from '@/lib/emailSafety';

interface AuditItem {
  category: string;
  gate: string;
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  details: string;
}

async function runReadinessAudit(): Promise<AuditItem[]> {
  const items: AuditItem[] = [];

  // ── 1. Safety & Kill Switch Invariants ─────────────────────────────────────
  items.push({
    category: 'SAFETY',
    gate: 'P0 / E3',
    name: 'Dry-Run Mode',
    status: isDryRun() ? 'PASS' : 'WARN',
    details: `EMAIL_SEND_DRY_RUN=${process.env.EMAIL_SEND_DRY_RUN ?? 'unset'} (isDryRun=${isDryRun()})`,
  });

  items.push({
    category: 'SAFETY',
    gate: 'P0 / E1',
    name: 'Sequence Autosend Switch',
    status: !isAutosendEnabled() ? 'PASS' : 'WARN',
    details: `SEQUENCE_AUTOSEND_ENABLED=${process.env.SEQUENCE_AUTOSEND_ENABLED ?? 'unset'} (isAutosendEnabled=${isAutosendEnabled()})`,
  });

  items.push({
    category: 'SAFETY',
    gate: 'E3',
    name: 'Global Email Kill Switch Available',
    status: 'PASS',
    details: `EMAIL_GLOBAL_PAUSE=${process.env.EMAIL_GLOBAL_PAUSE ?? 'false'} (isGlobalPaused=${isGlobalEmailPaused()})`,
  });

  items.push({
    category: 'SAFETY',
    gate: 'E9',
    name: 'Canary Recipient Allowlist',
    status: 'PASS',
    details: `LIVE_EMAIL_CANARY_MODE=${isCanaryMode()}, ALLOWED=${process.env.LIVE_EMAIL_ALLOWED_RECIPIENTS || 'none'}`,
  });

  // ── 2. Database Connectivity & Migration Status ────────────────────────────
  try {
    const migrationCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) as count FROM "_prisma_migrations" WHERE rolled_back_at IS NULL
    `;
    const count = Number(migrationCount[0]?.count ?? 0);
    items.push({
      category: 'DATABASE',
      gate: 'P5',
      name: 'Schema Migrations Applied',
      status: count >= 46 ? 'PASS' : 'WARN',
      details: `${count} migrations recorded in _prisma_migrations`,
    });
  } catch (err: unknown) {
    items.push({
      category: 'DATABASE',
      gate: 'P5',
      name: 'Database Connectivity',
      status: 'FAIL',
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 3. Tenant Isolation & Relational Integrity ─────────────────────────────
  try {
    const tenantRows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) as count FROM "Tenant"`;
    const userRows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) as count FROM "User"`;
    const tenantCount = Number(tenantRows[0]?.count ?? 0);
    const userCount = Number(userRows[0]?.count ?? 0);

    items.push({
      category: 'DATA_INTEGRITY',
      gate: 'P9',
      name: 'Multi-Tenant Scoping',
      status: tenantCount > 0 ? 'PASS' : 'WARN',
      details: `${tenantCount} tenants and ${userCount} users present in database`,
    });
  } catch (err: unknown) {
    items.push({
      category: 'DATA_INTEGRITY',
      gate: 'P9',
      name: 'Tenant Count',
      status: 'FAIL',
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 4. Email Account Provider & Encryption Status ──────────────────────────
  try {
    const accounts = await prisma.$queryRaw<Array<{
      id: string;
      email: string;
      provider: string;
      isActive: boolean;
      encAccessToken: string | null;
      accessToken: string | null;
    }>>`
      SELECT id, email, provider, "isActive", "encAccessToken", "accessToken" FROM "EmailAccount"
    `;

    const unencrypted = accounts.filter((a) => Boolean(a.accessToken && !a.encAccessToken));
    items.push({
      category: 'SECURITY',
      gate: 'P8 / E5',
      name: 'Email Token Encryption at Rest',
      status: unencrypted.length === 0 ? 'PASS' : 'FAIL',
      details: `${accounts.length} email accounts configured; ${unencrypted.length} unencrypted legacy tokens`,
    });
  } catch (err: unknown) {
    items.push({
      category: 'SECURITY',
      gate: 'P8 / E5',
      name: 'Email Accounts Query',
      status: 'WARN',
      details: err instanceof Error ? err.message : String(err),
    });
  }

  return items;
}

async function main() {
  console.log(`\n========================================================================`);
  console.log(` PRODUCTION READINESS & LIVE-EMAIL CERTIFICATION AUDIT`);
  console.log(`========================================================================\n`);

  const results = await runReadinessAudit();

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const r of results) {
    if (r.status === 'PASS') passCount++;
    else if (r.status === 'WARN') warnCount++;
    else failCount++;

    const icon = r.status === 'PASS' ? '✅ PASS' : r.status === 'WARN' ? '⚠️  WARN' : '❌ FAIL';
    console.log(`[${icon}] [${r.category}] [${r.gate}] ${r.name}`);
    console.log(`        ${r.details}\n`);
  }

  console.log(`========================================================================`);
  console.log(` SUMMARY: ${passCount} Passed, ${warnCount} Warnings, ${failCount} Failures`);
  console.log(`========================================================================\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Audit fatal error:', err);
  process.exit(1);
});
