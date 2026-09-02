import { defineConfig } from 'vitest/config';

// Separate runner for `packages/*`.
//
// The root config points at `tests/**` and loads `tests/setup/db-baseline.ts`, which seeds a tenant
// against a live Postgres. Package code is deliberately database-agnostic, so making it share that
// config would mean a pure-logic test could not run without a database — and the first person to hit
// that would "fix" it by importing a Prisma client, which is exactly what the packages exist to avoid.
//
// No setupFiles, no env, no DB: if a test here needs one, the code under test is in the wrong place.
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
