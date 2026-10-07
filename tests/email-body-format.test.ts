import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMAIL_FONT_STYLE, composeEmailContent, formatEmailBodyHtml } from '@/lib/email/composeBody';
import { OutlookAdapter } from '@/lib/email/adapters/OutlookAdapter';

/**
 * Owner report, 2026-10-07: a template that looked right in the CRM arrived in Gmail with the
 * wrong spacing. The editor shows paragraphs with no margin; every mail client adds about a line
 * above and below a `<p>`, so each blank line typed became a double gap. The sent body now carries
 * the editor's own layout inline.
 */
describe('formatEmailBodyHtml — the body laid out as the editor shows it', () => {
  it('wraps the body in one font, size and leading', () => {
    expect(formatEmailBodyHtml('<p>Hi</p>', true)).toBe(`<div style="${EMAIL_FONT_STYLE}"><p style="margin: 0;">Hi</p></div>`);
  });

  it('gives every paragraph the editor’s zero margin, so a blank line is the only gap', () => {
    const html = formatEmailBodyHtml('<p>Hi Linh,</p><p><br></p><p dir="ltr">Quick question.</p>', true);

    expect(html.match(/<p\b[^>]*style="margin: 0;"/g)).toHaveLength(3);
    expect(html).toContain('<p dir="ltr" style="margin: 0;">Quick question.</p>');
  });

  it('keeps a margin the author set, by putting the default first', () => {
    const html = formatEmailBodyHtml('<p style="margin-bottom: 12px">A</p>', true);

    expect(html).toContain('<p style="margin: 0; margin-bottom: 12px">A</p>');
  });

  // Review findings on the first cut, which matched `style=` with a loose regex.
  it('reads attributes whole: a "style" inside another value, unquoted styles, `$` and `>` in values', () => {
    expect(formatEmailBodyHtml(`<p data-x="a style='b'">A</p>`, true)).toContain(
      `<p data-x="a style='b'" style="margin: 0;">A</p>`,
    );
    expect(formatEmailBodyHtml('<p style=color:red>A</p>', true)).toContain('<p style="margin: 0; color:red">A</p>');
    expect(formatEmailBodyHtml(`<p style="font-family: 'A$&B'">A</p>`, true)).toContain(
      `<p style="margin: 0; font-family: 'A$&B'">A</p>`,
    );
    expect(formatEmailBodyHtml('<p title="a > b">A</p>', true)).toContain('<p title="a > b" style="margin: 0;">A</p>');
    expect(formatEmailBodyHtml('<P/>', true)).toContain('<p style="margin: 0;" />');
  });

  it('carries a single-quoted style that holds double quotes', () => {
    expect(formatEmailBodyHtml(`<p style='font-family: "Arial"'>A</p>`, true)).toContain(
      '<p style="margin: 0; font-family: &quot;Arial&quot;">A</p>',
    );
  });

  it('indents lists the way the editor does', () => {
    const html = formatEmailBodyHtml('<ul><li>One</li></ul><ol class="x"><li>Two</li></ol>', true);

    expect(html).toContain('<ul style="margin: 0; padding-left: 24px;">');
    expect(html).toContain('<ol class="x" style="margin: 0; padding-left: 24px;">');
  });

  it('leaves tags that only start with p alone', () => {
    const html = formatEmailBodyHtml('<pre>code</pre><param name="a">', true);

    expect(html).toContain('<pre>code</pre>');
    expect(html).toContain('<param name="a">');
  });

  // Outlook desktop ignores `white-space: pre-wrap`; it ran a plain message into one paragraph.
  it('turns a plain-text body’s line breaks into <br>, escaped', () => {
    const html = formatEmailBodyHtml('Hi <Linh>,\r\n\r\nQuick question.', false);

    expect(html).toBe(`<div style="${EMAIL_FONT_STYLE}">Hi &lt;Linh&gt;,<br><br>Quick question.</div>`);
    expect(html).not.toContain('pre-wrap');
  });
});

describe('composeEmailContent — shared by the send path and the template preview', () => {
  it('returns the signature it placed, so the preview shows exactly what is sent', () => {
    const out = composeEmailContent('<p>Hi</p>', true, '<p>Mei Phuong</p>');

    expect(out.signatureHtml).toBe('<p>Mei Phuong</p>');
    expect(out.html.endsWith('<br><div><p>Mei Phuong</p></div>')).toBe(true);
  });

  it('reports no signature for a mailbox without one', () => {
    expect(composeEmailContent('<p>Hi</p>', true, null).signatureHtml).toBeNull();
  });
});

describe('OutlookAdapter.send', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the MIME message base64-encoded, as Graph sendMail requires', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new OutlookAdapter({ accessToken: 'token', refreshToken: 'refresh' } as never);

    await adapter.send({ from: 'mei@nekko.tech', to: 'linh@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('text/plain');
    expect(init.body).toMatch(/^[A-Za-z0-9+/=]+$/);
    const mime = Buffer.from(init.body, 'base64').toString('utf-8');
    expect(mime).toContain('Subject: Hello');
    expect(mime).toContain('To: linh@example.com');
  });
});
