#!/usr/bin/env node
/**
 * Gate 02: the services the ladder depends on are actually reachable.
 *
 * This exists because the previous runs "passed" while Redis was absent - the suites that
 * needed it skipped themselves, and a skipped suite reads as a green one in a summary. Proving
 * the dependency is present before the run starts turns that into a gate failure at the point
 * where it is still obvious what went wrong.
 *
 * Prints a JSON object and exits non-zero when anything required is missing.
 */
import net from 'node:net';

import { createAdminClient } from '../../lib/db/adminClient.mjs';

function checkTcp(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (reachable) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function main() {
  const report = { postgres: {}, redis: {}, configuration: {} };
  const problems = [];

  // Postgres: reachable AND answering, not merely listening.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    problems.push('DATABASE_URL is not set');
    report.postgres = { configured: false };
  } else {
    const url = new URL(databaseUrl);
    report.postgres = { host: url.hostname, port: url.port, database: url.pathname.slice(1) };
    const prisma = createAdminClient(databaseUrl);
    try {
      await prisma.$queryRaw`SELECT 1`;
      const [{ count }] = await prisma.$queryRawUnsafe(
        'SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL',
      );
      report.postgres.reachable = true;
      report.postgres.appliedMigrations = count;
    } catch (error) {
      report.postgres.reachable = false;
      report.postgres.error = error instanceof Error ? error.message : String(error);
      problems.push('Postgres is not answering queries');
    } finally {
      await prisma.$disconnect();
    }
  }

  // Redis: required. A ladder that runs without it is the defect this gate closes.
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    report.redis = { configured: false };
    problems.push('REDIS_URL is not set; the Redis-dependent gates cannot run');
  } else {
    const url = new URL(redisUrl);
    const port = Number(url.port || 6379);
    const reachable = await checkTcp(url.hostname, port);
    report.redis = { host: url.hostname, port, reachable };
    if (!reachable) problems.push(`Redis is not reachable at ${url.hostname}:${port}`);
  }

  // Configuration presence only. Never the values.
  for (const key of ['AUTH_SECRET', 'ENCRYPTION_KEY']) {
    const present = Boolean((process.env[key] || '').trim());
    report.configuration[key] = present ? 'present' : 'absent';
    if (!present) problems.push(`${key} is not configured`);
  }
  report.configuration.EMAIL_SEND_DRY_RUN = process.env.EMAIL_SEND_DRY_RUN ?? '(unset)';

  report.problems = problems;
  report.status = problems.length === 0 ? 'PASS' : 'FAIL';

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(problems.length === 0 ? 0 : 1);
}

void main();
