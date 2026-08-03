import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // DB-context suites seed a tenant in beforeAll; a cold Neon connection can exceed
    // the 10s default, surfacing as a CI "failure". Give hooks/tests more headroom.
    hookTimeout: 30000,
    testTimeout: 20000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/telestar_crm',
      DIRECT_URL: process.env.DIRECT_URL || 'postgresql://postgres:postgres@localhost:5432/telestar_crm',
      ENCRYPTION_KEY: '6d64c7c6eea90808d36288f23843bf9d9f472c558deaa00c731107030a5b717b',
    },
  },
});
