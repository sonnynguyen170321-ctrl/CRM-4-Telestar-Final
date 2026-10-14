/**
 * Second security re-review of the composer AI rewrite (d9fa9577):
 *
 *  1. htmlToPlainText was quadratic in the number of tags (DOMPurify removing every element with
 *     KEEP_CONTENT): 20 KB of `<p>x</p>` took 8 s, and the content score ran it twice. It now parses
 *     once into an inert document and walks the text; the output is the same as before (checked here
 *     against the old algorithm over a corpus).
 *  2. A bare domain with a merge token (`evil.com/?e={{email}}`) is refused like a link.
 *  3. Unreviewed AI HTML loses positioning styles (`position:fixed; inset:0` overlays).
 *  4. The shared sanitiser refuses HTML too deep or too large to process (a stack overflow at 12k
 *     nested divs), with a typed error the send paths turn into a clear 413.
 */
import { describe, it, expect } from 'vitest';
import DOMPurify from 'isomorphic-dompurify';

import {
  ComposeHtmlTooComplexError,
  composeHtmlShapeProblem,
  htmlToPlainText,
  readHtml,
  sanitizeComposeHtml,
  sanitizePreviewHtml,
} from '@/lib/compose/html';
import { scoreContent } from '@/lib/compose/contentScore';
import { protectTokens, validateRewrite, rewriteInputProblem } from '@/lib/compose/rewrite';
import { prepareComposed } from '@/lib/email/prepareComposed';

/**
 * The best of three runs: wall-clock time in a parallel test run includes other files' work, and
 * the fastest run is the closest to the function's own cost.
 */
const timed = (f: () => unknown) => {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    f();
    best = Math.min(best, performance.now() - start);
  }
  return best;
};

/** The implementation htmlToPlainText replaced, kept here as the reference its output must match. */
function referencePlainText(html: string): string {
  const marked = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|blockquote|ul|ol)>/gi, '$&\n\n')
    .replace(/<\/li>/gi, '$&\n')
    .replace(/<li\b[^>]*>/gi, '- ');
  const fragment = DOMPurify.sanitize(marked, { ALLOWED_TAGS: [], KEEP_CONTENT: true, RETURN_DOM_FRAGMENT: true });
  return (fragment.textContent ?? '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const CORPUS = [
  '<p>Hi {{firstName|there}},</p><p>We help <strong>teams</strong> at {{company}}.</p>',
  '<p>Line one<br>line two<br/>line three</p>',
  '<ul><li>One</li><li><p>Two</p></li><li class="x">Three</li></ul><ol><li>A</li></ol>',
  '<h1>Title</h1><blockquote>Quoted &amp; kept</blockquote><div>div text</div>',
  '<p>Entities: &lt;b&gt; &quot;q&quot; &eacute; &hellip; &nbsp;nbsp &#8212; &#x2014;</p>',
  '<style>p { color: red }</style><p>after style</p><script>alert(1)</script><p>after script</p>',
  '<title>T</title><p>after title</p><noscript>ns</noscript><template><p>tpl</p></template>',
  '<table><thead><tr><th>Head</th></tr></thead><tbody><tr><td>Cell</td><td>Two</td></tr></tbody></table>',
  '<svg><text>svg text</text></svg><math><mi>x</mi></math><p>after svg</p>',
  '<!-- a comment --><p>after comment</p><p>a < b and c > d</p>',
  '<p>trailing spaces   </p>\n\n\n\n<p>tabs\t\t</p>',
  'plain text, no markup at all',
  '<p>unclosed <b>bold <i>italic</p><p>next',
  '<img src="https://x.test/a.png" alt="alt text"><p>after image</p>',
  '<a href="https://telestar.test">link text</a> and <span data-merge-tag="firstName">{{firstName}}</span>',
  '  <p>leading whitespace</p>',
  '<xmp><b>raw</b></xmp><textarea><b>ta</b></textarea><p>end</p>',
  '<p>Chào anh, cảm ơn anh đã phản hồi.</p>',
];

describe('1. htmlToPlainText: linear, and the same output as before', () => {
  for (const html of CORPUS) {
    it(`matches the reference for ${JSON.stringify(html.slice(0, 40))}`, () => {
      expect(htmlToPlainText(html)).toBe(referencePlainText(html));
    });
  }

  it('is linear in the number of tags, and survives deep nesting', () => {
    htmlToPlainText('<p>warm up the parser</p>');
    for (const html of ['<p>x</p>'.repeat(2_500), '<img >'.repeat(3_333), '<foo>x</foo>'.repeat(1_666), '<div>'.repeat(12_000)]) {
      expect(timed(() => htmlToPlainText(html)), html.slice(0, 12)).toBeLessThan(200);
    }
  });

  it('grows linearly: four times the tags costs well under sixteen times the time', () => {
    const small = timed(() => htmlToPlainText('<p>x</p>'.repeat(1_000)));
    const large = timed(() => htmlToPlainText('<p>x</p>'.repeat(4_000)));
    // Quadratic growth is 16x; linear is 4x. 8x leaves room for noise and still fails the old version.
    expect(large / Math.max(small, 1)).toBeLessThan(8);
  });

  it('readHtml reads text, links and images in one parse', () => {
    const parts = readHtml('<p>See <a href="https://a.test">https://a.test</a> or www.b.test</p><img src="https://c.test/x.png"><a>no href</a>');
    expect(parts.text).toBe(htmlToPlainText('<p>See <a href="https://a.test">https://a.test</a> or www.b.test</p><img src="https://c.test/x.png"><a>no href</a>'));
    expect(parts.links).toBe(1);
    expect(parts.images).toBe(1);
    expect(parts.textOutsideLinks).not.toContain('https://a.test');
    expect(parts.textOutsideLinks).toContain('www.b.test');
  });

  it('the content score of 20k characters of tags takes under 200 ms', () => {
    for (const body of ['<p>x</p>'.repeat(2_500), '<img >'.repeat(3_333)]) {
      expect(timed(() => scoreContent({ subject: 'Idea', body }))).toBeLessThan(200);
    }
  });
});

describe('2. a bare domain with a merge token', () => {
  it('is refused in a plain-text draft', () => {
    const input = 'Hi {{firstName}}, your address is {{email}}.';
    const p = protectTokens(input);
    const out = p.masked.replace('your address is [[T2]].', 'see evil.com/?e=[[T2]]');
    expect(validateRewrite(input, p, out, false)).toMatchObject({ ok: false, reason: 'token_in_link' });
  });

  it('is refused in an HTML draft, with or without a path', () => {
    const input = '<p>Hi {{firstName}}, about {{company}}.</p>';
    const p = protectTokens(input);
    for (const run of ['evil.com/?e=[[T2]]', 'evil.com?c=[[T2]]', '[[T2]].evil.tld', 'x.io#[[T2]]']) {
      const out = p.masked.replace('about [[T2]].', `visit ${run} now`);
      expect(validateRewrite(input, p, out, true)).toMatchObject({ ok: false, reason: 'token_in_link' });
    }
  });

  it('is allowed when the same run was in the draft', () => {
    const input = '<p>Hi {{firstName}}, see {{website}}/pricing today.</p>';
    const p = protectTokens(input);
    const out = p.masked.replace('today', 'this week');
    expect(validateRewrite(input, p, out, true).ok).toBe(true);
  });

  it('leaves ordinary punctuation next to a token alone', () => {
    const input = 'Hi {{firstName}}, thanks. Talk soon, {{senderFirstName}}!';
    const p = protectTokens(input);
    expect(validateRewrite(input, p, p.masked.replace('thanks.', 'many thanks.'), false).ok).toBe(true);
  });
});

describe('3. positioning styles in unreviewed AI HTML', () => {
  it('the preview drops position, inset, z-index, float and offsets, and keeps the rest', () => {
    const out = sanitizePreviewHtml('<div style="position:fixed;inset:0;z-index:9999;color:red">x</div><p style="float:left; TOP: 0; left:0;right:0;bottom:0;font-weight:bold">y</p>');
    expect(out).not.toMatch(/position|inset|z-index|float|top|left|right|bottom/i);
    expect(out).toContain('color:red');
    expect(out).toContain('font-weight:bold');
  });

  it('a style that is only positioning goes entirely, and a commented style is dropped', () => {
    expect(sanitizePreviewHtml('<div style="position:fixed;inset:0">x</div>')).toBe('<div>x</div>');
    expect(sanitizePreviewHtml('<div style="/**/position:fixed">x</div>')).toBe('<div>x</div>');
  });

  it('a rewrite cannot add an overlay to the draft', () => {
    const input = '<p>Hi {{firstName}}</p>';
    const p = protectTokens(input);
    const r = validateRewrite(input, p, `<div style="position:fixed;inset:0;background-color:white">${p.masked}</div>`, true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).not.toMatch(/position|inset/);
  });
});

describe('4. HTML too deep or too large for the sanitiser', () => {
  it('names the problem, and passes ordinary email', () => {
    expect(composeHtmlShapeProblem('<div>'.repeat(101))).toMatch(/nested/i);
    expect(composeHtmlShapeProblem('<b>x</b>'.repeat(5_001))).toMatch(/elements/i);
    expect(composeHtmlShapeProblem(CORPUS.join(''))).toBeNull();
    // Elements that close themselves (p, li, td...) never nest that deep in the parser.
    expect(composeHtmlShapeProblem('<p>para'.repeat(300))).toBeNull();
    expect(composeHtmlShapeProblem('<img src="https://a.test/x.png"><br>'.repeat(200))).toBeNull();
  });

  it('a stray end tag does not hide nesting', () => {
    expect(composeHtmlShapeProblem('<div></span>'.repeat(150))).toMatch(/nested/i);
  });

  it('sanitizeComposeHtml refuses 12k nested divs fast, with a typed error', () => {
    let thrown: unknown;
    const ms = timed(() => { try { sanitizeComposeHtml('<div>'.repeat(12_000)); } catch (err) { thrown = err; } });
    expect(thrown).toBeInstanceOf(ComposeHtmlTooComplexError);
    expect(ms).toBeLessThan(200);
  });

  it('the send path answers 413 with the reason, not a 500', async () => {
    const res = await prepareComposed({
      tenantId: 'tenant-x', userId: 'user-x', campaignId: null, to: 'a@b.test', body: '<div>'.repeat(12_000),
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.status).toBe(413);
    expect((await res.response.json()).error).toMatch(/nested/i);
  });

  it('the rewrite refuses it before any parsing', () => {
    expect(rewriteInputProblem('<div>'.repeat(200))).toMatch(/nested/i);
  });
});
