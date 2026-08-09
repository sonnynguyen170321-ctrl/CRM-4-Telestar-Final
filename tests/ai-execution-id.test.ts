import { describe, it, expect } from 'vitest';
import {
  isValidExecutionId,
  newExecutionId,
  resolveTurnExecutionId,
} from '@/lib/ai/executionId';

/**
 * The execution id is the idempotency namespace for one logical agent turn
 * (`agent:{executionId}:tool:{ordinal}:{toolName}`). Two properties matter, and neither is
 * visible from a type signature:
 *
 * - a retry of the same turn must reuse the id, or every retried tool call writes a second
 *   CRM row;
 * - a new turn must not inherit it, or a second genuine action is silently swallowed as a
 *   duplicate.
 */
describe('agent execution id', () => {
  it('mints a distinct id per logical turn', () => {
    const first = newExecutionId();
    const second = newExecutionId();

    expect(first).not.toBe(second);
    expect(isValidExecutionId(first)).toBe(true);
  });

  it('reuses the id when the same message is resent after a failure', () => {
    const failed = { content: 'Create a follow-up task', executionId: newExecutionId() };

    const retried = resolveTurnExecutionId('Create a follow-up task', failed);

    expect(retried).toBe(failed.executionId);
  });

  it('mints a new id when the message differs from the failed turn', () => {
    const failed = { content: 'Create a follow-up task', executionId: newExecutionId() };

    const next = resolveTurnExecutionId('Summarise the thread instead', failed);

    expect(next).not.toBe(failed.executionId);
    expect(isValidExecutionId(next)).toBe(true);
  });

  it('mints a new id when no earlier turn failed', () => {
    expect(isValidExecutionId(resolveTurnExecutionId('First message', null))).toBe(true);
  });

  it('does not inherit a malformed stored id', () => {
    // A stored value that cannot be a real id is treated as absent rather than reused,
    // so a corrupted client state cannot pick the namespace a write lands in.
    const failed = { content: 'Same text', executionId: 'not-an-id' };

    expect(resolveTurnExecutionId('Same text', failed)).not.toBe('not-an-id');
  });

  it('accepts only id-shaped values', () => {
    expect(isValidExecutionId(newExecutionId())).toBe(true);
    expect(isValidExecutionId('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true);

    expect(isValidExecutionId('')).toBe(false);
    expect(isValidExecutionId('../../etc/passwd')).toBe(false);
    expect(isValidExecutionId('a'.repeat(200))).toBe(false);
    expect(isValidExecutionId(undefined)).toBe(false);
    expect(isValidExecutionId(42)).toBe(false);
  });
});
