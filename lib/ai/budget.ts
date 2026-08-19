/**
 * Telestar Pre-Provider AI Budget Governance & Concurrency-Safe Reservation (TEL-P1-011).
 */

export class AiBudgetExceededError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly currentSpendUsd: number,
    public readonly monthlyLimitUsd: number,
    public readonly operation?: string
  ) {
    super(
      `AI Budget exceeded for tenant ${tenantId}: current spend $${currentSpendUsd.toFixed(4)} + reserved exceeds limit $${monthlyLimitUsd.toFixed(2)} (operation: ${operation || 'unknown'})`
    );
    this.name = 'AiBudgetExceededError';
  }
}

interface ActiveReservation {
  id: string;
  tenantId: string;
  amountUsd: number;
  createdAt: number;
}

// In-memory atomic reservation map with auto-expiry (10 minutes)
const activeReservations = new Map<string, ActiveReservation>();
const tenantSpendTracker = new Map<string, { currentMonthSpendUsd: number; monthKey: string }>();

function getCurrentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function getTenantMonthlyLimit(_tenantId: string): number {
  if (process.env.AI_MONTHLY_BUDGET_USD) {
    const val = parseFloat(process.env.AI_MONTHLY_BUDGET_USD);
    if (!isNaN(val) && val > 0) return val;
  }
  // Default $50.00/month per tenant
  return 50.0;
}

export function getTenantCurrentSpend(tenantId: string): number {
  const currentMonth = getCurrentMonthKey();
  const tracker = tenantSpendTracker.get(tenantId);
  if (!tracker || tracker.monthKey !== currentMonth) {
    return 0;
  }
  return tracker.currentMonthSpendUsd;
}

export function setTenantCurrentSpend(tenantId: string, spendUsd: number): void {
  const currentMonth = getCurrentMonthKey();
  tenantSpendTracker.set(tenantId, { currentMonthSpendUsd: Math.max(0, spendUsd), monthKey: currentMonth });
}

export function getTenantReservedSpend(tenantId: string): number {
  const now = Date.now();
  let totalReserved = 0;
  for (const [id, res] of activeReservations.entries()) {
    // Prune stale reservations older than 5 minutes
    if (now - res.createdAt > 300_000) {
      activeReservations.delete(id);
    } else if (res.tenantId === tenantId) {
      totalReserved += res.amountUsd;
    }
  }
  return totalReserved;
}

export interface ReserveBudgetOptions {
  tenantId?: string;
  estimatedCostUsd?: number;
  operation?: string;
  isEssential?: boolean;
}

export interface BudgetReservation {
  reservationId: string;
  tenantId: string;
  estimatedCostUsd: number;
  reconcile: (actualCostUsd: number) => void;
  release: () => void;
}

/**
 * Pre-provider atomic check & reservation.
 * Throws AiBudgetExceededError if tenant spend + in-flight reservations exceed the limit.
 */
export async function checkAndReserveAiBudget(
  opts: ReserveBudgetOptions
): Promise<BudgetReservation | null> {
  const { tenantId, estimatedCostUsd = 0.005, operation, isEssential = false } = opts;
  if (!tenantId) return null;

  const limit = getTenantMonthlyLimit(tenantId);
  const currentSpend = getTenantCurrentSpend(tenantId);
  const reserved = getTenantReservedSpend(tenantId);

  // If not essential and current + reserved + estimated exceeds limit, reject immediately
  if (!isEssential && currentSpend + reserved + estimatedCostUsd > limit) {
    throw new AiBudgetExceededError(tenantId, currentSpend + reserved, limit, operation);
  }

  const reservationId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const reservation: ActiveReservation = {
    id: reservationId,
    tenantId,
    amountUsd: estimatedCostUsd,
    createdAt: Date.now(),
  };

  activeReservations.set(reservationId, reservation);

  return {
    reservationId,
    tenantId,
    estimatedCostUsd,
    reconcile: (actualCostUsd: number) => {
      activeReservations.delete(reservationId);
      const cur = getTenantCurrentSpend(tenantId);
      setTenantCurrentSpend(tenantId, cur + actualCostUsd);
    },
    release: () => {
      activeReservations.delete(reservationId);
    },
  };
}

export function clearBudgetReservations(): void {
  activeReservations.clear();
  tenantSpendTracker.clear();
}
