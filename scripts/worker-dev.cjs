#!/usr/bin/env node
/**
 * Development worker runner.
 * Usage: node scripts/worker-dev.cjs [--watch]
 *
 * Starts the worker entry point with tsx (transpile-only), optionally under nodemon.
 *
 * This resolves tsx from node_modules and spawns it directly, for the same two reasons
 * `scripts/worker-start.cjs` does — and for a third that only bit here.
 *
 * `npx tsx` downloads tsx when it is not resolvable, so a runner that shells out to npx can
 * silently run a different version from the one package-lock.json pins.
 *
 * `shell: true` concatenates arguments rather than escaping them, which Node flags as DEP0190.
 *
 * And concatenation is not merely a warning when a path contains a shell metacharacter. This
 * repository lives at `C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final`, so the old
 * `spawn('npx', ['tsx', workerEntry], { shell: true })` was handed to cmd.exe as an unquoted
 * string and split at the `&`:
 *
 *     'AI\CRM-4-Telestar-Final\node_modules\.bin\' is not recognized as an internal or
 *      external command
 *     Error: Cannot find module 'C:\Users\admin\Desktop\tsx\dist\cli.mjs'
 *
 * `npm run worker:dev` could not start at all here, which is also why the `--watch` form built
 * its nodemon command by interpolating the path into a string: that has the same defect.
 */
const { spawn } = require('child_process');
const path = require('path');

const workerEntry = path.resolve(__dirname, '..', 'workers', 'index.ts');

let tsxCli;
try {
  tsxCli = require.resolve('tsx/cli');
} catch {
  console.error('[worker] FATAL: tsx is not installed. Run `npm ci`.');
  process.exit(1);
}

const useWatch = process.argv.includes('--watch');

let command;
let args;
if (useWatch) {
  let nodemonCli;
  try {
    nodemonCli = require.resolve('nodemon/bin/nodemon.js');
  } catch {
    console.error('[worker] FATAL: --watch needs nodemon, which is not installed. Run `npm ci`, or drop --watch.');
    process.exit(1);
  }
  // Each argument stays a separate array element, so a path with a space or an `&` in it is
  // passed through as one argument instead of being re-parsed by a shell.
  command = process.execPath;
  args = [nodemonCli, '--watch', path.resolve(__dirname, '..', 'workers'), '--ext', 'ts', '--exec', `${process.execPath} ${tsxCli} ${workerEntry}`];
} else {
  command = process.execPath;
  args = [tsxCli, workerEntry];
}

const child = spawn(command, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'development',
    IS_WORKER: 'true',
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
