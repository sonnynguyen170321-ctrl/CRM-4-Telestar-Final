import { describe, it, expect } from 'vitest';
import {
  compileContext,
  estimateTokens,
  CONTEXT_TIER_ORDER,
  type ContextItem,
} from '@/lib/ai/context/compiler';

/**
 * The context compiler decides what the model is told, and what it is not.
 *
 * Before it, `app/api/ai/chat/route.ts` pushed strings onto an array in the order the code
 * happened to run: page hint, workload counters, end-of-day summary, lead fields, commercial
 * claims. That works while the list is short. It has two properties that stop being acceptable
 * as it grows — there is no budget, so the block grows without limit, and there is no ranking,
 * so when something does have to give it is whatever was appended last rather than whatever
 * mattered least.
 *
 * The directive's ordering is the specification: authoritative facts first, then the record in
 * front of the user, then recent interaction, then commercial evidence, then memory, then
 * playbook, then background. This file holds that ordering to it.
 *
 * What the compiler deliberately does **not** do is authorize. Every item handed to it has
 * already passed the authorization that governs its source — `loadAuthorizedLeadContext` for the
 * lead, tenant-scoped queries for claims. A compiler that filtered by permission would be a
 * second, weaker authorization decision, and the weaker one always wins in the end.
 */

const item = (tier: ContextItem['tier'], key: string, text: string): ContextItem => ({
  tier,
  key,
  text,
});

describe('estimateTokens', () => {
  it('is honest about being an estimate, not a tokenizer', () => {
    // Four characters per token is the usual rule of thumb for English. It is wrong in both
    // directions for code and for other scripts, which is why the budget is a soft ceiling on a
    // block that is prose, and never the thing standing between a request and a context-limit
    // error — the provider's own limit does that.
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

describe('compileContext', () => {
  it('emits nothing for no items', () => {
    const out = compileContext([], { budgetTokens: 100 });
    expect(out.text).toBe('');
    expect(out.included).toEqual([]);
  });

  it('orders by tier, not by the order items were added', () => {
    const out = compileContext(
      [
        item('playbook', 'p', 'Playbook rule.'),
        item('authoritative_fact', 'a', 'Assigned leads: 12'),
        item('memory', 'm', 'Prefers concise notes.'),
        item('current_task_record', 'c', 'Current lead: Dana Ito'),
      ],
      { budgetTokens: 1000 },
    );
    expect(out.included).toEqual(['a', 'c', 'm', 'p']);
  });

  it('keeps insertion order within a tier, so related lines stay together', () => {
    const out = compileContext(
      [
        item('current_task_record', 'name', 'Current lead: Dana Ito'),
        item('current_task_record', 'company', 'Company: Kaisen'),
        item('current_task_record', 'stage', 'Pipeline stage: replied'),
      ],
      { budgetTokens: 1000 },
    );
    expect(out.included).toEqual(['name', 'company', 'stage']);
  });

  it('drops the least important item first when the budget binds', () => {
    // The failure this prevents: a long list of low-confidence memory crowding out the name of
    // the lead the user is looking at.
    const out = compileContext(
      [
        item('authoritative_fact', 'a', 'A'.repeat(40)),
        item('background', 'b', 'B'.repeat(40)),
        item('memory', 'm', 'M'.repeat(40)),
      ],
      { budgetTokens: 20 },
    );
    expect(out.included).toEqual(['a', 'm']);
    expect(out.dropped.map((d) => d.key)).toEqual(['b']);
    expect(out.dropped[0].reason).toBe('budget');
  });

  it('never drops a higher tier to fit a lower one', () => {
    const out = compileContext(
      [
        item('background', 'b', 'B'.repeat(400)),
        item('authoritative_fact', 'a', 'A'.repeat(40)),
      ],
      { budgetTokens: 15 },
    );
    expect(out.included).toEqual(['a']);
    expect(out.dropped.map((d) => d.key)).toEqual(['b']);
  });

  it('deduplicates by key, keeping the first', () => {
    const out = compileContext(
      [
        item('current_task_record', 'lead', 'Current lead: Dana Ito'),
        item('current_task_record', 'lead', 'Current lead: someone else'),
      ],
      { budgetTokens: 1000 },
    );
    expect(out.included).toEqual(['lead']);
    expect(out.text).toContain('Dana Ito');
    expect(out.dropped[0]).toMatchObject({ key: 'lead', reason: 'duplicate' });
  });

  it('deduplicates identical text arriving under different keys', () => {
    // Two loaders can legitimately report the same fact. The model should not read it twice and
    // treat the repetition as emphasis.
    const out = compileContext(
      [
        item('current_task_record', 'k1', 'Company: Kaisen'),
        item('recent_interaction', 'k2', 'Company: Kaisen'),
      ],
      { budgetTokens: 1000 },
    );
    expect(out.included).toEqual(['k1']);
    expect(out.dropped[0]).toMatchObject({ key: 'k2', reason: 'duplicate' });
  });

  it('discards empty and whitespace-only items rather than emitting blank lines', () => {
    const out = compileContext(
      [item('authoritative_fact', 'a', '   '), item('authoritative_fact', 'b', 'Real.')],
      { budgetTokens: 1000 },
    );
    expect(out.included).toEqual(['b']);
    expect(out.dropped[0]).toMatchObject({ key: 'a', reason: 'empty' });
  });

  it('reports what it did, so a bad answer can be explained afterwards', () => {
    // The trace is the point of returning an object rather than a string: given a wrong answer,
    // "what was the model actually told" is the first question, and it must be answerable
    // without re-running anything.
    const out = compileContext([item('authoritative_fact', 'a', 'Assigned leads: 12')], {
      budgetTokens: 1000,
    });
    expect(out.estimatedTokens).toBeGreaterThan(0);
    expect(out.included).toEqual(['a']);
    expect(out.dropped).toEqual([]);
  });

  it('declares its tier order from most to least authoritative', () => {
    expect(CONTEXT_TIER_ORDER).toEqual([
      'authoritative_fact',
      'current_task_record',
      'recent_interaction',
      'commercial_evidence',
      'memory',
      'playbook',
      'background',
    ]);
  });
});
