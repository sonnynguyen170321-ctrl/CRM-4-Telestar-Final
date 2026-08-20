/**
 * Local capability detection (§XXII).
 *
 * Answers one question before an agent wastes an hour on it: **what can this machine actually
 * run?** A gate that cannot execute here is `BLOCKED_EXTERNAL`, which is a different thing
 * from a gate that failed — and an agent that does not know the difference will either chase a
 * phantom failure or, worse, report a skipped gate as a pass.
 *
 * Credentials are reported as SET / NOT SET. Never a value, a prefix, a suffix or a length —
 * a length is a meaningful hint about which provider issued a key.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { AI_PROVIDER_ENV } from '../../lib/env-contract';

const ROOT = process.cwd();

export type Availability = 'available' | 'unavailable';

export interface Capability {
  id: string;
  status: Availability;
  detail: string;
  /** What becomes unrunnable without it. */
  blocks: string[];
}

/**
 * Probe a command's version, tolerating Windows shims.
 *
 * On Windows `npm`, `gcloud` and friends are `.cmd` wrappers, not executables, so a bare
 * `execFileSync('npm')` throws ENOENT even where npm plainly works. Reporting "npm not
 * detected" on a machine that just ran `npm ci` is worse than not probing at all — an agent
 * would route around a capability it has. Each candidate name is tried in turn.
 */
function version(command: string, args: string[]): string | null {
  // Direct exec first. This is the correct path for a real executable, and it is the only
  // path that survives a command whose absolute path contains spaces — `process.execPath` is
  // `C:\Program Files\nodejs\node.exe` here, which a shell would split at the space.
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .split('\n')[0];
  } catch {
    // fall through
  }

  // Windows fallback: npm, gcloud and similar are `.cmd` batch wrappers, not executables, so
  // a direct exec throws ENOENT even where the tool plainly works. Reporting "npm not
  // detected" on a machine that just ran `npm ci` is worse than not probing — an agent would
  // route around a capability it has. Quoted as one string rather than passed as args, which
  // avoids the unescaped-argument deprecation.
  if (process.platform !== 'win32') return null;
  try {
    // Bare name, so the shell resolves it through PATH + PATHEXT and finds `npm.cmd` wherever
    // it actually lives. Hard-coding the `.cmd` suffix looks more precise and is less
    // reliable: the wrapper is not always on PATH under that exact name.
    return execSync(`${command} ${args.join(' ')}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')[0];
  } catch {
    return null;
  }
}

/** A TCP connect, because "the package is installed" is not "the service is listening". */
function portOpen(host: string, port: number, timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

function envPresent(name: string): boolean {
  if ((process.env[name] || '').trim().length > 0) return true;
  // A key in .env.local counts as configured for a local run, and reading only for presence
  // keeps this honest without the value ever entering memory as a value.
  const envFile = path.join(ROOT, '.env.local');
  if (!existsSync(envFile)) return false;
  const line = new RegExp(`^${name}\\s*=\\s*\\S`, 'm');
  return line.test(readFileSync(envFile, 'utf8'));
}

export async function capabilities(): Promise<Capability[]> {
  const out: Capability[] = [];

  const node = version(process.execPath, ['--version']);
  out.push({
    id: 'node',
    status: node ? 'available' : 'unavailable',
    detail: node ?? 'not detected',
    blocks: node ? [] : ['everything'],
  });

  const npm = version('npm', ['--version']);
  out.push({
    id: 'npm',
    status: npm ? 'available' : 'unavailable',
    detail: npm ? `npm ${npm}` : 'not detected',
    blocks: npm ? [] : ['dependency install'],
  });

  const docker = version('docker', ['--version']);
  out.push({
    id: 'docker',
    status: docker ? 'available' : 'unavailable',
    detail: docker ?? 'not installed',
    blocks: docker ? [] : ['docker build gate', 'compose topology smoke'],
  });

  const redis = await portOpen('127.0.0.1', 6379);
  out.push({
    id: 'redis',
    status: redis ? 'available' : 'unavailable',
    detail: redis ? 'listening on 6379' : 'nothing listening on 6379',
    blocks: redis ? [] : ['tests/redis-integration.test.ts', 'worker SIGTERM suite', 'queue integration'],
  });

  const postgres = await portOpen('127.0.0.1', 5432);
  out.push({
    id: 'postgres',
    status: postgres ? 'available' : 'unavailable',
    detail: postgres ? 'listening on 5432' : 'nothing listening on 5432',
    blocks: postgres ? [] : ['every database-backed Vitest suite', 'migration replay', 'e2e'],
  });

  const playwright = existsSync(path.join(ROOT, 'node_modules', '@playwright', 'test'));
  out.push({
    id: 'playwright',
    status: playwright ? 'available' : 'unavailable',
    detail: playwright ? 'installed' : 'not installed',
    blocks: playwright ? [] : ['all e2e'],
  });

  const gcloud = version('gcloud', ['--version']);
  out.push({
    id: 'gcloud',
    status: gcloud ? 'available' : 'unavailable',
    detail: gcloud ?? 'not installed',
    blocks: gcloud ? [] : ['production diagnostics', 'deployment'],
  });

  const gh = version('gh', ['--version']);
  out.push({
    id: 'github-cli',
    status: gh ? 'available' : 'unavailable',
    detail: gh ?? 'not installed',
    blocks: gh ? [] : ['CI status inspection', 'PR operations'],
  });

  // Presence only. Never a value, never a length.
  const configured = AI_PROVIDER_ENV.filter(envPresent);
  out.push({
    id: 'ai-providers',
    status: configured.length === AI_PROVIDER_ENV.length ? 'available' : 'unavailable',
    detail: AI_PROVIDER_ENV.map((k) => `${k}=${envPresent(k) ? 'SET' : 'NOT SET'}`).join(' '),
    blocks:
      configured.length === AI_PROVIDER_ENV.length
        ? []
        : ['live provider smoke (requires 3/3)', 'gateway smoke', 'provider-dependent chat e2e'],
  });

  return out;
}

/**
 * How to invoke tooling in *this* checkout.
 *
 * These are properties of the machine, not of the project, and they lived in `CLAUDE.md` where
 * every session paid for them whether or not it ran a command. They belong here: an agent
 * reads them at the moment it needs them, from the command whose job is to describe the
 * environment.
 */
export function executionNotes(): string[] {
  const notes: string[] = [];

  if (process.cwd().includes('&')) {
    notes.push(
      'The checkout path contains "&", which breaks npm and npx .bin shims — `npx tsc` ' +
        'resolves to a path that does not exist. Call entry scripts through node directly:',
      '    node node_modules/typescript/bin/tsc --noEmit',
      '    node node_modules/vitest/vitest.mjs run',
      '    node node_modules/eslint/bin/eslint.js .',
      '    node node_modules/tsx/dist/cli.mjs <script>',
      '    node ./node_modules/next/dist/bin/next dev',
      '  scripts/build.cjs already does this.',
    );
  }

  if (process.platform === 'win32') {
    notes.push(
      'tsc and next build need NODE_OPTIONS=--max-old-space-size=8192, or they exit 134 with ' +
        '"Ineffective mark-compacts near heap limit" — a heap limit, not a type error.',
      'prisma generate fails with EPERM on query_engine-windows.dll.node while another process ' +
        'holds the query engine. Stop the dev server and any running test process first.',
    );
  }

  notes.push('Capture a gate exit code from the tool itself; a pipe reports its last stage.');
  return notes;
}

export function renderCapabilities(caps: Capability[]): string {
  const lines: string[] = ['Local capability matrix', ''];
  const width = Math.max(...caps.map((c) => c.id.length));
  for (const cap of caps) {
    const mark = cap.status === 'available' ? 'ok  ' : 'MISS';
    lines.push(`  ${mark} ${cap.id.padEnd(width)}  ${cap.detail}`);
  }

  const blocked = caps.filter((c) => c.status === 'unavailable' && c.blocks.length > 0);
  if (blocked.length > 0) {
    lines.push('', 'BLOCKED_EXTERNAL here — not failures, and never reportable as passes:');
    for (const cap of blocked) {
      for (const blocked_item of cap.blocks) lines.push(`  - ${blocked_item}  (needs ${cap.id})`);
    }
  }

  const notes = executionNotes();
  if (notes.length > 0) {
    lines.push('', 'Running commands here:');
    for (const note of notes) lines.push(note.startsWith('    ') ? note : `  ${note}`);
  }

  return lines.join('\n');
}
