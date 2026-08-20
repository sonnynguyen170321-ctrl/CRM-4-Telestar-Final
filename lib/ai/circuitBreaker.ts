/**
 * AI Provider Circuit Breaker for Telestar Revenue Delivery OS (Directive Phase 1 §16).
 * Automatically isolates failing providers/models and directs traffic to operational alternatives.
 *
 * ## Local view, shared truth (TEL-P1-017)
 *
 * `isAvailable` stays **synchronous** because routing filters candidates with it, and routing
 * is a pure function. So this class holds a local view that is refreshed from shared state by
 * `sync()`, which the gateway awaits before it routes. State changes are pushed back with
 * `publish()`.
 *
 * The consequence is bounded staleness, not divergence: an instance can be at most one
 * routing decision behind another instance's circuit change. What must not be approximate is
 * the HALF_OPEN probe - `tryEnterHalfOpen` takes a Redis lease, so exactly one instance
 * probes a recovering provider no matter how many are running.
 *
 * With Redis unreachable every shared call degrades to the previous single-process behaviour
 * and says so in the log. See `sharedCircuit.ts`.
 */

import {
  circuitKey,
  publishSharedCircuit,
  readSharedCircuits,
  releaseProbeLease,
  tryAcquireProbeLease,
} from './sharedCircuit';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitMetrics {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number | null;
  lastStateChange: number;
  totalCalls: number;
  totalErrors: number;
  totalRateLimits: number;
}

class CircuitBreakerManager {
  private circuits = new Map<string, CircuitMetrics>();
  private halfOpenLeases = new Set<string>();
  private readonly failureThreshold = 3;
  private readonly resetTimeoutMs = 30_000; // 30s before trying HALF_OPEN

  private getKey(provider: string, modelId?: string): string {
    return modelId ? `${provider}:${modelId}` : provider;
  }

  private getOrCreate(key: string): CircuitMetrics {
    let metrics = this.circuits.get(key);
    if (!metrics) {
      metrics = {
        state: 'CLOSED',
        consecutiveFailures: 0,
        lastFailureTime: null,
        lastStateChange: Date.now(),
        totalCalls: 0,
        totalErrors: 0,
        totalRateLimits: 0,
      };
      this.circuits.set(key, metrics);
    }
    return metrics;
  }

  /**
   * Check whether a provider or model can receive traffic.
   * In HALF_OPEN state, grants only a single concurrency probe lease.
   */
  public isAvailable(provider: string, modelId?: string): boolean {
    // 1. Check provider-level circuit first
    const providerMetrics = this.circuits.get(provider);
    if (providerMetrics && providerMetrics.state === 'OPEN') {
      const elapsed = Date.now() - (providerMetrics.lastFailureTime || providerMetrics.lastStateChange);
      if (elapsed <= this.resetTimeoutMs) {
        return false;
      }
      providerMetrics.state = 'HALF_OPEN';
      providerMetrics.lastStateChange = Date.now();
    }

    if (providerMetrics && providerMetrics.state === 'HALF_OPEN') {
      if (this.halfOpenLeases.has(provider)) {
        // Another probe is already in flight — reject concurrent calls until probe completes
        return false;
      }
      this.halfOpenLeases.add(provider);
    }

    // 2. Check model-specific circuit if modelId supplied
    if (modelId) {
      const modelKey = `${provider}:${modelId}`;
      const modelMetrics = this.circuits.get(modelKey);
      if (modelMetrics && modelMetrics.state === 'OPEN') {
        const elapsed = Date.now() - (modelMetrics.lastFailureTime || modelMetrics.lastStateChange);
        if (elapsed <= this.resetTimeoutMs) {
          return false;
        }
        modelMetrics.state = 'HALF_OPEN';
        modelMetrics.lastStateChange = Date.now();
      }

      if (modelMetrics && modelMetrics.state === 'HALF_OPEN') {
        if (this.halfOpenLeases.has(modelKey)) {
          return false;
        }
        this.halfOpenLeases.add(modelKey);
      }
    }

    return true;
  }

  /**
   * Record a successful invocation.
   */
  public recordSuccess(provider: string, modelId?: string): void {
    const key = this.getKey(provider, modelId);
    this.halfOpenLeases.delete(provider);
    this.halfOpenLeases.delete(key);
    const metrics = this.getOrCreate(key);
    metrics.totalCalls++;
    metrics.consecutiveFailures = 0;

    if (metrics.state === 'HALF_OPEN' || metrics.state === 'OPEN') {
      metrics.state = 'CLOSED';
      metrics.lastStateChange = Date.now();
    }
  }

  /**
   * Record a failure.
   */
  public recordFailure(provider: string, modelId?: string, isRateLimit = false): void {
    const key = this.getKey(provider, modelId);
    this.halfOpenLeases.delete(provider);
    this.halfOpenLeases.delete(key);
    const metrics = this.getOrCreate(key);
    metrics.totalCalls++;
    metrics.totalErrors++;
    if (isRateLimit) metrics.totalRateLimits++;

    metrics.consecutiveFailures++;
    metrics.lastFailureTime = Date.now();

    if (metrics.consecutiveFailures >= this.failureThreshold || isRateLimit) {
      metrics.state = 'OPEN';
      metrics.lastStateChange = Date.now();
    }
  }

  /**
   * Get all active circuit states.
   */
  public getStatuses(): Record<string, CircuitMetrics> {
    const res: Record<string, CircuitMetrics> = {};
    for (const [k, v] of this.circuits.entries()) {
      res[k] = { ...v };
    }
    return res;
  }

  /**
   * Reset for testing.
   */
  public reset(): void {
    this.circuits.clear();
    this.halfOpenLeases.clear();
  }

  // ── Shared coordination (TEL-P1-017) ───────────────────────────────────────

  /**
   * Refreshes the local view from shared state.
   *
   * Shared state wins on `state` and `openedAt`: another instance having opened a circuit is
   * information this process does not otherwise have. Local counters are kept when they are
   * ahead, so a failure observed here is never discarded by a stale read.
   */
  public async sync(): Promise<void> {
    const shared = await readSharedCircuits();

    for (const [key, record] of Object.entries(shared)) {
      const local = this.getOrCreate(key);
      local.state = record.state;
      local.consecutiveFailures = Math.max(local.consecutiveFailures, record.consecutiveFailures);
      if (record.lastFailureTime !== null) {
        local.lastFailureTime = Math.max(local.lastFailureTime ?? 0, record.lastFailureTime);
      }
      if (record.openedAt !== null) local.lastStateChange = record.openedAt;
    }
  }

  /** Pushes one circuit's local state to shared storage. */
  public async publish(provider: string, modelId?: string): Promise<void> {
    const key = this.getKey(provider, modelId);
    const metrics = this.getOrCreate(key);

    await publishSharedCircuit(key, {
      state: metrics.state,
      consecutiveFailures: metrics.consecutiveFailures,
      lastFailureTime: metrics.lastFailureTime,
      openedAt: metrics.state === 'OPEN' ? metrics.lastStateChange : null,
    });
  }

  /**
   * Attempts to become the single instance that probes a recovering provider.
   *
   * Returns `true` when this process holds the probe, `false` when another already does.
   * Circuits that are not HALF_OPEN need no lease and return `true`.
   */
  public async tryEnterHalfOpen(provider: string, modelId?: string): Promise<boolean> {
    const key = this.getKey(provider, modelId);
    const metrics = this.circuits.get(key);
    if (!metrics || metrics.state !== 'HALF_OPEN') return true;

    const acquired = await tryAcquireProbeLease(circuitKey(provider, modelId), this.resetTimeoutMs);
    // Losing the race is not an outcome of the probe — no call was made, so `recordSuccess`
    // and `recordFailure` never run, and they are the only things that clear the local marker
    // `isAvailable` set on the way in. Left behind, that marker makes every later
    // `isAvailable` return false for this model, permanently, in this process.
    //
    // That is how a healthy provider stayed unreachable: the chat route answered
    // "Telestar AI is temporarily unavailable" in four milliseconds for over two hours while
    // the same three providers answered a CLI smoke test 14/14. Release it here so the next
    // request can probe.
    if (!acquired) this.releaseLocalProbe(provider, modelId);
    return acquired;
  }

  /** Releases the probe lease once the probe has resolved. */
  public async exitHalfOpen(provider: string, modelId?: string): Promise<void> {
    // Both halves, always. The shared lease lets another instance probe; the local marker is
    // what lets *this* one probe again. A caller that skips an attempt after entering
    // HALF_OPEN — an unresolvable price, say — releases neither by recording an outcome.
    this.releaseLocalProbe(provider, modelId);
    await releaseProbeLease(circuitKey(provider, modelId));
  }

  /** Clears the in-process probe marker for a provider and, if given, one of its models. */
  private releaseLocalProbe(provider: string, modelId?: string): void {
    this.halfOpenLeases.delete(provider);
    if (modelId) this.halfOpenLeases.delete(`${provider}:${modelId}`);
  }
}

export const circuitBreaker = new CircuitBreakerManager();
