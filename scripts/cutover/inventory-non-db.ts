/**
 * Inventory Non-Database State (Section 29: Redis, BullMQ, Sessions, Integrations).
 *
 * Scans Redis queues and non-database state for demo residue:
 * - BullMQ active/waiting/delayed/failed jobs
 * - Email outbound queue
 * - Sequence scheduler queue
 * - Import queue
 * - Demo session keys
 */

import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const QUEUE_NAMES = [
  'email-outbound',
  'email-inbound',
  'sequence-execution',
  'maintenance',
  'lead-import',
  'notifications',
  'ai-evals',
] as const;

export interface NonDbInventory {
  scannedAt: string;
  redisFingerprint: string;
  queues: Record<
    string,
    {
      waiting: number;
      active: number;
      delayed: number;
      failed: number;
      completed: number;
      paused: boolean;
    }
  >;
  sessionKeysCount: number;
  demoResidueFound: boolean;
  sha256: string;
}

export async function scanNonDbState(): Promise<NonDbInventory> {
  console.log('🔍 Scanning Redis / BullMQ & Non-Database State...');
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  await redis.connect();

  const queuesSummary: NonDbInventory['queues'] = {};
  let totalJobs = 0;

  for (const qName of QUEUE_NAMES) {
    const q = new Queue(qName, { connection: redis });
    try {
      const [waiting, active, delayed, failed, completed, isPaused] = await Promise.all([
        q.getWaitingCount(),
        q.getActiveCount(),
        q.getDelayedCount(),
        q.getFailedCount(),
        q.getCompletedCount(),
        q.isPaused(),
      ]);

      queuesSummary[qName] = {
        waiting,
        active,
        delayed,
        failed,
        completed,
        paused: isPaused,
      };

      totalJobs += waiting + active + delayed;
    } finally {
      await q.close();
    }
  }

  // Check Redis keys for session tokens
  const sessionKeys = await redis.keys('session:*');
  const _rateLimitKeys = await redis.keys('rl:*');
  const demoKeys = await redis.keys('*demo*');

  const redisHost = REDIS_URL.replace(/:\/\/[^@]*@/, '://***@');

  const inventory: NonDbInventory = {
    scannedAt: new Date().toISOString(),
    redisFingerprint: redisHost,
    queues: queuesSummary,
    sessionKeysCount: sessionKeys.length,
    demoResidueFound: demoKeys.length > 0,
    sha256: '',
  };

  const serialized = JSON.stringify(inventory, null, 2);
  const hash = createHash('sha256').update(serialized).digest('hex');
  inventory.sha256 = hash;

  const outDir = path.join(process.cwd(), 'docs', 'production-cutover');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'non-db-inventory.json');
  writeFileSync(outPath, JSON.stringify(inventory, null, 2) + '\n');

  console.log(`✅ Redis/Queue scan complete: ${Object.keys(queuesSummary).length} queues inspected.`);
  console.log(`   - Pending/Active Jobs: ${totalJobs}`);
  console.log(`   - Active Sessions: ${sessionKeys.length}`);
  console.log(`   - Demo Keys Detected: ${demoKeys.length}`);
  console.log(`📄 Written to ${outPath} (SHA256: ${hash})`);

  await redis.quit();
  return inventory;
}

if (process.argv[1]?.endsWith('inventory-non-db.ts')) {
  scanNonDbState().catch((err) => {
    console.error('❌ Non-DB inventory error:', err.message);
    process.exit(1);
  });
}
