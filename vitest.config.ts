import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "server-only": path.resolve(__dirname, "./test/server-only.ts"),
    },
  },
  test: {
    include: ["lib/v2/**/*.test.ts"],
    // Hydrate process.env from .env in each worker so modules that eagerly
    // init prisma (lib/server/prisma.ts) at import don't throw "DATABASE_URL
    // is required" — mirrors prisma.config.ts's own dotenv/config load.
    setupFiles: ["dotenv/config"],
  },
});
