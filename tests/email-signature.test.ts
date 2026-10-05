import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import {
  SIGNATURE_LIMITS,
  composeEmailBody,
  editableSignature,
  prepareSignatureForStorage,
  signatureForSend,
} from '@/lib/email/signature';
import { buildSignatureHtml } from '@/lib/email/signatureBuilder';

/**
 * Designed email signatures (owner, 2026-10-05: "make/edit all kind of signatures like the one Mei
 * just shared" — logo, name, title, phone, email in a two-column card).
 *
 * The editor speaks HTML with pasted images inline as data URIs. Storage moves those images into
 * `EmailAccount.signatureImages` and leaves `cid:` references behind, because Gmail and Outlook
 * do not render data-URI images; the send path attaches them inline under the same content id.
 */

// A real 1x1 PNG and a real 1x1 GIF — the magic bytes are what the validator checks.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const pngUri = `data:image/png;base64,${PNG}`;

describe('prepareSignatureForStorage', () => {
  it('moves a pasted image into the image list and leaves a cid reference', () => {
    const result = prepareSignatureForStorage(`<p>Mei</p><img src="${pngUri}" alt="Nekko">`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({ contentType: 'image/png', data: PNG });
    expect(result.html).toContain(`src="cid:sig-${result.images[0].id}"`);
    expect(result.html).not.toContain('data:');
  });

  it('stores the same image once however many times it appears', () => {
    const result = prepareSignatureForStorage(`<img src="${pngUri}"><img src="${pngUri}">`);

    expect(result.ok && result.images).toHaveLength(1);
  });

  it('keeps hosted images as links — a Gmail-pasted logo already lives on a URL', () => {
    const result = prepareSignatureForStorage('<img src="https://lh3.googleusercontent.com/logo.png">');

    expect(result.ok && result.images).toHaveLength(0);
    expect(result.ok && result.html).toContain('src="https://lh3.googleusercontent.com/logo.png"');
  });

  it('keeps the layout markup a designed signature needs', () => {
    const html =
      '<table cellpadding="0" cellspacing="0" style="font-family:Arial"><tbody><tr>' +
      '<td style="border-right:3px solid #1F6FB2;padding-right:16px" valign="middle">x</td>' +
      '<td><b style="color:#E8833A">Mei</b> <a href="tel:+84968052740">+84 968052740</a> ' +
      '<a href="mailto:mei@nekko.tech">mei@nekko.tech</a></td></tr></tbody></table>';

    const result = prepareSignatureForStorage(html);

    expect(result.ok && result.html).toBe(html);
  });

  it.each([
    ['a script', '<p>hi</p><script>alert(1)</script>', '<p>hi</p>'],
    ['an event handler', '<img src="https://x.test/a.png" onerror="alert(1)">', '<img src="https://x.test/a.png">'],
    ['a javascript: link', '<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
    ['an SVG image, which can carry script', '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">', '<img>'],
    ['an iframe', '<iframe src="https://x.test"></iframe><p>ok</p>', '<p>ok</p>'],
    ['a stylesheet url()', '<td style="background:url(https://track.test/p.gif);color:red">x</td>', 'x'],
  ])('removes %s', (_label, input, expected) => {
    const result = prepareSignatureForStorage(input);

    expect(result.ok).toBe(true);
    expect(result.ok && result.html).toContain(expected);
    expect(result.ok && result.html).not.toMatch(/script|onerror|javascript:|svg|iframe|url\(/i);
  });

  it('refuses an image whose bytes are not what its type claims', () => {
    const result = prepareSignatureForStorage(`<img src="data:image/png;base64,${GIF}">`);

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/not a valid png/i) });
  });

  it('refuses an image over the size limit, and says which limit', () => {
    const big = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(SIGNATURE_LIMITS.maxImageBytes)]);
    const result = prepareSignatureForStorage(`<img src="data:image/png;base64,${big.toString('base64')}">`);

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/KB/) });
  });

  it('accepts every image the limits advertise — five just under the per-image cap', () => {
    const images = Array.from({ length: SIGNATURE_LIMITS.maxImages }, (_, i) => {
      const bytes = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(SIGNATURE_LIMITS.maxImageBytes - 200, i)]);
      return `<img src="data:image/png;base64,${bytes.toString('base64')}">`;
    }).join('');

    const result = prepareSignatureForStorage(images);

    expect(result.ok && result.images).toHaveLength(SIGNATURE_LIMITS.maxImages);
  });

  it.each([
    ['a CSS escape spelling url(', 'background:u\\72l(https://track.test/p.gif)'],
    ['image-set()', "background:image-set('https://track.test/p.gif' 1x)"],
  ])('drops a style that fetches through %s', (_label, style) => {
    const result = prepareSignatureForStorage(`<p style="${style}">x</p>`);

    expect(result.ok && result.html).toBe('<p>x</p>');
  });

  it('refuses more images than the limit', () => {
    const many = Array.from({ length: SIGNATURE_LIMITS.maxImages + 1 }, (_, i) => {
      const bytes = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from([i])]);
      return `<img src="data:image/png;base64,${bytes.toString('base64')}">`;
    }).join('');

    expect(prepareSignatureForStorage(many)).toEqual({ ok: false, error: expect.stringMatching(/images/i) });
  });

  it('treats an empty signature as none', () => {
    expect(prepareSignatureForStorage('  <p></p> ')).toEqual({ ok: true, html: null, images: [] });
  });
});

describe('round trip: store, edit, send', () => {
  it('gives the editor back exactly the images it saved', () => {
    const stored = prepareSignatureForStorage(`<img src="${pngUri}">`);
    if (!stored.ok) throw new Error('setup');

    expect(editableSignature(stored.html, stored.images)).toBe(`<img src="${pngUri}">`);
  });

  it('attaches each referenced image inline under its cid, and nothing unreferenced', () => {
    const stored = prepareSignatureForStorage(`<img src="${pngUri}">`);
    if (!stored.ok || !stored.html) throw new Error('setup');
    const orphan = { id: 'orphan', contentType: 'image/gif' as const, data: GIF };

    const sent = signatureForSend(stored.html, [...stored.images, orphan]);

    expect(sent.html).toContain(`cid:sig-${stored.images[0].id}`);
    expect(sent.attachments).toEqual([
      {
        filename: `signature-${stored.images[0].id}.png`,
        content: Buffer.from(PNG, 'base64'),
        contentType: 'image/png',
        cid: `sig-${stored.images[0].id}`,
      },
    ]);
  });

  it('reaches the wire as an inline MIME part — the composer all three adapters use', async () => {
    const stored = prepareSignatureForStorage(`<img src="${pngUri}">`);
    if (!stored.ok || !stored.html) throw new Error('setup');
    const sent = signatureForSend(stored.html, stored.images);
    const MailComposer = (await import('nodemailer/lib/mail-composer')).default;

    const mime = (
      await new MailComposer({ from: 'mei@nekko.tech', to: 'p@x.test', subject: 'Hi', html: sent.html, attachments: sent.attachments })
        .compile()
        .build()
    ).toString('utf8');

    expect(mime).toContain(`Content-ID: <sig-${stored.images[0].id}>`);
    expect(mime).toMatch(/Content-Disposition: inline/);
    expect(mime).toMatch(/multipart\/related/);
  });

  it('ignores a stored image list it cannot read rather than failing the send', () => {
    expect(signatureForSend('<p>Mei</p>', 'not an array').attachments).toEqual([]);
    expect(signatureForSend('<p>Mei</p>', [{ id: 1 }]).attachments).toEqual([]);
  });
});

describe('buildSignatureHtml', () => {
  const mei = {
    closing: 'Best regards,',
    shortName: 'Mei',
    firstName: 'Mei',
    lastName: 'Phuong',
    title: 'Business Development Manager',
    phone: '+84 968052740',
    email: 'mei@nekko.tech',
    website: 'www.nekko.tech',
    logoSrc: pngUri,
    accentColor: '#1F6FB2',
    nameColor: '#E8833A',
    layout: 'logo-left' as const,
  };

  it('renders the logo-left card with every field, linked', () => {
    const html = buildSignatureHtml(mei);

    expect(html).toContain('Best regards,');
    expect(html).toContain('Business Development Manager');
    expect(html).toContain('href="tel:+84968052740"');
    expect(html).toContain('href="mailto:mei@nekko.tech"');
    expect(html).toContain('href="https://www.nekko.tech"');
    expect(html).toContain('border-left:3px solid #1F6FB2');
    expect(html).toContain(`src="${pngUri}"`);
  });

  it('survives storage unchanged — the builder only emits what the sanitizer keeps', () => {
    for (const layout of ['logo-left', 'stacked', 'minimal'] as const) {
      const html = buildSignatureHtml({ ...mei, logoSrc: 'https://nekko.tech/logo.png', layout });
      const stored = prepareSignatureForStorage(html);

      expect(stored.ok && stored.html).toBe(html);
    }
  });

  it('escapes what a rep types and drops a colour that is not a colour', () => {
    const html = buildSignatureHtml({ ...mei, title: '<script>x</script> & Co', accentColor: 'red;background:url(x)' });

    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; Co');
    expect(html).not.toContain('url(x)');
  });

  it('leaves out lines that are empty', () => {
    const html = buildSignatureHtml({ ...mei, phone: '', website: '', logoSrc: '' });

    expect(html).not.toContain('tel:');
    expect(html).not.toContain('<img');
  });
});

describe('composeEmailBody — the message with its signature, as a prospect receives it', () => {
  const card = '<table><tbody><tr><td><b>Mei</b> <b>Phuong</b></td></tr><tr><td>mei@nekko.tech</td></tr></tbody></table>';
  const designed = `<p>Best regards,<br>Mei</p><img src="cid:sig-0123456789abcdef">${card}`;
  const images = [{ id: '0123456789abcdef', contentType: 'image/png', data: PNG }];

  it('puts the designed signature under an HTML body and attaches its images', () => {
    const out = composeEmailBody('<p>Hello Linh</p>', true, designed, images);

    expect(out.html).toBe(`<p>Hello Linh</p><br><br>--<br>${designed}`);
    expect(out.attachments.map((a) => a.cid)).toEqual(['sig-0123456789abcdef']);
    expect(out.text).toContain('Hello Linh');
    expect(out.text).toContain('-- \nBest regards,\nMei');
  });

  // The reported defect: a message typed as plain text (the lead-panel composer) got the signature
  // run through a tag stripper, so the logo and the layout never reached the prospect.
  it('keeps the designed signature, images included, under a plain-text body', () => {
    const out = composeEmailBody('Hi Linh,\nQuick question.', false, designed, images);

    expect(out.html).toContain(designed);
    expect(out.html).toContain('white-space: pre-wrap');
    expect(out.attachments).toHaveLength(1);
    expect(out.text.startsWith('Hi Linh,\nQuick question.\n\n-- \n')).toBe(true);
  });

  it('escapes a plain-text body instead of letting it be read as markup', () => {
    const out = composeEmailBody('Is 3 < 5 & 5 > 3?', false, null, null);

    expect(out.html).toContain('Is 3 &lt; 5 &amp; 5 &gt; 3?');
    expect(out.text).toBe('Is 3 < 5 & 5 > 3?');
  });

  it('changes nothing when the mailbox has no signature', () => {
    expect(composeEmailBody('<p>Hello</p>', true, null, null)).toEqual({ html: '<p>Hello</p>', text: 'Hello', attachments: [] });
    expect(composeEmailBody('<p>Hello</p>', true, '   ', null).html).toBe('<p>Hello</p>');
  });

  it('keeps the line breaks of a plain-text signature saved before the designer existed', () => {
    const out = composeEmailBody('<p>Hello</p>', true, 'Mei Phuong\nNekko & Co', null);

    expect(out.html).toContain('Mei Phuong<br>Nekko &amp; Co');
    expect(out.text).toContain('Mei Phuong\nNekko & Co');
  });

  // Reps end templates with a hand-typed sign-off; the builder's signature opens with its own.
  it('drops the signature’s own closing when the message already signs off', () => {
    const body = '<p>Happy to share examples.</p><p>Best regards,</p><p>Mei</p>';
    const out = composeEmailBody(body, true, designed, images);

    expect(out.html.match(/Best regards,/g)).toHaveLength(1);
    expect(out.html).toContain(card);
    expect(out.attachments).toHaveLength(1);
  });

  it('keeps the closing when the message does not sign off, or only thanks the reader in a sentence', () => {
    expect(composeEmailBody('<p>Happy to share examples.</p>', true, designed, images).html).toContain('Best regards,<br>Mei');
    expect(composeEmailBody('<p>Thanks for your time today.</p>', true, designed, images).html).toContain('Best regards,<br>Mei');
  });

  // A signature pasted from Gmail is often a single block. Dropping "the closing paragraph" there
  // would drop the name, title and phone with it.
  it('leaves a one-block signature whole even when the message signs off', () => {
    const flat = '<div>Best regards,<br>Mei Phuong<br>Business Development Manager<br>+84 968052740</div><img src="https://nekko.tech/logo.png">';
    const out = composeEmailBody('<p>Hi</p><p>Best regards,</p><p>Mei</p>', true, flat, null);
    expect(out.html).toContain(flat);
  });

  it('leaves a signature whole when its closing sits inside a wrapper block', () => {
    const wrapped = '<div dir="ltr"><div>Best regards,</div><div>Mei Phuong · CEO</div></div>';
    const out = composeEmailBody('<p>Hi</p><p>Thanks,</p>', true, wrapped, null);
    expect(out.html).toContain(wrapped);
  });

  it('never drops a signature that is nothing but a closing', () => {
    const out = composeEmailBody('<p>Hi</p><p>Thanks,</p>', true, '<p>Best regards,<br>Mei</p>', null);
    expect(out.html).toContain('<p>Best regards,<br>Mei</p>');
  });
});

describe('PATCH and GET /api/email/accounts/[id]', () => {
  const findUnique = vi.fn();
  const update = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    findUnique.mockReset();
    update.mockReset();
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        emailAccount: {
          findUnique: (...a: unknown[]) => findUnique(...a),
          update: (...a: unknown[]) => update(...a),
        },
      },
    }));
    vi.doMock('@/lib/auth', () => ({
      requireAuth: async () => ({ id: 'user-mei', role: 'sdr', tenantId: 't1' }),
    }));
  });

  const req = (method: string, body?: unknown) =>
    new NextRequest('http://localhost:3000/api/email/accounts/acc-1', {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    });
  const params = { params: Promise.resolve({ id: 'acc-1' }) };

  it('stores the cid form and the extracted images, and answers with the editable form', async () => {
    findUnique.mockResolvedValue({ id: 'acc-1', userId: 'user-mei' });
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'acc-1', email: 'mei@nekko.tech', provider: 'imap', isActive: true, fromName: null, ...data,
    }));
    const { PATCH } = await import('@/app/api/email/accounts/[id]/route');

    const res = await PATCH(req('PATCH', { signature: `<p>Mei</p><img src="${pngUri}">` }), params);
    const body = await res.json();

    const data = update.mock.calls[0][0].data;
    expect(data.signature).toMatch(/^<p>Mei<\/p><img src="cid:sig-[0-9a-f]+">$/);
    expect(data.signatureImages).toEqual([expect.objectContaining({ contentType: 'image/png', data: PNG })]);
    expect(res.status).toBe(200);
    expect(body.signature).toBe(`<p>Mei</p><img src="${pngUri}">`);
    expect(body).not.toHaveProperty('signatureImages');
  });

  it('refuses an invalid image with 400 and stores nothing', async () => {
    findUnique.mockResolvedValue({ id: 'acc-1', userId: 'user-mei' });
    const { PATCH } = await import('@/app/api/email/accounts/[id]/route');

    const res = await PATCH(req('PATCH', { signature: `<img src="data:image/png;base64,${GIF}">` }), params);

    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('clears the images with the signature', async () => {
    findUnique.mockResolvedValue({ id: 'acc-1', userId: 'user-mei' });
    update.mockResolvedValue({ id: 'acc-1', signature: null, signatureImages: null });
    const { PATCH } = await import('@/app/api/email/accounts/[id]/route');

    await PATCH(req('PATCH', { signature: null }), params);

    expect(update.mock.calls[0][0].data).toEqual(expect.objectContaining({ signature: null, signatureImages: [] }));
  });

  it('GET returns the editable signature to the owner only', async () => {
    const stored = prepareSignatureForStorage(`<img src="${pngUri}">`);
    if (!stored.ok) throw new Error('setup');
    findUnique.mockResolvedValue({ id: 'acc-1', userId: 'user-mei', signature: stored.html, signatureImages: stored.images });
    const { GET } = await import('@/app/api/email/accounts/[id]/route');

    const mine = await GET(req('GET'), params);
    findUnique.mockResolvedValue({ id: 'acc-1', userId: 'someone-else', signature: stored.html, signatureImages: stored.images });
    const theirs = await GET(req('GET'), params);

    expect(await mine.json()).toEqual({ signature: `<img src="${pngUri}">` });
    expect(theirs.status).toBe(403);
  });
});
