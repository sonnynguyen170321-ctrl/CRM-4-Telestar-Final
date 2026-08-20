import { describe, it, expect } from 'vitest';

import { selectSkillModules, MAX_RETRIEVED_SKILL_MODULES } from '@/lib/ai/skill-retriever';

/**
 * Runtime skill routing (§XL).
 *
 * The property under test is that selection is driven by **relevance**, not by the order the
 * rules happen to be written in. The previous implementation collected matches into a `Set`
 * and took the first three; insertion order is declaration order, so a message squarely about
 * one topic could lose its module to a rule listed earlier in the file.
 *
 * Everything here is deterministic — no model call, no embedding — which is what makes the
 * router assertable at all.
 */

describe('relevance beats declaration order', () => {
  it('keeps the dominant topic when a weaker one is mentioned in passing', () => {
    // `meeting-booking` is declared before `objection-handling` in TOPIC_RULES. A message that
    // is mostly about objections must not lose to a single incidental "meeting".
    const modules = selectSkillModules({
      topicText:
        'they keep saying not interested and too expensive — that objection comes up every ' +
        'time, how do I handle the pushback before the meeting',
    });
    expect(modules[0]).toBe('objection-handling');
    expect(modules).toContain('objection-handling');
  });

  it('ranks repeated signal above a single mention', () => {
    const modules = selectSkillModules({
      topicText: 'research the company, research their news, research the account background',
    });
    expect(modules[0]).toBe('research');
  });

  it('treats an explicit operation as the strongest signal', () => {
    // The caller naming the intent outranks anything inferred from prose.
    const modules = selectSkillModules({
      operation: 'objection',
      topicText: 'book a meeting on the calendar',
    });
    expect(modules[0]).toBe('objection-handling');
  });
});

describe('§XL inputs beyond keywords', () => {
  it('uses channel as a weak affinity', () => {
    expect(selectSkillModules({ channel: 'phone' })).toContain('cold-call');
    expect(selectSkillModules({ channel: 'email' })).toContain('cold-email');
  });

  it('uses role as a weak affinity', () => {
    // A leadgen user's default craft is sourcing, not closing.
    expect(selectSkillModules({ role: 'leadgen' })).toContain('research');
  });

  it('uses the current surface as a weak affinity', () => {
    expect(selectSkillModules({ surface: '/dialer' })).toContain('cold-call');
    expect(selectSkillModules({ surface: '/meetings' })).toContain('meeting-booking');
  });

  it('never lets a weak affinity outrank an explicit topic', () => {
    // Role says research; the message says objections. The message wins.
    const modules = selectSkillModules({
      role: 'leadgen',
      topicText: 'how do I handle the objection when they say no budget',
    });
    expect(modules[0]).toBe('objection-handling');
  });
});

describe('the cap holds', () => {
  it('never returns more than the maximum, however much matches', () => {
    const modules = selectSkillModules({
      channel: 'email',
      role: 'leadgen',
      surface: '/sequences',
      topicText:
        'research this account, qualify the budget and timeline, handle the objection, book a ' +
        'meeting, follow-up if ghosted, personalize the cold email opener, cold call script',
    });
    expect(modules.length).toBeLessThanOrEqual(MAX_RETRIEVED_SKILL_MODULES);
    expect(new Set(modules).size).toBe(modules.length);
  });

  it('falls back to a useful pair when there is no signal at all', () => {
    expect(selectSkillModules({})).toEqual(['research', 'cold-email']);
  });
});
