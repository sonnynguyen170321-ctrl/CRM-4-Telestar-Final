/**
 * The composer's content score (lib/compose/contentScore.ts): deterministic, no AI, no network.
 * Every number the panel shows is checked here against a draft written to produce it.
 */
import { describe, it, expect } from 'vitest';

import { scoreContent, syllableCount, detectLanguage } from '@/lib/compose/contentScore';

const GOOD_BODY =
  '<p>Hi {{firstName|there}},</p>' +
  '<p>Teams at {{company}} often lose hours each week chasing leads by hand. We help sales teams book more calls with less admin.</p>' +
  '<p>You could see how your reps spend their day, and where you can win time back.</p>' +
  '<p>Would a short call next week be useful for you?</p>';

describe('scoreContent: the metrics', () => {
  it('counts words without the markup, with a merge tag as one word', () => {
    const r = scoreContent({ subject: 'Quick idea', body: '<p>Hello <strong>{{firstName}}</strong>, one two three.</p>' });
    expect(r.metrics.words).toBe(5);
  });

  it('counts links and images in HTML, and bare URLs in plain text', () => {
    const html = scoreContent({
      subject: 's',
      body: '<p>See <a href="https://a.test">this</a> and <a href="https://b.test">that</a></p><p><img src="https://x.test/p.png"></p>',
    });
    expect(html.metrics.links).toBe(2);
    expect(html.metrics.images).toBe(1);
    const plain = scoreContent({ subject: 's', body: 'Read https://a.test/x and www.b.test today.' });
    expect(plain.metrics.links).toBe(2);
    expect(plain.metrics.images).toBe(0);
  });

  it('counts questions', () => {
    expect(scoreContent({ subject: 's', body: 'Are you free? Is Tuesday ok? Thanks.' }).metrics.questions).toBe(2);
  });

  it('finds English and Vietnamese trigger words, each reported once', () => {
    const r = scoreContent({ subject: 'FREE offer', body: 'This is free. Act now, it is risk-free! Ưu đãi miễn phí cho bạn.' });
    expect(r.metrics.spamWords).toEqual(expect.arrayContaining(['free', 'act now', 'risk-free', 'miễn phí']));
    expect(r.metrics.spamWords.filter((w) => w === 'free')).toHaveLength(1);
  });

  it('does not see a trigger word inside a longer word', () => {
    expect(scoreContent({ subject: 's', body: 'Our freelance network is carefree.' }).metrics.spamWords).toEqual([]);
  });

  it('lists the variables used in subject and body, once each', () => {
    const r = scoreContent({ subject: '{{firstName}}, quick idea', body: '<p>Hi {{firstName}}, {{ai.icebreaker}} at {{company|your team}}</p>' });
    expect(r.metrics.variables.sort()).toEqual(['ai.icebreaker', 'company', 'firstName']);
  });

  it('reads chips the editor produced as the variables they are', () => {
    const chip = '<span data-merge-tag="firstName" data-fallback="">{{firstName}}</span>';
    expect(scoreContent({ subject: 's', body: `<p>Hi ${chip}</p>` }).metrics.variables).toEqual(['firstName']);
  });

  it('checks the subject: length, ALL CAPS and exclamation marks', () => {
    const r = scoreContent({ subject: 'LAST CHANCE TO SAVE!!!', body: GOOD_BODY });
    expect(r.metrics.subjectLength).toBe(22);
    expect(r.metrics.subjectAllCaps).toBe(true);
    expect(r.metrics.subjectExclamations).toBe(3);
    const calm = scoreContent({ subject: 'Idea for {{company}}', body: GOOD_BODY });
    expect(calm.metrics.subjectAllCaps).toBe(false);
    expect(calm.metrics.subjectExclamations).toBe(0);
  });

  it('a short acronym is not shouting', () => {
    expect(scoreContent({ subject: 'CRM', body: GOOD_BODY }).metrics.subjectAllCaps).toBe(false);
  });

  it('counts "I/we" against "you"', () => {
    const r = scoreContent({ subject: 's', body: "I think we can help. I'm sure our team and I will. You will see your results." });
    expect(r.metrics.firstPerson).toBe(5);
    expect(r.metrics.secondPerson).toBe(2);
  });

  it('gives an English reading grade and none for Vietnamese', () => {
    const en = scoreContent({ subject: 's', body: GOOD_BODY });
    expect(en.language).toBe('en');
    expect(en.metrics.readingGrade).not.toBeNull();
    expect(en.metrics.readingGrade!).toBeLessThan(10);
    const vi = scoreContent({ subject: 's', body: 'Chào anh, bên em là đơn vị cung cấp giải pháp bán hàng. Anh có thời gian trao đổi tuần sau không?' });
    expect(vi.language).toBe('vi');
    expect(vi.metrics.readingGrade).toBeNull();
  });

  it('a long-winded draft reads at a higher grade than a plain one', () => {
    const plain = scoreContent({ subject: 's', body: 'We help you book calls. It is quick. Want to see how?' });
    const dense = scoreContent({
      subject: 's',
      body: 'Our organisation facilitates comprehensive operational transformation initiatives, enabling multinational enterprises to institutionalise sophisticated methodologies.',
    });
    expect(dense.metrics.readingGrade!).toBeGreaterThan(plain.metrics.readingGrade! + 5);
  });
});

describe('scoreContent: the score and the tips', () => {
  it('scores a short, personal, single-question email highly with no tips about it', () => {
    const r = scoreContent({ subject: 'Idea for {{company}}', body: GOOD_BODY });
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.tips.length).toBeLessThanOrEqual(2);
  });

  it('scores a spammy, impersonal, link-heavy wall of text low, with concrete tips', () => {
    const wall = Array.from({ length: 30 }, () => 'We are the best company and we offer the best price guaranteed.').join(' ');
    const body = `<p>${wall} Click here: <a href="https://a.test">a</a> <a href="https://b.test">b</a> <a href="https://c.test">c</a></p>`;
    const r = scoreContent({ subject: 'BUY NOW!!!', body });
    expect(r.score).toBeLessThan(40);
    expect(r.tips.length).toBeGreaterThanOrEqual(3);
    expect(r.tips.length).toBeLessThanOrEqual(5);
    const text = r.tips.join(' ');
    expect(text).toMatch(/words/i);
    expect(text).toMatch(/link/i);
    expect(text).toMatch(/click here|guaranteed|buy now/i);
  });

  it('is always between 0 and 100 and is the same for the same draft', () => {
    const worst = scoreContent({ subject: 'FREE!!! FREE!!! FREE!!! FREE!!! FREE!!! FREE!!! FREE!!! FREE!!! FREE!!!', body: `<p>${'free cash winner '.repeat(400)}</p>` });
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(scoreContent({ subject: 'Idea', body: GOOD_BODY })).toEqual(scoreContent({ subject: 'Idea', body: GOOD_BODY }));
  });

  it('asks for a question when there is none, and for personalization when there is no variable', () => {
    const r = scoreContent({ subject: 'Hello', body: 'We help sales teams book more meetings with less admin work every week.' });
    expect(r.tips.join(' ')).toMatch(/question/i);
    expect(r.tips.join(' ')).toMatch(/\{\{firstName\}\}|personal/i);
  });

  it('flags a self-centred draft', () => {
    const r = scoreContent({ subject: 'Hi', body: 'I wanted to reach out. I run a team and we built a tool. I think our tool is great and we love it. Is it useful to {{firstName}}?' });
    expect(r.tips.join(' ')).toMatch(/you/i);
  });

  it('an empty draft has no score yet', () => {
    const r = scoreContent({ subject: '', body: '<p></p>' });
    expect(r.empty).toBe(true);
    expect(r.score).toBe(0);
    expect(r.tips).toEqual([]);
  });

  it('counts the words of one spintax option and both sides of a conditional, not the syntax', () => {
    const r = scoreContent({ subject: 's', body: '{Hi|Hello there} {{firstName}}, {{#if title}}as {{title}}{{else}}hello{{/if}} today.' });
    // "Hi" + firstName + "as" + title + "hello" + "today"
    expect(r.metrics.words).toBe(6);
  });
});

describe('helpers', () => {
  it('counts English syllables roughly', () => {
    expect(syllableCount('cat')).toBe(1);
    expect(syllableCount('make')).toBe(1);
    expect(syllableCount('table')).toBe(2);
    expect(syllableCount('organisation')).toBe(5);
  });

  it('detects Vietnamese by its letters', () => {
    expect(detectLanguage('Chào anh, cảm ơn anh đã phản hồi.')).toBe('vi');
    expect(detectLanguage('Thanks for getting back to me.')).toBe('en');
    expect(detectLanguage('Café meeting at Phở 24?')).toBe('en');
  });
});
