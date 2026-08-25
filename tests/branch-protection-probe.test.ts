import { describe, it, expect } from 'vitest';

/**
 * DISPOSABLE. This file exists only to prove that a failing mandatory check
 * blocks a merge into main, and is deleted as soon as that is recorded.
 * It must never reach main.
 */
describe('branch protection probe', () => {
  it('fails on purpose so the required check goes red', () => {
    expect('branch protection', 'deliberate failure').toBe('must block the merge');
  });
});
