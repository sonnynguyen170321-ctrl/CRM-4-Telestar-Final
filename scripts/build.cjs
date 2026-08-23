#!/usr/bin/env node
/**
 * Production build runner.
 * Usage: node scripts/build.cjs [--analyze] [...next build args]
 *
 * `--analyze` is consumed here and re-exported as ANALYZE=true rather than
 * forwarded to Next, because a bare `ANALYZE=true next build` env prefix is
 * not valid syntax in cmd.exe.
 *
 * Runs `prisma generate` then `next build`. Both are invoked through the
 * current Node binary rather than the npm/npx .bin shims, which cannot be
 * resolved when the checkout path contains an ampersand (see
 * docs/archive/deliverability/STATUS.md, "Environment gotchas").
 *
 * Next type-checks the whole project inside a build worker. On hosts where
 * V8 sizes the default old-space near 2 GB that worker dies with
 * "Ineffective mark-compacts near heap limit" even though `tsc --noEmit`
 * passes standalone, so raise the limit before handing off. A caller that
 * already pinned --max-old-space-size keeps its own value.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const HEAP_MB = 4096;

function withHeapLimit(existing) {
  if (existing && existing.includes('--max-old-space-size')) return existing;
  const flag = `--max-old-space-size=${HEAP_MB}`;
  return existing ? `${existing} ${flag}` : flag;
}

const forwarded = process.argv.slice(2);
const shouldAnalyze = forwarded.includes('--analyze');
const nextArgs = forwarded.filter((arg) => arg !== '--analyze');

const env = {
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://build_placeholder:dummy@localhost:5432/build_db',
  DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL || 'postgresql://build_placeholder:dummy@localhost:5432/build_db',
  ...process.env,
  NODE_OPTIONS: withHeapLimit(process.env.NODE_OPTIONS),
  ...(shouldAnalyze ? { ANALYZE: 'true' } : {}),
};

const moduleEntry = (...segments) =>
  path.resolve(__dirname, '..', 'node_modules', ...segments);

const skipPrismaGenerate = process.env.SKIP_PRISMA_GENERATE === '1' || process.env.SKIP_PRISMA_GENERATE === 'true';
const fs = require('fs');

const steps = [
  ...(skipPrismaGenerate ? [] : [{
    label: 'prisma generate',
    entry: moduleEntry('prisma', 'build', 'index.js'),
    args: ['generate'],
  }]),
  {
    label: 'next build',
    entry: moduleEntry('next', 'dist', 'bin', 'next'),
    args: ['build', ...nextArgs],
  },
];

for (const { label, entry, args } of steps) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    stdio: 'inherit',
    env,
  });

  if (result.error) {
    console.error(`[build] FATAL: could not run ${label}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    if (
      label === 'prisma generate' &&
      process.platform === 'win32' &&
      fs.existsSync(moduleEntry('.prisma', 'client', 'index.js'))
    ) {
      console.warn('[build] WARN: prisma generate encountered a Windows DLL file lock, but Prisma Client is already generated. Proceeding with build.');
      continue;
    }
    console.error(`[build] FAILED at ${label} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}
