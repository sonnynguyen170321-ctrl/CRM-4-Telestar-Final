import { describe, it, expect, afterEach } from 'vitest';
import net from 'net';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  probePort,
  describePortConflict,
  serverHasExited,
  describeServerExit,
} from '../scripts/certification/lib/serverGuard.mjs';

/**
 * TEL-P1-039 — the ladder certified a server it did not start.
 *
 * Run 1 against candidate e968ce7 was executed while a `next dev` server was listening on port
 * 3000. What happened, in order:
 *
 *   1. the ladder's `next start -p 3000` died immediately:
 *      `⨯ Failed to start server / Error: listen EADDRINUSE: address already in use :::3000`
 *   2. nothing checked that the child had exited
 *   3. the readiness probe fetched `/login`, got 200 FROM THE DEV SERVER, and set ready = true
 *   4. gates 16 and 17 ran 30 Playwright tests against a development build and reported PASS
 *   5. gate 18 reported the worker ready
 *   6. gate 22 was the ONLY gate that failed — and only by accident, because a dev server has no
 *      APP_COMMIT and so reported `commit: "unknown"`
 *
 * Thirty browser tests produced a green result about code that was not the candidate. That is
 * worse than no evidence, because it looks like evidence. The same stray process also held the
 * Prisma query engine DLL open, which is what made gate 15 fail with
 * `EPERM ... rename query_engine-windows.dll.node`.
 *
 * Every test here is about refusing, not passing.
 */

const openSockets: net.Server[] = [];

afterEach(async () => {
  await Promise.all(
    openSockets.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

/** Occupy a port the way a stray dev server would, and return the port number. */
function occupyAPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    openSockets.push(server);
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('no port assigned'));
    });
  });
}

describe('probePort', () => {
  it('reports a free port as free', async () => {
    // Take a port, release it, then probe: guarantees a port nothing else grabbed in CI.
    const port = await occupyAPort();
    await new Promise<void>((resolve) => openSockets.pop()!.close(() => resolve()));
    expect(await probePort(port)).toEqual({ free: true });
  });

  it('reports an occupied port as not free, with EADDRINUSE', async () => {
    const port = await occupyAPort();
    const probe = await probePort(port);
    expect(probe.free).toBe(false);
    if (!probe.free) expect(probe.code).toBe('EADDRINUSE');
  });

  it('resolves rather than throwing, so a caller cannot forget to handle it', async () => {
    const port = await occupyAPort();
    await expect(probePort(port)).resolves.toBeTruthy();
  });
});

describe('describePortConflict', () => {
  it('says nothing when the port is free', () => {
    expect(describePortConflict(3000, { free: true })).toBeNull();
  });

  it('names the actual danger for a busy port, not just "busy"', () => {
    const message = describePortConflict(3000, { free: false, code: 'EADDRINUSE', message: 'x' });
    expect(message).toContain('3000');
    expect(message).toContain('next dev');
    // The operator has to understand that continuing would certify the wrong process.
    expect(message).toContain('certify that process rather than the candidate');
    expect(message).toContain('CERT_PORT');
  });

  it('distinguishes a permission problem from an occupied port', () => {
    const message = describePortConflict(80, { free: false, code: 'EACCES', message: 'denied' });
    expect(message).toContain('EACCES');
    expect(message).not.toContain('next dev');
  });

  it('still reports an unrecognised failure rather than returning null', () => {
    // Returning null here would read as "port is fine" and re-open the hole.
    const message = describePortConflict(3000, { free: false, code: 'EWEIRD', message: 'odd' });
    expect(message).toBeTruthy();
    expect(message).toContain('EWEIRD');
  });
});

describe('serverHasExited', () => {
  it('is false for a running child', () => {
    expect(serverHasExited({ exitCode: null, signalCode: null })).toBe(false);
  });

  it('is true once the child exits, including on success', () => {
    expect(serverHasExited({ exitCode: 0, signalCode: null })).toBe(true);
    expect(serverHasExited({ exitCode: 1, signalCode: null })).toBe(true);
  });

  it('is true when the child was signalled', () => {
    expect(serverHasExited({ exitCode: null, signalCode: 'SIGTERM' })).toBe(true);
  });
});

describe('describeServerExit', () => {
  it('quotes the decisive line from a bind failure', () => {
    // The exact output from run 1.
    const output = [
      '  ▲ Next.js 16.2.12',
      '⨯ Failed to start server',
      'Error: listen EADDRINUSE: address already in use :::3000',
      '    at <unknown> (Error: listen EADDRINUSE: address already in use :::3000)',
      "  code: 'EADDRINUSE',",
    ].join('\n');
    const message = describeServerExit({ exitCode: 1, signalCode: null }, output);
    expect(message).toContain('exited with code 1');
    expect(message).toContain('EADDRINUSE');
  });

  it('reports a signalled server as killed', () => {
    const message = describeServerExit({ exitCode: null, signalCode: 'SIGKILL' }, 'whatever');
    expect(message).toContain('killed by SIGKILL');
  });

  it('falls back to the last output line when nothing matches', () => {
    const message = describeServerExit({ exitCode: 7, signalCode: null }, 'first\nlast line here\n');
    expect(message).toContain('last line here');
  });

  it('says so plainly when there was no output at all', () => {
    expect(describeServerExit({ exitCode: 1, signalCode: null }, '')).toContain('(no output)');
    expect(describeServerExit({ exitCode: 1, signalCode: null }, undefined)).toContain('(no output)');
  });
});

describe('the ladder actually uses both guards', () => {
  const runner = readFileSync(
    join(process.cwd(), 'scripts', 'certification', 'run-full-certification.mjs'),
    'utf8',
  );
  const withServer = runner.slice(runner.indexOf('async function withServer'));
  const body = withServer.slice(0, withServer.indexOf('async function withWorker'));

  it('checks the port before spawning anything', () => {
    const probe = body.indexOf('probePort(SERVER_PORT)');
    const spawnAt = body.indexOf('spawn(process.execPath');
    expect(probe).toBeGreaterThan(-1);
    expect(spawnAt).toBeGreaterThan(-1);
    expect(probe).toBeLessThan(spawnAt);
  });

  it('throws on a conflict rather than warning and continuing', () => {
    expect(body).toContain('if (conflict) throw new Error(conflict)');
  });

  it('checks the child is alive inside the readiness loop', () => {
    const loop = body.slice(body.indexOf('while (Date.now() < deadline)'));
    expect(loop.slice(0, 400)).toContain('serverHasExited(server)');
  });

  it('re-checks liveness after the loop, closing the race', () => {
    // The child can die between the last check and a successful probe from a squatter.
    const afterLoop = body.slice(body.indexOf('did not become ready'));
    expect(afterLoop).toContain('serverHasExited(server)');
  });

  it('no longer treats any sub-500 response as proof the server is ours', () => {
    // The status check stays — it is fine — but it must not be the ONLY condition.
    expect(body).toContain('response.status < 500');
    expect(body.match(/serverHasExited\(server\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
