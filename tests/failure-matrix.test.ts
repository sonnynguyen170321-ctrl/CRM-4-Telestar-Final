/**
 * Failure matrix: database connection loss and process shutdown (`DR-004`, `DR-010`).
 *
 * `FAILURE_MATRIX.md` described both scenarios and nothing executed either of them. A runbook
 * that says "the pool recovers" is a plan, not a result, and the failure it describes is
 * exactly the sort that only shows up in production.
 *
 * These do the real thing: a live Postgres backend is terminated underneath the application,
 * and a real worker process is sent SIGTERM.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const { prisma } = await import('@/lib/prisma');

const REPO_ROOT = path.resolve(__dirname, '..');

let hasDb = false;
try {
  if (process.env.DATABASE_URL) {
    await prisma.$queryRaw`SELECT 1`;
    hasDb = true;
  }
} catch {
  hasDb = false;
}

describe.skipIf(!hasDb)('DR-004: the database connection drops and the app recovers', () => {
  it('serves queries again after its own backend is terminated server-side', async () => {
    // Establish a connection and learn which backend is ours.
    const [before] = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    expect(before.pid).toBeGreaterThan(0);

    // Kill it from the outside, the way a failover, a restart, or an idle-timeout would.
    // pg_terminate_backend on our own pid is exactly the "connection vanished mid-flight"
    // condition, not a simulation of it.
    await prisma
      .$queryRawUnsafe(`SELECT pg_terminate_backend(${before.pid})`)
      .catch(() => undefined);

    // The next query must succeed. If the pool handed back a dead connection, or gave up,
    // this throws - which is the failure DR-004 exists to catch.
    let after: Array<{ pid: number }> = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        after = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    expect(after[0]?.pid).toBeGreaterThan(0);
    // A genuinely new backend, so recovery happened rather than the kill being a no-op.
    expect(after[0].pid).not.toBe(before.pid);
  }, 60_000);

  it('keeps serving after several consecutive terminations, and records how long it takes', async () => {
    // Recovery is not instant, and the first one is much slower than the rest. Measured on
    // the certification workstation: round 1 took ~15s and ~50 attempts, rounds 2 and 3 about
    // 370ms and 2 attempts. That asymmetry is the point of measuring rather than asserting a
    // round number — after a failover the first request can wait roughly fifteen seconds, and
    // an operator seeing that should know it is expected rather than a hang.
    //
    // The assertion is therefore "it recovers", with a window wide enough to be true rather
    // than lucky. A tighter bound would be a flake generator, and a bound chosen to match one
    // observation would be measuring this machine, not the property.
    const RECOVERY_BUDGET_MS = 30_000;
    const observed: number[] = [];

    // The probe has to BE the query whose result the next round consumes. Probing with
    // `SELECT 1` proved only that *a* connection answered at that instant, and each round then
    // opened with an unretried `pg_backend_pid()` — a bare query at the top of a loop whose
    // whole premise is that connections are being destroyed underneath it. Recovering and then
    // immediately issuing an unguarded query is the gap CI fell through on 2026-08-26, with
    // "Server has closed the connection" thrown from that line rather than from an assertion.
    const backendPid = async (budgetMs: number): Promise<number | null> => {
      const startedAt = Date.now();
      for (;;) {
        try {
          const [row] = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          return row.pid;
        } catch {
          if (Date.now() - startedAt >= budgetMs) return null;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    };

    let pid = await backendPid(RECOVERY_BUDGET_MS);
    expect(pid, 'no backend connection to begin with').not.toBeNull();

    for (let round = 0; round < 3; round += 1) {
      const killed = pid as number;
      await prisma
        .$queryRawUnsafe(`SELECT pg_terminate_backend(${killed})`)
        .catch(() => undefined);

      const startedAt = Date.now();
      pid = await backendPid(RECOVERY_BUDGET_MS);
      observed.push(Date.now() - startedAt);

      expect(
        pid,
        `did not recover within ${RECOVERY_BUDGET_MS / 1000}s after termination round ${round + 1}`,
      ).not.toBeNull();
      // A genuinely new backend, so recovery happened rather than the kill being a no-op.
      // The sibling test above asserts this; this one did not, so a kill that silently
      // stopped working would have gone on passing here.
      expect(pid).not.toBe(killed);
    }

    expect(observed).toHaveLength(3);
  }, 180_000);
});

describe('DR-010: the worker shuts down cleanly on SIGTERM', () => {
  /**
   * A worker that ignores SIGTERM is killed after the orchestrator's grace period, mid-job,
   * which is how a deploy turns into a stranded queue. This asserts it exits on its own.
   */
  it('exits on its own after SIGTERM rather than being killed', async () => {
    const worker = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'workers/index.ts'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        IS_WORKER: 'true',
        DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    worker.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    worker.stderr.on('data', (chunk) => {
      output += String(chunk);
    });

    // Attached HERE, before anything is awaited, and deliberately not after the wait below.
    //
    // `exit` fires once and is not replayed to a listener added afterwards. With no Redis to
    // attach to, `main()` rejects and the worker exits by itself in about seven seconds — so a
    // listener registered after the sixty-second wait attaches to a process that is already
    // gone, never resolves, and loses the race below. That reported
    // "worker did not exit within 30s of SIGTERM", which is the opposite of what happened: the
    // worker had exited promptly and unprompted. Ninety seconds of wall clock to produce a
    // diagnosis pointing at the wrong component.
    //
    // Read synchronously below to decide whether the wait is still worth doing. Held on an
    // object rather than in a bare `let` because control-flow analysis does not track
    // assignments made inside a callback: a plain `let` initialised to null narrows to `never`
    // at the check, and the compiler rejects reading `.code` off it.
    type WorkerExit = { code: number | null; signal: NodeJS.Signals | null };
    const state: { exit: WorkerExit | null } = { exit: null };
    const exited = new Promise<WorkerExit>((resolve) => {
      worker.on('exit', (code, signal) => {
        state.exit = { code, signal };
        resolve(state.exit);
      });
    });

    // Wait until it reports ready, so SIGTERM lands on a running worker rather than a
    // half-initialised one. Stop early if it dies first — there is nothing left to wait for.
    const readyDeadline = Date.now() + 60_000;
    while (Date.now() < readyDeadline && !state.exit && !/\[worker\] ready\b/.test(output)) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (state.exit) {
      // It exited before it was ever ready, so the SIGTERM contract was never exercised. Say
      // that, rather than sending a signal to a dead process and blaming the result on it.
      // Locally this means Redis: `agent doctor` reports whether anything is on 6379, and this
      // suite is BLOCKED_EXTERNAL without it. Failing is correct — a silent pass here would be
      // a green light on a shutdown path that was never run.
      throw new Error(
        `worker exited before becoming ready (code=${state.exit.code}, signal=${state.exit.signal}), ` +
          `so SIGTERM handling was never exercised. This is usually an unreachable Redis; ` +
          `check \`npm run agent -- doctor\`.\nOutput:\n${output.slice(-2000)}`
      );
    }

    worker.kill('SIGTERM');

    const outcome = await Promise.race([
      exited,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30_000)),
    ]);

    if (outcome === 'timeout') {
      worker.kill('SIGKILL');
      throw new Error(`worker did not exit within 30s of SIGTERM. Output:\n${output.slice(-2000)}`);
    }

    // Exiting at all is the requirement. A clean code or the signal itself are both fine;
    // hanging is not.
    expect(outcome.code === 0 || outcome.signal === 'SIGTERM' || outcome.code !== null).toBe(true);
  }, 120_000);

  it('does not leave the process hanging when it never became ready', async () => {
    // Same contract under a hostile environment: no Redis to attach to. It must still exit
    // rather than sit forever holding a deploy open.
    const worker = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'workers/index.ts'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        IS_WORKER: 'true',
        REDIS_URL: 'redis://127.0.0.1:6399',
        DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const exited = new Promise<boolean>((resolve) => {
      worker.on('exit', () => resolve(true));
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));
    worker.kill('SIGTERM');

    const finished = await Promise.race([
      exited,
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 30_000)),
    ]);

    if (!finished) worker.kill('SIGKILL');
    expect(finished, 'worker with an unreachable Redis did not exit on SIGTERM').toBe(true);
  }, 120_000);
});
