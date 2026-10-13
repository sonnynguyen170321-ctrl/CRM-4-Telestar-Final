import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyBlock, failureCodeFor, parseReasonCode, reasonCodeNote, recheckDelayMs } from '@/lib/sequences/blockPolicy';

/** Every reason that bars an automatic email must be closed, rechecked or held, never dropped. */
describe('the block policy', () => {
  const source = readFileSync(join(process.cwd(), 'lib/automation/eligibility.ts'), 'utf8');
  const literal = [...source.matchAll(/decision: '(?:BLOCK|TERMINATE)', reason: '([a-z_]+)'/g)].map((m) => m[1]);
  const templated = [...source.matchAll(/decision: '(?:BLOCK|TERMINATE)', reason: `([a-z_]+)\$\{/g)].map((m) => m[1]);

  it('finds the eligibility reasons it is guarding', () => {
    expect(literal.length).toBeGreaterThan(8);
    expect([...templated].sort()).toEqual(['campaign_', 'enrollment_', 'lead_stage_']);
  });

  it('classifies every literal reason explicitly', () => {
    const expected: Record<string, string> = {
      tenant_invalid: 'closing',
      step_mismatch: 'closing',
      user_inactive: 'recheck',
      sequence_inactive: 'recheck',
      mailbox_inactive: 'recheck',
      lead_archived: 'recheck',
      lead_email_invalid: 'recheck',
      lead_email_missing: 'recheck',
      recipient_suppressed: 'recheck',
      lead_replied: 'hold',
      meeting_booked: 'hold',
    };
    for (const reason of literal) expect(expected[reason], `${reason} is not classified`).toBeDefined();
    for (const reason of literal) expect(classifyBlock(reason), reason).toBe(expected[reason]);
  });

  it('closes every other campaign state and every stage or enrollment termination', () => {
    for (const r of ['campaign_completed', 'campaign_archived', 'campaign_draft', 'lead_stage_won', 'lead_stage_lost', 'enrollment_completed']) {
      expect(classifyBlock(r), r).toBe('closing');
    }
    expect(classifyBlock('campaign_paused')).toBe('recheck');
  });

  it('closes an unknown reason rather than leaving the step with nothing behind it', () => {
    expect(classifyBlock('something_new')).toBe('closing');
  });

  it('backs off, hourly the first day and every six hours after', () => {
    expect(recheckDelayMs(0)).toBe(3_600_000);
    expect(recheckDelayMs(2 * 86_400_000)).toBe(6 * 3_600_000);
  });

  it('stores only fixed codes, mapped from provider text', () => {
    expect(failureCodeFor('550 5.7.1 rejected, tenant abc')).toBe('rejected');
    expect(failureCodeFor('Recipient is suppressed')).toBe('suppressed');
    expect(failureCodeFor('canary recipient restriction')).toBe('sending_off');
    expect(parseReasonCode(reasonCodeNote('limit'))).toBe('limit');
    expect(parseReasonCode('free text')).toBeNull();
  });
});
