/**
 * AI Provider Circuit Breaker for Telestar Revenue Delivery OS (Directive Phase 1 §16).
 * Automatically isolates failing providers/models and directs traffic to operational alternatives.
 */

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
}

export const circuitBreaker = new CircuitBreakerManager();
