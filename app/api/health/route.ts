import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readReleaseInfo } from '@/lib/release';
import { getMigrationStatus } from '@/lib/db/migrationStatus';

// Lightweight keep-alive endpoint. Runs a trivial `SELECT 1` to keep the Neon
// compute instance warm while the app is in active use, preventing the free-tier
// auto-suspend (5 min idle) that causes cold-start lag on the next query.
//
// Uses $queryRaw, which is a root client operation — it is NOT intercepted by the
// tenant RLS middleware (that only wraps model operations), so no tenant context
// is required and nothing sensitive is read or returned.

export const dynamic = 'force-dynamic';

export async function GET() {
  // Baked into the image at build time, so this reports what is actually running rather
  // than what a tag currently points at. The post-deploy smoke test compares this against
  // the commit that was deployed, and against the worker's.
  const release = readReleaseInfo();

  try {
    await prisma.$queryRaw`SELECT 1`;

    // `SELECT 1` succeeds against a database that is missing columns this build selects, so
    // reachability alone reported healthy after a deploy that skipped `prisma migrate deploy`
    // — while every protected request 500'd. Report schema readiness too, and fail the probe
    // when migrations are outstanding, so the post-deploy smoke test catches it first.
    const schema = await getMigrationStatus();
    if (schema.state === 'pending') {
      return NextResponse.json(
        {
          ok: false,
          reason: 'pending_migrations',
          pendingMigrations: schema.pending,
          hint: 'Run `prisma migrate deploy` against this database, then restart.',
          ts: Date.now(),
          commit: release.commit,
          version: release.version,
          builtAt: release.builtAt,
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      ok: true,
      ts: Date.now(),
      commit: release.commit,
      version: release.version,
      builtAt: release.builtAt,
      // 'unknown' when the check itself could not run; it never fails the probe on its own,
      // so a bug in the check cannot take down a healthy deployment.
      schema: schema.state,
    });
  } catch {
    // Still report identity on failure: "which build is broken" is the first question.
    return NextResponse.json({ ok: false, commit: release.commit }, { status: 503 });
  }
}
