import { Redis, type RedisOptions } from 'ioredis';

/**
 * `127.0.0.1`, not `localhost` — the same reason as `lib/cache.ts`. `localhost` resolves to the
 * IPv6 loopback first on Windows, Docker Desktop's port proxy accepts that and then resets it,
 * and the driver waits out its whole window. Measured 2026-08-23: a first GET took 60 ms over
 * `127.0.0.1` and failed after 30,023 ms over `localhost`, against the same container. Here it
 * surfaced as BullMQ reporting `Command timed out` against a Redis that answered `PING`
 * instantly when addressed by IP.
 */
const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

export function getRedisConfig(): { url: string; opts: RedisOptions } {
  const url = process.env.REDIS_URL || DEFAULT_REDIS_URL;
  const isTls = url.startsWith('rediss://');

  // A managed provider hands you `rediss://user:password@host:6380`. ioredis parses the
  // credentials out of the URL itself, so nothing extra is needed for auth — but TLS is
  // NOT inferred, and connecting to a TLS port without it fails with an opaque protocol
  // error rather than anything that names the cause.
  return {
    url,
    opts: {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      // Never give up reconnecting. The worker is an always-on process: if it boots
      // before Redis is ready (compose ordering, ElastiCache cold start) or Redis blips,
      // returning null here would permanently detach the connection while the process
      // stays alive — jobs then pile up at status='queued' and never execute. Keep
      // retrying with a capped backoff so the worker self-heals.
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
      // Bound the wait for any single command. Without this an unreachable Redis makes
      // callers HANG rather than fail: BullMQ's own calls (getJobCounts, add) never
      // reject, so a web request that enqueues would sit until the platform's timeout
      // killed it. Ten seconds is far longer than a healthy round trip — including to a
      // managed instance across a private link — and far shorter than a request timeout.
      commandTimeout: 10_000,
      // Do not queue commands while disconnected. Buffering them means a caller waits for
      // a reconnect that may never come; failing immediately surfaces the outage.
      enableOfflineQueue: false,
      lazyConnect: true,
      tls: isTls ? {} : undefined,
    },
  };
}

/**
 * Reject a configuration that cannot work, at startup, with a message that names the fix.
 *
 * A managed Redis migration goes wrong in a small number of predictable ways, and every
 * one of them otherwise surfaces as a connection error with no indication of the cause.
 */
export function assertUsableRedisUrl(url: string | undefined): void {
  if (!url) return; // The local default applies; nothing to validate.

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`REDIS_URL is not a valid URL: ${JSON.stringify(url)}`);
  }

  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(
      `REDIS_URL must use redis:// or rediss://, got "${parsed.protocol}". ` +
        'A managed provider will give you rediss:// — the extra s is TLS, and omitting it ' +
        'fails with an opaque protocol error.'
    );
  }

  // Credentials over a plaintext link, pointing somewhere that is not this machine, means
  // the password crosses the network in clear.
  const isLocal = ['localhost', '127.0.0.1', '::1', 'redis'].includes(parsed.hostname);
  if (parsed.protocol === 'redis:' && parsed.password && !isLocal) {
    throw new Error(
      `REDIS_URL sends a password to ${parsed.hostname} over an unencrypted connection. ` +
        'Use rediss:// for any Redis that is not on this host.'
    );
  }
}

let connection: Redis | null = null;

function createConnection(): Redis {
  const { url, opts } = getRedisConfig();
  const client = new Redis(url, opts);
  client.on('error', (err) => {
    console.error('[bullmq] Redis connection error:', err.message);
  });
  client.on('connect', () => {
    console.log('[bullmq] Redis connected');
  });
  client.on('close', () => {
    console.warn('[bullmq] Redis connection closed');
  });
  return client;
}

export function getConnection(): Redis {
  if (!connection) {
    connection = createConnection();
  }
  return connection;
}

export async function closeConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
