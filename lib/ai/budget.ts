/**
 * Durable, shared AI budget governance (TEL-P1-011, corrected by TEL-P1-015).
 *
 * The previous implementation held budget state in two in-process `Map`s. That is not a
 * budget:
 *
 *   - restarting a process forgot every dollar already spent, so the cap reset to zero;
 *   - a second web replica started from zero as well, so N replicas could each spend the
 *     full limit;
 *   - the worker never saw the web tier's reservations at all.
 *
 * Truth now lives in `TenantAiBudgetPeriod` / `TenantAiBudgetReservation`.
 *
 * ## Why the cap actually holds under concurrency
 *
 * Reservation is a **single-statement conditional UPDATE** carrying the limit test in its
 * WHERE clause. Postgres holds a row lock for the statement's duration, so simultaneous
 * reservers serialise on that row: each either fits under the limit or matches zero rows and
 * is refused. There is no read-then-write window to lose a race in, and it needs no
 * interactive transaction - which matters, because the Neon HTTP driver has none.
 *
 * ## Why integers
 *
 * Amounts are micro-dollars (USD x 1_000_000) in `BigInt`. Floating-point money drifts across
 * thousands of small calls, and a spend cap is the last place to accept that. `AiCall.
 * estimatedCostUsd` is `Decimal(12,6)`, which micro-dollars represent exactly.
 *
 * ## Failure direction
 *
 * Every partial-failure path leaves the period *over*-reserved rather than under-reserved:
 * an interrupted settlement denies spend instead of permitting overspend. `sweepExpired
 * Reservations` then repairs the total from the surviving `held` rows, so inflation is
 * temporary and self-healing.
 */

import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/prisma';

export const MICROS_PER_USD = 1_000_000;

/** Default hold lifetime. A crashed caller cannot strand budget for longer than this. */
const RESERVATION_TTL_MS = 5 * 60 * 1000;

/** Conservative default estimate when a caller does not supply one. */
const DEFAULT_ESTIMATE_USD = 0.005;

const DEFAULT_MONTHLY_LIMIT_USD = 50.0;

export class AiBudgetExceededError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly currentSpendUsd: number,
    public readonly monthlyLimitUsd: number,
    public readonly operation?: string,
  ) {
    super(
      `AI Budget exceeded for tenant ${tenantId}: current spend $${currentSpendUsd.toFixed(4)} + reserved exceeds limit $${monthlyLimitUsd.toFixed(2)} (operation: ${operation || 'unknown'})`,
    );
    this.name = 'AiBudgetExceededError';
  }
}

export function usdToMicros(usd: number): bigint {
  if (!Number.isFinite(usd)) return BigInt(0);
  return BigInt(Math.round(usd * MICROS_PER_USD));
}

export function microsToUsd(micros: bigint): number {
  return Number(micros) / MICROS_PER_USD;
}

/** UTC calendar month key, `YYYY-MM`. */
export function currentPeriodKey(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Configured hard cap. Per-tenant overrides belong here when they exist. */
export function getTenantMonthlyLimit(_tenantId: string): number {
  const configured = process.env.AI_MONTHLY_BUDGET_USD;
  if (configured) {
    const parsed = Number.parseFloat(configured);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_MONTHLY_LIMIT_USD;
}

interface PeriodRow {
  id: string;
  limitMicros: bigint;
  usedMicros: bigint;
  reservedMicros: bigint;
}

function periodBounds(periodKey: string): { start: Date; end: Date } {
  const [year, month] = periodKey.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

/**
 * Returns the period row, creating it if absent.
 *
 * On creation `usedMicros` is seeded from the `AiCall` ledger for the same month, so a
 * tenant's first call after a deploy does not start from zero and hand back a month's worth
 * of already-spent budget.
 */
export async function ensureBudgetPeriod(
  tenantId: string,
  periodKey: string = currentPeriodKey(),
): Promise<PeriodRow> {
  const limitMicros = usdToMicros(getTenantMonthlyLimit(tenantId));
  const { start, end } = periodBounds(periodKey);

  await prisma.$executeRaw`
    INSERT INTO "TenantAiBudgetPeriod"
      ("id", "tenantId", "periodKey", "limitMicros", "usedMicros", "reservedMicros", "createdAt", "updatedAt")
    SELECT
      ${randomUUID()}, ${tenantId}, ${periodKey}, ${limitMicros},
      COALESCE((
        SELECT ROUND(SUM("estimatedCostUsd") * ${MICROS_PER_USD})
        FROM "AiCall"
        WHERE "tenantId" = ${tenantId}
          AND "createdAt" >= ${start}
          AND "createdAt" < ${end}
      ), 0),
      0, NOW(), NOW()
    ON CONFLICT ("tenantId", "periodKey") DO NOTHING
  `;

  // The stored cap is deliberately NOT re-synced from configuration on every call.
  //
  // Doing so would make the period row's limit unwritable: any per-tenant or administrative
  // cap would be silently reverted to the environment default on the very next reservation,
  // and the cap would appear to work while enforcing a number nobody set. A monthly cap is
  // also a commitment for that month - rewriting it mid-period changes history. Configuration
  // changes therefore apply to periods created after them; to change the current period, call
  // `setTenantMonthlyLimit` explicitly.

  const rows = await prisma.$queryRaw<PeriodRow[]>`
    SELECT "id", "limitMicros", "usedMicros", "reservedMicros"
    FROM "TenantAiBudgetPeriod"
    WHERE "tenantId" = ${tenantId} AND "periodKey" = ${periodKey}
  `;
  if (rows.length === 0) {
    throw new Error(`Failed to establish AI budget period ${periodKey} for tenant ${tenantId}`);
  }
  return rows[0];
}

export interface TenantBudgetState {
  periodKey: string;
  limitUsd: number;
  usedUsd: number;
  reservedUsd: number;
  availableUsd: number;
}

export async function getTenantBudgetState(
  tenantId: string,
  periodKey: string = currentPeriodKey(),
): Promise<TenantBudgetState> {
  const period = await ensureBudgetPeriod(tenantId, periodKey);
  const limitUsd = microsToUsd(period.limitMicros);
  const usedUsd = microsToUsd(period.usedMicros);
  const reservedUsd = microsToUsd(period.reservedMicros);
  return {
    periodKey,
    limitUsd,
    usedUsd,
    reservedUsd,
    availableUsd: Math.max(0, limitUsd - usedUsd - reservedUsd),
  };
}

/** Settled spend for the period, in USD. */
export async function getTenantCurrentSpend(
  tenantId: string,
  periodKey: string = currentPeriodKey(),
): Promise<number> {
  const period = await ensureBudgetPeriod(tenantId, periodKey);
  return microsToUsd(period.usedMicros);
}

/** Held, not yet settled, in USD. */
export async function getTenantReservedSpend(
  tenantId: string,
  periodKey: string = currentPeriodKey(),
): Promise<number> {
  const period = await ensureBudgetPeriod(tenantId, periodKey);
  return microsToUsd(period.reservedMicros);
}

/**
 * Sets the hard cap for a period explicitly.
 *
 * This is the only way to change a cap for a period that already exists - see the note in
 * `ensureBudgetPeriod` about why configuration does not silently overwrite it.
 */
export async function setTenantMonthlyLimit(
  tenantId: string,
  limitUsd: number,
  periodKey: string = currentPeriodKey(),
): Promise<void> {
  await ensureBudgetPeriod(tenantId, periodKey);
  await prisma.$executeRaw`
    UPDATE "TenantAiBudgetPeriod"
    SET "limitMicros" = ${usdToMicros(Math.max(0, limitUsd))}, "updatedAt" = NOW()
    WHERE "tenantId" = ${tenantId} AND "periodKey" = ${periodKey}
  `;
}

/** Sets settled spend directly. Test and administrative correction only. */
export async function setTenantCurrentSpend(
  tenantId: string,
  spendUsd: number,
  periodKey: string = currentPeriodKey(),
): Promise<void> {
  await ensureBudgetPeriod(tenantId, periodKey);
  await prisma.$executeRaw`
    UPDATE "TenantAiBudgetPeriod"
    SET "usedMicros" = ${usdToMicros(Math.max(0, spendUsd))}, "updatedAt" = NOW()
    WHERE "tenantId" = ${tenantId} AND "periodKey" = ${periodKey}
  `;
}

export interface ReserveBudgetOptions {
  tenantId?: string;
  estimatedCostUsd?: number;
  operation?: string;
  isEssential?: boolean;
  periodKey?: string;
}

export interface BudgetReservation {
  reservationId: string;
  tenantId: string;
  periodKey: string;
  estimatedCostUsd: number;
  /** Settles the hold at the actual cost. */
  reconcile: (actualCostUsd: number) => Promise<void>;
  /** Returns the hold unspent. */
  release: () => Promise<void>;
}

/**
 * Atomically reserves budget before a provider is called.
 *
 * Throws `AiBudgetExceededError` when the reservation would carry the tenant past its cap.
 * Essential operations reserve without the cap test but are still recorded, so their spend
 * remains visible.
 */
export async function checkAndReserveAiBudget(
  opts: ReserveBudgetOptions,
): Promise<BudgetReservation | null> {
  const {
    tenantId,
    estimatedCostUsd = DEFAULT_ESTIMATE_USD,
    operation,
    isEssential = false,
    periodKey = currentPeriodKey(),
  } = opts;

  if (!tenantId) return null;

  const amountMicros = usdToMicros(Math.max(0, estimatedCostUsd));
  const period = await ensureBudgetPeriod(tenantId, periodKey);

  // The gate. One statement, so concurrent callers serialise on the row lock and the sum
  // can never cross the limit regardless of how many processes race here.
  const claimed = isEssential
    ? await prisma.$executeRaw`
        UPDATE "TenantAiBudgetPeriod"
        SET "reservedMicros" = "reservedMicros" + ${amountMicros}, "updatedAt" = NOW()
        WHERE "id" = ${period.id}
      `
    : await prisma.$executeRaw`
        UPDATE "TenantAiBudgetPeriod"
        SET "reservedMicros" = "reservedMicros" + ${amountMicros}, "updatedAt" = NOW()
        WHERE "id" = ${period.id}
          AND "usedMicros" + "reservedMicros" + ${amountMicros} <= "limitMicros"
      `;

  if (claimed === 0) {
    const state = await getTenantBudgetState(tenantId, periodKey);
    throw new AiBudgetExceededError(
      tenantId,
      state.usedUsd + state.reservedUsd,
      state.limitUsd,
      operation,
    );
  }

  const reservationId = randomUUID();
  try {
    await prisma.$executeRaw`
      INSERT INTO "TenantAiBudgetReservation"
        ("id", "tenantId", "periodId", "amountMicros", "operation", "status", "createdAt", "expiresAt")
      VALUES (
        ${reservationId}, ${tenantId}, ${period.id}, ${amountMicros}, ${operation ?? null},
        'held', NOW(), ${new Date(Date.now() + RESERVATION_TTL_MS)}
      )
    `;
  } catch (error) {
    // Give the hold back rather than leaking it; the caller never got a reservation.
    await prisma.$executeRaw`
      UPDATE "TenantAiBudgetPeriod"
      SET "reservedMicros" = GREATEST(0, "reservedMicros" - ${amountMicros}), "updatedAt" = NOW()
      WHERE "id" = ${period.id}
    `;
    throw error;
  }

  return {
    reservationId,
    tenantId,
    periodKey,
    estimatedCostUsd,
    reconcile: (actualCostUsd: number) => settle(reservationId, period.id, amountMicros, actualCostUsd),
    release: () => settle(reservationId, period.id, amountMicros, null),
  };
}

/**
 * Settles one hold exactly once.
 *
 * The status transition is the guard: only a row still `held` is settled, so a duplicate
 * `reconcile` or a `release` after `reconcile` is a no-op rather than a double accounting.
 */
async function settle(
  reservationId: string,
  periodId: string,
  amountMicros: bigint,
  actualCostUsd: number | null,
): Promise<void> {
  const actualMicros = actualCostUsd === null ? null : usdToMicros(Math.max(0, actualCostUsd));
  const nextStatus = actualCostUsd === null ? 'released' : 'reconciled';

  const transitioned = await prisma.$executeRaw`
    UPDATE "TenantAiBudgetReservation"
    SET "status" = ${nextStatus}, "settledAt" = NOW(), "settledMicros" = ${actualMicros}
    WHERE "id" = ${reservationId} AND "status" = 'held'
  `;
  if (transitioned === 0) return;

  await prisma.$executeRaw`
    UPDATE "TenantAiBudgetPeriod"
    SET "reservedMicros" = GREATEST(0, "reservedMicros" - ${amountMicros}),
        "usedMicros" = "usedMicros" + ${actualMicros ?? BigInt(0)},
        "updatedAt" = NOW()
    WHERE "id" = ${periodId}
  `;
}

/**
 * Expires stale holds and repairs each affected period's reserved total from the rows that
 * are still held. The repair is what heals a hold whose process died between claiming
 * budget and recording the reservation.
 */
export async function sweepExpiredReservations(now: Date = new Date()): Promise<number> {
  const expired = await prisma.$queryRaw<Array<{ id: string; periodId: string }>>`
    UPDATE "TenantAiBudgetReservation"
    SET "status" = 'expired', "settledAt" = NOW()
    WHERE "status" = 'held' AND "expiresAt" < ${now}
    RETURNING "id", "periodId"
  `;

  const periodIds = [...new Set(expired.map((row) => row.periodId))];
  for (const periodId of periodIds) {
    await prisma.$executeRaw`
      UPDATE "TenantAiBudgetPeriod" p
      SET "reservedMicros" = COALESCE((
            SELECT SUM(r."amountMicros")
            FROM "TenantAiBudgetReservation" r
            WHERE r."periodId" = p."id" AND r."status" = 'held'
          ), 0),
          "updatedAt" = NOW()
      WHERE p."id" = ${periodId}
    `;
  }

  return expired.length;
}

/** Clears budget state. Test-support only. */
export async function clearBudgetReservations(tenantId?: string): Promise<void> {
  if (tenantId) {
    await prisma.$executeRaw`DELETE FROM "TenantAiBudgetReservation" WHERE "tenantId" = ${tenantId}`;
    await prisma.$executeRaw`DELETE FROM "TenantAiBudgetPeriod" WHERE "tenantId" = ${tenantId}`;
    return;
  }
  await prisma.$executeRaw`DELETE FROM "TenantAiBudgetReservation"`;
  await prisma.$executeRaw`DELETE FROM "TenantAiBudgetPeriod"`;
}
