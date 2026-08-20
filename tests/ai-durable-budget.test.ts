/**
 * Durable, shared AI budget governance (TEL-P1-015).
 *
 * The previous budget lived in two in-process `Map`s. Every test that could be written
 * against it passed, and the budget still did not exist in any meaningful sense: a restart
 * forgot the month's spend, and a second replica started again from zero. These tests are
 * written specifically to fail against that design.
 *
 * The decisive one spawns real child processes. An in-process `Promise.all` shares the same
 * module instance, so it cannot distinguish a durable ledger from a Map — only separate
 * operating-system processes can.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AiBudgetExceededError,
  checkAndReserveAiBudget,
  clearBudgetReservations,
  currentPeriodKey,
  getTenantBudgetState,
  getTenantCurrentSpend,
  microsToUsd,
  setTenantCurrentSpend,
  setTenantMonthlyLimit,
  sweepExpiredReservations,
  usdToMicros,
} from '@/lib/ai/budget';
import { prisma } from '@/lib/prisma';

const execFileAsync = promisify(execFile);

const TENANT = 'tenant-durable-budget-test';
const REPO_ROOT = path.resolve(__dirname, '..');
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/telestar_crm';

async function ensureTenant() {
  await prisma.$executeRaw`
    INSERT INTO "Tenant" ("id", "name", "createdAt", "updatedAt")
    VALUES (${TENANT}, 'Durable Budget Test', NOW(), NOW())
    ON CONFLICT ("id") DO NOTHING
  `;
}

async function setLimitUsd(limitUsd: number, periodKey = currentPeriodKey()) {
  await setTenantMonthlyLimit(TENANT, limitUsd, periodKey);
}

async function heldReservationCount(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM "TenantAiBudgetReservation"
    WHERE "tenantId" = ${TENANT} AND "status" = 'held'
  `;
  return Number(rows[0].count);
}

beforeEach(async () => {
  await ensureTenant();
  await clearBudgetReservations(TENANT);
});

afterAll(async () => {
  await clearBudgetReservations(TENANT);
  await prisma.$executeRaw`DELETE FROM "Tenant" WHERE "id" = ${TENANT}`;
});

describe('money is held as integers', () => {
  it('converts USD to micro-dollars without floating point drift', () => {
    expect(usdToMicros(0.1) + usdToMicros(0.2)).toBe(usdToMicros(0.3));
    expect(microsToUsd(usdToMicros(12.345678))).toBeCloseTo(12.345678, 6);
  });

  it('accumulates thousands of small amounts exactly', () => {
    let total = usdToMicros(0);
    for (let i = 0; i < 10_000; i += 1) total += usdToMicros(0.0001);

    // The float equivalent of this loop does not land on 1 exactly.
    expect(total).toBe(usdToMicros(1));
  });
});

describe('budget state survives the process that created it', () => {
  it('reads spend back from the database, not from memory', async () => {
    await setTenantCurrentSpend(TENANT, 12.5);

    const rows = await prisma.$queryRaw<Array<{ usedMicros: bigint }>>`
      SELECT "usedMicros" FROM "TenantAiBudgetPeriod"
      WHERE "tenantId" = ${TENANT} AND "periodKey" = ${currentPeriodKey()}
    `;

    expect(rows).toHaveLength(1);
    expect(microsToUsd(rows[0].usedMicros)).toBeCloseTo(12.5, 6);
    expect(await getTenantCurrentSpend(TENANT)).toBeCloseTo(12.5, 6);
  });

  it('a fresh process observes spend recorded by an earlier one', async () => {
    await setLimitUsd(10);
    await setTenantCurrentSpend(TENANT, 9.99);

    // A separate process, with its own empty module state, must still be refused.
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'scripts/certification/ai-budget-contender.ts',
        '--tenant',
        TENANT,
        '--period',
        currentPeriodKey(),
        '--estimate',
        '5',
      ],
      { cwd: REPO_ROOT, env: { ...process.env, DATABASE_URL } },
    );

    expect(JSON.parse(stdout.trim().split('\n').pop() as string).outcome).toBe('refused');
  }, 120_000);
});

describe('the cap holds across genuinely parallel processes', () => {
  it('lets exactly as many concurrent processes through as the budget affords', async () => {
    // Limit 5, ten processes each reserving 1. Exactly five may win.
    await setLimitUsd(5);
    await setTenantCurrentSpend(TENANT, 0);

    const contenders = Array.from({ length: 10 }, () =>
      execFileAsync(
        process.execPath,
        [
          'node_modules/tsx/dist/cli.mjs',
          'scripts/certification/ai-budget-contender.ts',
          '--tenant',
          TENANT,
          '--period',
          currentPeriodKey(),
          '--estimate',
          '1',
        ],
        { cwd: REPO_ROOT, env: { ...process.env, DATABASE_URL } },
      ),
    );

    const results = await Promise.all(contenders);
    const outcomes = results.map(
      (result) => JSON.parse(result.stdout.trim().split('\n').pop() as string).outcome,
    );

    expect(outcomes.filter((outcome) => outcome === 'reserved')).toHaveLength(5);
    expect(outcomes.filter((outcome) => outcome === 'refused')).toHaveLength(5);
    expect(outcomes.filter((outcome) => outcome === 'error')).toHaveLength(0);

    // And the ledger agrees: reserved never exceeded the cap.
    const state = await getTenantBudgetState(TENANT);
    expect(state.reservedUsd).toBeCloseTo(5, 6);
    expect(state.usedUsd + state.reservedUsd).toBeLessThanOrEqual(state.limitUsd);
  }, 180_000);

  it('never lets concurrent in-process reservations exceed the cap', async () => {
    await setLimitUsd(3);
    await setTenantCurrentSpend(TENANT, 0);

    const attempts = await Promise.allSettled(
      Array.from({ length: 30 }, () =>
        checkAndReserveAiBudget({ tenantId: TENANT, estimatedCostUsd: 1, operation: 'burst' }),
      ),
    );

    const granted = attempts.filter((attempt) => attempt.status === 'fulfilled');
    expect(granted).toHaveLength(3);

    const state = await getTenantBudgetState(TENANT);
    expect(state.usedUsd + state.reservedUsd).toBeLessThanOrEqual(state.limitUsd);
  }, 60_000);
});

describe('reservation settlement', () => {
  it('reconciles at the actual cost, not the estimate', async () => {
    await setLimitUsd(50);
    await setTenantCurrentSpend(TENANT, 0);

    const reservation = await checkAndReserveAiBudget({
      tenantId: TENANT,
      estimatedCostUsd: 1.0,
      operation: 'generate',
    });
    await reservation?.reconcile(0.25);

    const state = await getTenantBudgetState(TENANT);
    expect(state.usedUsd).toBeCloseTo(0.25, 6);
    expect(state.reservedUsd).toBeCloseTo(0, 6);
  });

  it('returns the full hold when released unspent', async () => {
    await setLimitUsd(50);
    await setTenantCurrentSpend(TENANT, 0);

    const reservation = await checkAndReserveAiBudget({ tenantId: TENANT, estimatedCostUsd: 2 });
    await reservation?.release();

    const state = await getTenantBudgetState(TENANT);
    expect(state.usedUsd).toBeCloseTo(0, 6);
    expect(state.reservedUsd).toBeCloseTo(0, 6);
  });

  it('settles a hold exactly once even if reconcile is called twice', async () => {
    await setLimitUsd(50);
    await setTenantCurrentSpend(TENANT, 0);

    const reservation = await checkAndReserveAiBudget({ tenantId: TENANT, estimatedCostUsd: 1 });
    await reservation?.reconcile(0.5);
    await reservation?.reconcile(0.5);
    await reservation?.release();

    const state = await getTenantBudgetState(TENANT);
    expect(state.usedUsd).toBeCloseTo(0.5, 6);
    expect(state.reservedUsd).toBeCloseTo(0, 6);
  });

  it('refuses a reservation that would cross the cap', async () => {
    await setLimitUsd(10);
    await setTenantCurrentSpend(TENANT, 9.99);

    await expect(
      checkAndReserveAiBudget({ tenantId: TENANT, estimatedCostUsd: 0.5, operation: 'chat' }),
    ).rejects.toThrow(AiBudgetExceededError);
  });

  it('lets essential operations through at the cap but still records them', async () => {
    await setLimitUsd(10);
    await setTenantCurrentSpend(TENANT, 10);

    const reservation = await checkAndReserveAiBudget({
      tenantId: TENANT,
      estimatedCostUsd: 0.5,
      isEssential: true,
      operation: 'critical',
    });

    expect(reservation).not.toBeNull();
    expect(await heldReservationCount()).toBe(1);
    await reservation?.release();
  });

  it('returns null without a tenant, so untenanted callers are not billed to anyone', async () => {
    expect(await checkAndReserveAiBudget({ estimatedCostUsd: 1 })).toBeNull();
  });
});

describe('stranded holds are recovered', () => {
  it('expires a hold past its TTL and returns the budget', async () => {
    await setLimitUsd(5);
    await setTenantCurrentSpend(TENANT, 0);

    await checkAndReserveAiBudget({ tenantId: TENANT, estimatedCostUsd: 4, operation: 'abandoned' });
    expect((await getTenantBudgetState(TENANT)).reservedUsd).toBeCloseTo(4, 6);

    // Simulate the caller's process dying: the hold outlives its expiry.
    await prisma.$executeRaw`
      UPDATE "TenantAiBudgetReservation"
      SET "expiresAt" = NOW() - INTERVAL '1 hour'
      WHERE "tenantId" = ${TENANT} AND "status" = 'held'
    `;

    const swept = await sweepExpiredReservations();

    expect(swept).toBeGreaterThanOrEqual(1);
    expect((await getTenantBudgetState(TENANT)).reservedUsd).toBeCloseTo(0, 6);
  });

  it('repairs a reserved total that drifted from the held rows', async () => {
    await setLimitUsd(20);
    await setTenantCurrentSpend(TENANT, 0);
    await checkAndReserveAiBudget({ tenantId: TENANT, estimatedCostUsd: 2 });

    // An interrupted claim leaves the period over-reserved with no matching row.
    await prisma.$executeRaw`
      UPDATE "TenantAiBudgetPeriod"
      SET "reservedMicros" = "reservedMicros" + ${usdToMicros(7)}
      WHERE "tenantId" = ${TENANT} AND "periodKey" = ${currentPeriodKey()}
    `;
    expect((await getTenantBudgetState(TENANT)).reservedUsd).toBeCloseTo(9, 6);

    await prisma.$executeRaw`
      UPDATE "TenantAiBudgetReservation"
      SET "expiresAt" = NOW() - INTERVAL '1 hour'
      WHERE "tenantId" = ${TENANT} AND "status" = 'held'
    `;
    await sweepExpiredReservations();

    // The sweep recomputes from surviving held rows, so the phantom 7 is gone.
    expect((await getTenantBudgetState(TENANT)).reservedUsd).toBeCloseTo(0, 6);
  });
});
