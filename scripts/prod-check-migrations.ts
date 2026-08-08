/**
 * Pre-deploy gate: refuse to proceed when the database is behind the code.
 *
 * `docker compose up -d` starts web and worker regardless of schema state, so the ordering in
 * the runbook — migrate, then start — was enforced only by the operator remembering it. When
 * it is missed the symptom is a Prisma "column does not exist" error on every authenticated
 * request, which does not mention migrations and sends you looking in the wrong place.
 *
 * Usage (on the box, before `up -d`):
 *   docker compose --env-file .env.production run --rm web npm run prod:check-migrations
 *
 * Exits 0 when the schema is ready, 1 when migrations are pending or the check cannot run.
 */
import { getMigrationStatus } from '@/lib/db/migrationStatus';
import { prisma } from '@/lib/prisma';

async function main() {
  const status = await getMigrationStatus();

  if (status.state === 'ready') {
    console.log('✓ Database schema is up to date. Safe to start containers.');
    return 0;
  }

  if (status.state === 'pending') {
    console.error(`✗ ${status.pending.length} migration(s) are not applied to this database:`);
    for (const name of status.pending) console.error(`    - ${name}`);
    console.error('');
    console.error('Starting the app now would 500 on every request that touches the new schema.');
    console.error('Take a manual database backup first, then:');
    console.error('  docker compose --env-file .env.production run --rm web npx prisma migrate deploy');
    return 1;
  }

  console.error(`✗ Could not determine schema state: ${status.reason ?? 'unknown'}`);
  console.error('Refusing to report ready. Check DATABASE_URL and database connectivity.');
  return 1;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error('prod-check-migrations failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
