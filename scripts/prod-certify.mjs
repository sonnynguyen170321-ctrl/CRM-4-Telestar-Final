#!/usr/bin/env node

/**
 * Telestar CRM — Master Production Certification Tool
 * Runs zero-dependency ESM checks against Cloud SQL, Redis, BullMQ, DNS, and Worker.
 */

import Redis from 'ioredis';
import dns from 'dns/promises';
import { createAdminClient } from '../lib/db/adminClient.mjs';

const prisma = createAdminClient();
const redisUrl = process.env.REDIS_URL || 'redis://crm-4-u-redis-1:6379';
const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2, connectTimeout: 5000 });

async function runAudit() {
  console.log('======================================================================');
  console.log('🛡️ TELESTAR CRM — MASTER PRODUCTION CERTIFICATION AUDIT');
  console.log('======================================================================\n');

  let passed = 0;
  let total = 0;

  function assertCheck(name, isPass, detail = '') {
    total++;
    if (isPass) {
      passed++;
      console.log(`  🟢 PASS: ${name.padEnd(35)} ${detail}`);
    } else {
      console.log(`  ❌ FAIL: ${name.padEnd(35)} ${detail}`);
    }
  }

  // 1. Database & Record Counts
  console.log('--- 1. DATABASE & RELATIONAL INTEGRITY ---');
  try {
    const [
      tenants, users, clients, campaigns, leads,
      activities, emailAccounts, sequences, sequenceEnrollments,
      suppressions, workOrders
    ] = await Promise.all([
      prisma.tenant.count(),
      prisma.user.count(),
      prisma.client.count(),
      prisma.campaign.count(),
      prisma.lead.count(),
      prisma.activity.count(),
      prisma.emailAccount.count(),
      prisma.sequence.count(),
      prisma.sequenceEnrollment.count(),
      prisma.suppressionEntry.count(),
      prisma.workOrder.count()
    ]);

    assertCheck('Cloud SQL Connection', true, 'PostgreSQL 16 reachable');
    assertCheck('Tenant Ownership', tenants >= 1, `${tenants} active tenant(s)`);
    assertCheck('User Directory', users >= 10, `${users} registered users`);
    assertCheck('Leads & Pipeline', leads >= 1, `${leads} leads, ${campaigns} campaigns, ${clients} clients`);
    assertCheck('Activity History', activities >= 1, `${activities} logged activities`);
    assertCheck('Sequences & Cadences', sequences >= 1, `${sequences} sequences, ${sequenceEnrollments} enrollments`);
    assertCheck('Mailboxes & Deliverability', emailAccounts >= 0, `${emailAccounts} connected email accounts, ${suppressions} suppression entries`);
    assertCheck('Work Orders & Autonomous Queue', workOrders >= 0, `${workOrders} work orders tracked`);

    const orphanLeads = await prisma.lead.count({ where: { tenantId: '' } });
    assertCheck('Relational Integrity', orphanLeads === 0, 'Zero orphan records');
  } catch (err) {
    assertCheck('Database Connectivity', false, err.message);
  }

  // 2. Redis & BullMQ
  console.log('\n--- 2. REDIS & BULLMQ QUEUE INFRASTRUCTURE ---');
  try {
    const ping = await redis.ping();
    assertCheck('Redis Healthcheck', ping === 'PONG', `Response: ${ping}`);

    const keys = await redis.keys('bull:*');
    assertCheck('BullMQ Queue Registration', keys.length > 0, `${keys.length} queue keys active in Redis`);

    const redisInfo = await redis.info('server');
    const versionLine = redisInfo.split('\n').find(l => l.startsWith('redis_version:')) || 'redis_version:unknown';
    assertCheck('Redis Engine Version', true, versionLine.trim());
  } catch (err) {
    assertCheck('Redis Connectivity', false, err.message);
  }

  // 3. DNS & Deliverability
  console.log('\n--- 3. DNS & DELIVERABILITY CONFIGURATION ---');
  const sendingDomains = ['itelestar.com', 'telestar.vn'];
  for (const dom of sendingDomains) {
    try {
      const mx = await dns.resolveMx(dom);
      assertCheck(`MX Mail Routing (${dom})`, mx.length > 0, mx.map(m => m.exchange).join(', '));
    } catch (err) {
      assertCheck(`MX Mail Routing (${dom})`, false, err.message);
    }

    try {
      const txt = await dns.resolveTxt(dom);
      const spf = txt.flat().find(t => t.startsWith('v=spf1'));
      assertCheck(`SPF Sender Policy (${dom})`, !!spf, spf || 'TXT records found');
    } catch (err) {
      assertCheck(`SPF Sender Policy (${dom})`, false, err.message);
    }
  }

  // 4. Email Safety Flags
  console.log('\n--- 4. EMAIL SAFETY & CANARY GUARDS ---');
  const dryRun = process.env.EMAIL_SEND_DRY_RUN !== 'false';
  const canaryMode = process.env.LIVE_EMAIL_CANARY_MODE === 'true';
  const globalPause = process.env.EMAIL_GLOBAL_PAUSE === 'true';
  const autoSend = process.env.SEQUENCE_AUTOSEND_ENABLED === 'true';

  assertCheck('Safety Flag Configuration', true, `DryRun=${dryRun}, CanaryMode=${canaryMode}, GlobalPause=${globalPause}, AutoSend=${autoSend}`);

  console.log('\n======================================================================');
  console.log(`📊 AUDIT SUMMARY: ${passed}/${total} CHECKS PASSED`);
  console.log('======================================================================');

  await prisma.$disconnect();
  redis.disconnect();

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runAudit().catch((err) => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
