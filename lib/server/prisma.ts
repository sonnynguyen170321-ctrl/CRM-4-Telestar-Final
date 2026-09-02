import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: InstanceType<typeof PrismaClient>;
};

// Pool sized to cover worker concurrency (network-bound enrichment runs ~12-20 jobs at
// once). Keep V2_DB_POOL_MAX * process_count under Postgres max_connections (local ~100;
// on RDS size to the instance). Default 24 gives headroom over the default enrich concurrency.
const adapter = new PrismaPg({
  connectionString: getDatabaseUrl(),
  max: poolMax(),
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to initialize Prisma.");
  }

  return databaseUrl;
}

function poolMax() {
  const n = Number(process.env.V2_DB_POOL_MAX);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 24;
}
