/**
 * The ladder must certify the server it started, and nothing else.
 *
 * Run 1 against candidate e968ce7 exposed how badly that could fail. A `next dev` server was
 * already listening on port 3000. The ladder's own `next start` died immediately with
 * `EADDRINUSE`, its readiness probe then got HTTP 200 from the DEV server, and the run carried
 * on: gates 16 and 17 executed 30 Playwright tests against a development build and reported
 * PASS. Gate 22 was the only thing that noticed, and only because the dev server reports
 * `commit: "unknown"` — an accident of that gate's design, not a check anybody had written.
 *
 * Certifying a process you did not start is worse than certifying nothing, because it produces
 * evidence. So:
 *
 *   - the port must be free BEFORE the server is spawned; a busy port is a hard failure, never
 *     something to probe around
 *   - the spawned process must still be alive when the readiness probe succeeds
 *
 * The same `next dev` also held the Prisma query engine DLL open, which is what made gate 15
 * fail with `EPERM ... rename query_engine-windows.dll.node`. One stray process, three
 * corrupted gates.
 */

import net from 'node:net';

/**
 * Is this port free for us to bind?
 *
 * Binds and releases rather than connecting: a port can refuse connections and still be
 * unbindable, and it is the bind that the server is about to attempt.
 *
 * Checks the same wildcard address Next binds (`::`, dual-stack), so a listener on IPv4-only
 * or IPv6-only is still detected.
 *
 * @returns {Promise<{free: true} | {free: false, code: string, message: string}>}
 */
export function probePort(port, { host } = {}) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => {
      resolve({
        free: false,
        code: error.code ?? 'UNKNOWN',
        message: error.message ?? String(error),
      });
    });
    server.once('listening', () => {
      server.close(() => resolve({ free: true }));
    });
    // No host argument means the wildcard address, which is what `next start -p N` uses.
    if (host) server.listen(port, host);
    else server.listen(port);
  });
}

/**
 * Turn a port probe into the message the operator needs.
 *
 * Deliberately blunt about what to do: the failure this replaces was silent, and an operator
 * who sees "port busy" without being told to stop the other process will simply re-run.
 */
export function describePortConflict(port, probe) {
  if (probe.free) return null;
  if (probe.code === 'EADDRINUSE') {
    return (
      `port ${port} is already in use, so the certification server cannot start. ` +
      `Something else — most often a \`next dev\` left running — would answer every gate ` +
      `instead, and the run would certify that process rather than the candidate build. ` +
      `Stop it, or set CERT_PORT to a free port, and re-run.`
    );
  }
  if (probe.code === 'EACCES') {
    return `port ${port} cannot be bound by this user (EACCES). Choose a port above 1024 via CERT_PORT.`;
  }
  return `port ${port} is not usable: ${probe.code} ${probe.message}`;
}

/**
 * Did the server we spawned die?
 *
 * `exitCode` is null while running and a number once exited; `signalCode` covers a kill.
 * Either means the readiness probe below is talking to somebody else's process.
 */
export function serverHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * Explain a server that exited before it was ready, quoting the decisive line.
 *
 * Next prints a long stack for a bind failure; the operator needs one line of it.
 */
export function describeServerExit(child, output) {
  const how =
    child.signalCode !== null
      ? `killed by ${child.signalCode}`
      : `exited with code ${child.exitCode}`;

  const text = String(output ?? '');
  const decisive =
    text.match(/^.*\b(EADDRINUSE|EACCES|EPERM|ENOENT|MODULE_NOT_FOUND)\b.*$/m)?.[0]?.trim() ??
    text.split('\n').map((line) => line.trim()).filter(Boolean).pop() ??
    '(no output)';

  return `certification server ${how} before becoming ready: ${decisive}`;
}
