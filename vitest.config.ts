import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Creates the `default-tenant` row that the tenant-scoped suites write against.
    // Without it they depend on whatever a developer last seeded — see the file header.
    setupFiles: ['tests/setup/db-baseline.ts'],
    // DB-context suites seed a tenant in beforeAll; a cold Neon connection can exceed
    // the 10s default, surfacing as a CI "failure". Give hooks/tests more headroom.
    hookTimeout: 30000,
    testTimeout: 20000,
    env: {
      // 127.0.0.1, not localhost. Docker publishes the port on both stacks — `docker port`
      // reports 0.0.0.0:5432 and [::]:5432 — but the IPv6 loopback answers ECONNREFUSED,
      // while 127.0.0.1 connects. Node resolves `localhost` to ::1 first, so every connection
      // is refused once and depends on the IPv4 fallback. That fallback usually wins, and
      // under the connection burst at suite startup it sometimes does not, surfacing as
      // "Can't reach database server at localhost:5432" from whichever file ran first.
      //
      // Measured: connect ::1:5432 -> ECONNREFUSED, connect 127.0.0.1:5432 -> ok, and the
      // failure arrived at 2075ms — far short of the 5s connect timeout, which is what a real
      // timeout would have looked like. `.claude/rules/data-prisma.md` already spells the
      // shadow database 127.0.0.1 for this reason; the test datasource had not caught up.
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/telestar_crm',
      DIRECT_URL: process.env.DIRECT_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/telestar_crm',
      // Test-only AES-256-GCM key for lib/crypto.ts. It protects nothing that outlives a
      // test process and has never guarded stored data. It looks random, so the secret
      // scan flags it — see the allowlist entry and its reasoning in `.gitleaks.toml`.
      ENCRYPTION_KEY: '6d64c7c6eea90808d36288f23843bf9d9f472c558deaa00c731107030a5b717b',
    },
  },
});
