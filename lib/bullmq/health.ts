import { getConnection } from './connection';

const DEFAULT_PING_TIMEOUT_MS = 1500;

/**
 * Is Redis (and therefore the job queue) reachable right now?
 *
 * The shared connection uses an unbounded `retryStrategy` and
 * `maxRetriesPerRequest: null`, so a command issued while Redis is down waits
 * forever instead of rejecting. Callers that need a yes/no answer must race the
 * ping against a timeout — otherwise the request hangs until the client gives up.
 */
export async function isQueueReachable(timeoutMs = DEFAULT_PING_TIMEOUT_MS): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const pong = await Promise.race([
      getConnection().ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('redis ping timeout')), timeoutMs);
      }),
    ]);
    return pong === 'PONG';
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
