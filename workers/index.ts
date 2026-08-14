import { Worker } from 'bullmq';
import { getConnection, closeConnection } from '@/lib/bullmq/connection';
import { readReleaseInfo, describeRelease } from '@/lib/release';
import { closeAllQueues } from '@/lib/bullmq/queues';
import { createHealthcheckWorker, closeHealthcheck } from './healthcheck';
import { createSequenceWorker } from './sequence';
import { createEmailWorker } from './email';
import { createNotificationWorker } from './notification';
import { createMaintenanceWorker } from './maintenance';
import { createSyncWorker } from './sync';
import { createImportWorker } from './import';
import { createAgentWorker } from './agent';

const workers: Worker[] = [];

function registerWorkers(): void {
  // First line in the log names the build. A worker that silently runs a different image
  // from web is the failure mode immutable tags exist to prevent, and this is how an
  // operator sees it without shelling into the container.
  console.log(`[worker] ${describeRelease(readReleaseInfo())}`);

  const list = [
    { name: 'healthcheck', worker: createHealthcheckWorker() },
    { name: 'sequence', worker: createSequenceWorker() },
    { name: 'email', worker: createEmailWorker() },
    { name: 'notification', worker: createNotificationWorker() },
    { name: 'maintenance', worker: createMaintenanceWorker() },
    { name: 'sync', worker: createSyncWorker() },
    { name: 'import', worker: createImportWorker() },
    { name: 'agent', worker: createAgentWorker() },
  ];

  for (const { name, worker } of list) {
    worker.on('error', (err) => {
      console.error(`[worker] ${name} error:`, err);
    });
    workers.push(worker);
    console.log(`[worker] registered: ${name}`);
  }
}

function attachSignals(): void {
  const shutdown = async (signal: string) => {
    console.log(`[worker] received ${signal}, shutting down...`);
    await Promise.allSettled(workers.map((w) => w.close()));
    await closeHealthcheck();
    await closeAllQueues();
    await closeConnection();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('[worker] unhandled rejection:', reason);
  });
}

async function main(): Promise<void> {
  console.log('[worker] starting...');
  console.log(`[worker] NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`[worker] REDIS_URL=${process.env.REDIS_URL ? 'set' : 'not set'}`);
  console.log(`[worker] DIRECT_URL=${process.env.DIRECT_URL ? 'set' : 'not set'}`);

  getConnection();
  registerWorkers();
  attachSignals();

  await Promise.all(
    workers.map(async (worker) => {
      await worker.waitUntilReady();
      console.log(`[worker] ready: ${worker.name}`);
    })
  );

  console.log('[worker] ready');
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
