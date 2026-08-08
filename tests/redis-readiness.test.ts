import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  summarizeAlerts,
  QUEUE_ALERT,
  HEARTBEAT_STALE_MS,
  type QueueMetrics,
  type WorkerHeartbeat,
} from '@/lib/bullmq/metrics';
import { assertUsableRedisUrl, getRedisConfig } from '@/lib/bullmq/connection';

const q = (over: Partial<QueueMetrics> = {}): QueueMetrics => ({
  name: 'email',
  waiting: 0,
  active: 0,
  delayed: 0,
  failed: 0,
  completed: 0,
  oldestWaitingAgeMs: null,
  ...over,
});

const healthy: WorkerHeartbeat = { lastSeenAt: new Date().toISOString(), ageMs: 1_000, healthy: true };

describe('queue alerts', () => {
  it('says nothing about a healthy system', () => {
    expect(summarizeAlerts([q()], healthy)).toEqual([]);
  });

  it('ignores depth on its own', () => {
    // A deep queue that is draining is a burst, not a fault. Alerting on depth is how
    // people learn to ignore alerts.
    expect(summarizeAlerts([q({ waiting: 5_000, active: 5 })], healthy)).toEqual([]);
  });

  it('flags one job stuck at the front, which depth would miss', () => {
    // Smaller number, far worse condition.
    const alerts = summarizeAlerts([q({ waiting: 1, oldestWaitingAgeMs: QUEUE_ALERT.oldestWaitingMs + 1 })], healthy);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/nothing is draining it/);
  });

  it('flags accumulated failures, which BullMQ hides by design', () => {
    expect(summarizeAlerts([q({ failed: QUEUE_ALERT.failed })], healthy)[0]).toMatch(/failed jobs/);
  });

  it('reports a queue it could not read rather than reporting zero', () => {
    // Returning zeros for an unreadable queue would look like "all clear".
    const alerts = summarizeAlerts([q({ error: 'ECONNREFUSED' })], healthy);
    expect(alerts[0]).toMatch(/could not be read/);
  });

  it('flags a stale heartbeat even when every queue is empty', () => {
    // The dead-consumer case: nothing waiting because nothing is being produced either,
    // and no worker has finished anything in hours.
    const stale: WorkerHeartbeat = {
      lastSeenAt: new Date(Date.now() - HEARTBEAT_STALE_MS * 4).toISOString(),
      ageMs: HEARTBEAT_STALE_MS * 4,
      healthy: false,
    };
    expect(summarizeAlerts([q()], stale)[0]).toMatch(/workers may be down/);
  });

  it('distinguishes never-started from stopped', () => {
    const never: WorkerHeartbeat = { lastSeenAt: null, ageMs: null, healthy: false };
    expect(summarizeAlerts([], never)[0]).toMatch(/never have started/);
  });
});

describe('REDIS_URL validation', () => {
  it('accepts the local default and a managed TLS URL', () => {
    expect(() => assertUsableRedisUrl(undefined)).not.toThrow();
    expect(() => assertUsableRedisUrl('redis://localhost:6379')).not.toThrow();
    expect(() => assertUsableRedisUrl('rediss://default:secret@cache.example.net:6380')).not.toThrow();
  });

  it('rejects a scheme that is not redis', () => {
    expect(() => assertUsableRedisUrl('http://cache.example.net:6379')).toThrow(/redis:\/\/ or rediss:\/\//);
  });

  it('rejects a password sent unencrypted to a remote host', () => {
    // The exact mistake a managed migration invites: copy the host, forget the extra "s".
    expect(() => assertUsableRedisUrl('redis://default:secret@cache.example.net:6379')).toThrow(
      /unencrypted/
    );
  });

  it('allows a password on the compose network, which never leaves the host', () => {
    expect(() => assertUsableRedisUrl('redis://default:secret@redis:6379')).not.toThrow();
  });

  it('rejects an unparseable value with the value in the message', () => {
    expect(() => assertUsableRedisUrl('not a url')).toThrow(/not a valid URL/);
  });
});

describe('connection options for a managed instance', () => {
  it('enables TLS for rediss:// and not for redis://', () => {
    const prev = process.env.REDIS_URL;
    try {
      process.env.REDIS_URL = 'rediss://cache.example.net:6380';
      expect(getRedisConfig().opts.tls).toBeDefined();
      process.env.REDIS_URL = 'redis://localhost:6379';
      expect(getRedisConfig().opts.tls).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = prev;
    }
  });

  it('bounds a single command so callers fail instead of hanging', () => {
    // BullMQ's calls never reject on an unreachable Redis; without a command timeout a
    // web request that enqueues would hang until the platform killed it.
    const { opts } = getRedisConfig();
    expect(opts.commandTimeout).toBeGreaterThan(0);
    expect(opts.enableOfflineQueue).toBe(false);
  });

  it('keeps reconnecting forever, so a worker survives a provider failover', () => {
    const { opts } = getRedisConfig();
    expect(typeof opts.retryStrategy).toBe('function');
    expect(opts.retryStrategy?.(1000)).toBeGreaterThan(0);
  });
});

describe('deployment configuration', () => {
  it('does not hardcode the compose-network Redis', () => {
    // A managed instance must not require editing this file.
    const compose = readFileSync('docker-compose.yml', 'utf8');
    expect(compose).toMatch(/\$\{REDIS_URL:-redis:\/\/redis:6379\}/);
  });

  it('documents noeviction, which is the setting that silently loses jobs', () => {
    const doc = readFileSync('docs/REDIS_MIGRATION.md', 'utf8');
    expect(doc).toMatch(/noeviction/);
    expect(doc).toMatch(/allkeys-lru/);
  });
});
