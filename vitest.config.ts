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
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/telestar_crm',
      DIRECT_URL: process.env.DIRECT_URL || 'postgresql://postgres:postgres@localhost:5432/telestar_crm',
      // Test-only AES-256-GCM key for lib/crypto.ts. It protects nothing that outlives a
      // test process and has never guarded stored data. It looks random, so the secret
      // scan flags it — see the allowlist entry and its reasoning in `.gitleaks.toml`.
      ENCRYPTION_KEY: '6d64c7c6eea90808d36288f23843bf9d9f472c558deaa00c731107030a5b717b',
    },
  },
});
