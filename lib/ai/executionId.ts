/**
 * Execution identity for one logical agent turn (Revenue AI Phase 5).
 *
 * The idempotency namespace is `agent:{executionId}:tool:{ordinal}:{toolName}`, so the
 * executionId decides whether a retry is *the same work* or *new work*. That makes it a
 * property of the user's turn, not of a network attempt: generating it inside the fetch
 * would mint a fresh namespace on every retry and every retried tool call would write a
 * second CRM row.
 *
 * Import-free on purpose. A Client Component owns the id, and this module has to be safe
 * for it to import — see ARCHITECTURE §10.
 */

/** Upper bound on an accepted id. Nothing legitimate is longer; a cap keeps the ledger key bounded. */
const MAX_EXECUTION_ID_LENGTH = 64;

/** 32 hex characters (a UUID with the dashes removed) or a dashed UUID. */
const EXECUTION_ID_SHAPE = /^[a-f0-9]{32}$|^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/**
 * Accept only id-shaped values. Anything else is treated as absent rather than coerced,
 * because a caller-chosen string would let a client collide with another turn's namespace.
 */
export function isValidExecutionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_EXECUTION_ID_LENGTH &&
    EXECUTION_ID_SHAPE.test(value)
  );
}

/** A new namespace for a new logical turn. */
export function newExecutionId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** The turn that failed and may be retried, kept only until the next send resolves it. */
export interface FailedTurn {
  content: string;
  executionId: string;
}

/**
 * Reuse the failed turn's id when the SDR resends the same message; mint a new one otherwise.
 *
 * Same message text after a failure is the retry case, and reusing the id is what makes the
 * retry find the prior `AgentAction` instead of creating a second one. Different text is a
 * different turn and must not inherit the namespace.
 */
export function resolveTurnExecutionId(content: string, failed: FailedTurn | null): string {
  if (failed && failed.content === content && isValidExecutionId(failed.executionId)) {
    return failed.executionId;
  }
  return newExecutionId();
}
