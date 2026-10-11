/**
 * The pure pieces of the shared composer (PR 2): recipients, URLs, merge-field detection, the HTML
 * conversions and sanitiser, the attachment policy and the mailbox quota. No database.
 */
import { describe, it, expect } from 'vitest';
import { checkRecipients, isValidRecipient, normalizeCopyRecipients, splitRecipientInput, MAX_COPY_RECIPIENTS } from '@/lib/compose/recipients';
import { normalizeImageUrl, normalizeLinkUrl } from '@/lib/compose/urls';
import { addMergeFallback, findMergeTags, findMissingMergeValues } from '@/lib/compose/merge';
import {
  chipifyMergeTags, hasUnsupportedHtml, htmlToPlainText, isHtmlBlank, plainTextToHtml, sanitizeComposeHtml, unchipifyMergeTags,
} from '@/lib/compose/html';
import {
  checkAttachmentFile, cleanAttachmentName, extractInlineImages, MAX_ATTACHMENT_TOTAL_BYTES, base64DecodedSize,
} from '@/lib/compose/attachmentPolicy';
import { mailboxQuota } from '@/lib/email/mailboxQuota';
import { buildRawMime, copyRecipientFields } from '@/lib/email/adapters/copyRecipients';
import { blockRemoteImages, editorHtmlToStored, hasRemoteImages, restoreRemoteImages } from '@/lib/compose/html';
import { buildMergeContext, renderTemplate } from '@/lib/templates/render';

describe('recipients', () => {
  it('accepts plain addresses and rejects names, spaces and header injection', () => {
    expect(isValidRecipient('linh@acme.vn')).toBe(true);
    expect(isValidRecipient('Linh <linh@acme.vn>')).toBe(false);
    expect(isValidRecipient('a@b')).toBe(false);
    expect(isValidRecipient('a@b.com\r\nBcc: x@y.com')).toBe(false);
    expect(isValidRecipient('')).toBe(false);
  });

  it('splits pasted input on commas, semicolons and whitespace', () => {
    expect(splitRecipientInput('a@x.com, b@y.com;c@z.com\nd@w.com')).toEqual(['a@x.com', 'b@y.com', 'c@z.com', 'd@w.com']);
    expect(splitRecipientInput('  ')).toEqual([]);
  });

  it('lower-cases, de-duplicates and reports the invalid and the overflow', () => {
    const r = checkRecipients(['A@x.com', 'a@x.com', 'nope', 'b@y.com']);
    expect(r.valid).toEqual(['a@x.com', 'b@y.com']);
    expect(r.invalid).toEqual(['nope']);
    expect(r.tooMany).toBe(false);
    const many = Array.from({ length: MAX_COPY_RECIPIENTS + 1 }, (_, i) => `u${i}@x.com`);
    expect(checkRecipients(many).tooMany).toBe(true);
  });

  it('removes the main recipient from CC and BCC, and CC members from BCC', () => {
    const r = normalizeCopyRecipients('lead@acme.vn', ['Lead@acme.vn', 'boss@t.vn', 'boss@t.vn'], ['boss@t.vn', 'lead@acme.vn', 'audit@t.vn']);
    expect(r).toEqual({ cc: ['boss@t.vn'], bcc: ['audit@t.vn'] });
    expect(normalizeCopyRecipients('a@b.co', undefined, undefined)).toEqual({ cc: [], bcc: [] });
  });
});

describe('link and image URLs', () => {
  it('allows http, https and mailto, and adds https to a bare domain', () => {
    expect(normalizeLinkUrl('https://telestar.vn/book')).toBe('https://telestar.vn/book');
    expect(normalizeLinkUrl('http://telestar.vn')).toBe('http://telestar.vn');
    expect(normalizeLinkUrl('telestar.vn/book')).toBe('https://telestar.vn/book');
    expect(normalizeLinkUrl('mailto:sales@telestar.vn')).toBe('mailto:sales@telestar.vn');
    expect(normalizeLinkUrl('sales@telestar.vn')).toBe('mailto:sales@telestar.vn');
  });

  it('refuses javascript:, data:, file:, whitespace tricks and hostnames without a dot', () => {
    const bad = [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x', 'file:///etc/passwd', 'vbscript:x',
      'https://exa mple.com', 'https://localhost', '', '   ', 'java\nscript:alert(1)',
    ];
    for (const value of bad) expect(normalizeLinkUrl(value), value).toBeNull();
  });

  it('allows images from https only', () => {
    expect(normalizeImageUrl('https://cdn.telestar.vn/logo.png')).toBe('https://cdn.telestar.vn/logo.png');
    for (const value of ['http://cdn.telestar.vn/a.png', 'data:image/png;base64,AAAA', 'javascript:x', 'ftp://a.b/c.png', 'https://localhost/a.png']) {
      expect(normalizeImageUrl(value), value).toBeNull();
    }
  });
});

describe('merge fields', () => {
  const lead = { firstName: 'Linh', lastName: '', company: 'Acme', title: null, email: 'l@acme.vn', phone: '' };
  const ctx = buildMergeContext(lead, { firstName: 'Mei', lastName: 'Tran', role: 'sdr' });

  it('finds tags with and without a fallback and flags unknown fields', () => {
    const tags = findMergeTags('Hi {{firstName|there}}, {{ company }} {{nope}}');
    expect(tags.map((t) => [t.field, t.fallback, t.known])).toEqual([
      ['firstName', 'there', true],
      ['company', null, true],
      ['nope', null, false],
    ]);
  });

  it('reports only known fields the lead has no value for and that have no fallback, once each', () => {
    const missing = findMissingMergeValues('{{lastName}} {{lastName}} {{title}} {{phone|n/a}} {{firstName}} {{unknown}}', ctx);
    expect(missing.map((m) => m.field)).toEqual(['lastName', 'title']);
  });

  it('treats the sender fields as present when the sender has them', () => {
    expect(findMissingMergeValues('{{sdrName}} {{sdrTitle}}', ctx)).toEqual([]);
    expect(findMissingMergeValues('{{sdrName}}', buildMergeContext(lead)).map((m) => m.field)).toEqual(['sdrName']);
  });

  it('adds a fallback to bare tags only, and the rendered email then uses it', () => {
    const withFallback = addMergeFallback('Hi {{lastName}} / {{lastName|Mr}} / {{firstName}}', 'lastName', 'there');
    expect(withFallback).toBe('Hi {{lastName|there}} / {{lastName|Mr}} / {{firstName}}');
    expect(renderTemplate(withFallback, lead)).toBe('Hi there / Mr / Linh');
    expect(findMissingMergeValues(withFallback, ctx)).toEqual([]);
  });

  it('cannot be tricked into closing the tag from a fallback', () => {
    expect(addMergeFallback('{{lastName}}', 'lastName', 'a}}<b>|x')).toBe('{{lastName|a  <b> x}}');
    expect(addMergeFallback('{{lastName}}', 'lastName', '  ')).toBe('{{lastName}}');
  });
});

describe('HTML conversions', () => {
  it('turns merge tags in text into chips and back, byte for byte', () => {
    const html = '<p>Hi {{firstName|there}}, at {{company}}.</p>';
    const chips = chipifyMergeTags(html);
    expect(chips).toContain('data-merge-tag="firstName"');
    expect(chips).toContain('data-fallback="there"');
    expect(unchipifyMergeTags(chips)).toBe(html);
  });

  it('leaves a tag inside an attribute alone', () => {
    const html = '<p><a href="https://x.vn/?e={{email}}">link</a></p>';
    expect(chipifyMergeTags(html)).toBe(html);
  });

  it('never trusts a chip whose field name is not a plain identifier', () => {
    expect(unchipifyMergeTags('<span data-merge-tag="a}}<script>" data-fallback="">x</span>')).toBe('');
  });

  it('keeps paragraphs and line breaks through plain text', () => {
    expect(plainTextToHtml('Hi,\n\nLine one\nLine two')).toBe('<p>Hi,</p><p>Line one<br>Line two</p>');
    expect(htmlToPlainText('<p>Hi,</p><p>Line one<br>Line two</p><ul><li>a</li><li>b</li></ul>')).toBe('Hi,\n\nLine one\nLine two\n\n- a\n- b');
    expect(plainTextToHtml('1 < 2 & 3')).toBe('<p>1 &lt; 2 &amp; 3</p>');
  });

  it('knows a draft of empty paragraphs is blank, and one with an image is not', () => {
    expect(isHtmlBlank('<p></p><p><br></p>')).toBe(true);
    expect(isHtmlBlank('<p>hi</p>')).toBe(false);
    expect(isHtmlBlank('<p><img src="https://a.vn/x.png"></p>')).toBe(false);
  });

  it('stores the editor output without its trailing placeholder break, keeping a spacer paragraph', () => {
    expect(editorHtmlToStored('<p>Hi<br></p><p><br></p><p>a<br>b</p>')).toBe('<p>Hi</p><p><br></p><p>a<br>b</p>');
    expect(editorHtmlToStored('<ul><li><p>one</p></li><li><p>a</p><p>b</p></li></ul>')).toBe('<ul><li>one</li><li><p>a</p><p>b</p></li></ul>');
  });

  it('flags layout the editor cannot represent', () => {
    expect(hasUnsupportedHtml('<table><tr><td>x</td></tr></table>')).toBe(true);
    expect(hasUnsupportedHtml('<p style="color:red">x</p>')).toBe(true);
    expect(hasUnsupportedHtml('<p>x <strong>y</strong></p><ul><li>z</li></ul>')).toBe(false);
  });
});

describe('web images stay unloaded until the rep asks', () => {
  const html = '<p>Hi<img src="https://track.example/pixel.gif" alt="x"><img src="cid:cmp-1@telestar"></p>';

  it('swaps web images for a placeholder, keeping the address, and leaves cid and data images', () => {
    expect(hasRemoteImages(html)).toBe(true);
    const blocked = blockRemoteImages(html);
    expect(blocked).not.toMatch(/ src="https?:/);
    expect(blocked).toContain('data-remote-src="https://track.example/pixel.gif"');
    expect(blocked).toContain('src="cid:cmp-1@telestar"');
    expect(hasRemoteImages(blocked)).toBe(false);
  });

  it('restores the original markup, whatever order the editor writes the attributes in', () => {
    expect(restoreRemoteImages(blockRemoteImages(html)).replace(/ +/g, ' ')).toBe(html);
    const reordered = '<img alt="x" data-remote-src="https://a.example/i.png" src="data:image/gif;base64,AAAA">';
    expect(restoreRemoteImages(reordered)).toBe('<img alt="x" src="https://a.example/i.png">');
  });
});

describe('sanitizeComposeHtml', () => {
  it('keeps ordinary formatting, links and merge tags', () => {
    const html = '<p>Hi {{firstName|there}}, <strong>bold</strong> <em>i</em> <u>u</u> <a href="https://telestar.vn">site</a></p><ul><li>a</li></ul>';
    expect(sanitizeComposeHtml(html)).toBe(html);
  });

  it('removes script, handlers, iframes, forms and javascript: links', () => {
    const dirty =
      '<p onclick="x()">a</p><script>alert(1)</script><iframe src="https://e.vn"></iframe><form action="/x"><input></form><a href="javascript:alert(1)">b</a>';
    const clean = sanitizeComposeHtml(dirty);
    expect(clean).not.toMatch(/script|onclick|iframe|<form|<input|javascript:/i);
    expect(clean).toContain('a');
    expect(clean).toContain('b');
  });

  it('allows https, cid and small data images but not http or javascript images', () => {
    expect(sanitizeComposeHtml('<img src="https://cdn.vn/a.png">')).toContain('src="https://cdn.vn/a.png"');
    expect(sanitizeComposeHtml('<img src="cid:cmp-abc@telestar">')).toContain('cid:cmp-abc@telestar');
    expect(sanitizeComposeHtml('<img src="data:image/png;base64,AAAA">')).toContain('data:image/png;base64,AAAA');
    expect(sanitizeComposeHtml('<img src="http://cdn.vn/a.png">')).not.toContain('src=');
    expect(sanitizeComposeHtml('<img src="data:text/html;base64,AAAA">')).not.toContain('src=');
    expect(sanitizeComposeHtml('<img src="javascript:alert(1)">')).not.toContain('javascript');
  });

  it('drops a style that can fetch but keeps a plain one', () => {
    expect(sanitizeComposeHtml('<p style="background:url(https://t.vn/p.gif)">x</p>')).not.toContain('style');
    expect(sanitizeComposeHtml('<p style="color:red">x</p>')).toContain('style="color:red"');
  });
});

describe('attachment policy', () => {
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj');
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(16)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);

  it('accepts the allowlisted types by extension and signature, ignoring the browser type', () => {
    expect(checkAttachmentFile('Brochure.PDF', pdf)).toEqual({ ok: true, name: 'Brochure.PDF', contentType: 'application/pdf' });
    for (const name of ['a.docx', 'a.xlsx', 'a.pptx']) expect(checkAttachmentFile(name, zip).ok, name).toBe(true);
    expect(checkAttachmentFile('logo.png', png).ok).toBe(true);
    expect(checkAttachmentFile('notes.txt', Buffer.from('hello')).ok).toBe(true);
    expect(checkAttachmentFile('list.csv', Buffer.from('a,b\n1,2')).ok).toBe(true);
  });

  it('refuses other extensions, a mismatching signature, empty files and binary text', () => {
    expect(checkAttachmentFile('run.exe', Buffer.from('MZ')).ok).toBe(false);
    expect(checkAttachmentFile('page.html', Buffer.from('<b>x')).ok).toBe(false);
    expect(checkAttachmentFile('noextension', pdf).ok).toBe(false);
    expect(checkAttachmentFile('fake.pdf', Buffer.from('MZ\x90\x00')).ok).toBe(false);
    expect(checkAttachmentFile('fake.docx', pdf).ok).toBe(false);
    expect(checkAttachmentFile('empty.pdf', Buffer.alloc(0)).ok).toBe(false);
    expect(checkAttachmentFile('bin.txt', Buffer.from([0x41, 0x00, 0x42])).ok).toBe(false);
  });

  it('cleans a path-like or control-character name', () => {
    expect(cleanAttachmentName('..\\..\\evil/name"<x>.pdf')).toBe('namex.pdf');
    expect(cleanAttachmentName('a\r\nb.pdf')).toBe('ab.pdf');
    expect(cleanAttachmentName('.hidden.pdf')).toBe('hidden.pdf');
    expect(cleanAttachmentName('x'.repeat(300) + '.pdf').length).toBe(120);
  });

  it('measures base64 size and exposes the 10 MB total', () => {
    expect(base64DecodedSize(Buffer.from('hello').toString('base64'))).toBe(5);
    expect(MAX_ATTACHMENT_TOTAL_BYTES).toBe(10 * 1024 * 1024);
  });

  it('turns pasted data images into cid references and drops fakes', () => {
    const real = `data:image/png;base64,${png.toString('base64')}`;
    const fake = `data:image/png;base64,${Buffer.from('not an image').toString('base64')}`;
    const html = `<p><img src="${real}"><img src="${real}"><img src="${fake}"></p>`;
    const out = extractInlineImages(html, (_b, i) => `cid${i}@t`, 1024);
    expect(out.images).toHaveLength(1);
    expect(out.html).toBe('<p><img src="cid:cid0@t"><img src="cid:cid0@t"><img src=""></p>');
    expect(out.rejected).toBe(1);
    expect(extractInlineImages(html, () => 'x', 4).images).toHaveLength(0);
  });
});

describe('mailbox quota', () => {
  const now = new Date(2026, 9, 12, 10, 0, 0);
  it('counts today only and measures the hour against real sends', () => {
    const q = mailboxQuota({ dailyCap: 100, dailySendCount: 30, dailySendDate: new Date(2026, 9, 12, 8), hourlyCap: 40 }, 15, now);
    expect(q).toEqual({ dailyCap: 100, dailyRemaining: 70, hourlyCap: 40, hourlyRemaining: 25 });
  });
  it('starts a new day at zero, never goes negative, and has no hourly ceiling at 0', () => {
    expect(mailboxQuota({ dailyCap: 100, dailySendCount: 99, dailySendDate: new Date(2026, 9, 11, 23), hourlyCap: 0 }, 5, now)).toEqual({
      dailyCap: 100, dailyRemaining: 100, hourlyCap: 0, hourlyRemaining: null,
    });
    const over = mailboxQuota({ dailyCap: 10, dailySendCount: 50, dailySendDate: now, hourlyCap: 5 }, 9, now);
    expect(over.dailyRemaining).toBe(0);
    expect(over.hourlyRemaining).toBe(0);
  });
});

describe('adapter CC/BCC fields', () => {
  it('passes nothing when there are no copies', () => {
    expect(copyRecipientFields({})).toEqual({});
    expect(copyRecipientFields({ cc: [], bcc: [] })).toEqual({});
  });

  it('keeps the Bcc header only for providers that read recipients from the MIME', async () => {
    expect(copyRecipientFields({ cc: ['c@x.vn'], bcc: ['b@x.vn'] })).toEqual({ cc: ['c@x.vn'], bcc: ['b@x.vn'] });
    const copies = { cc: ['c@x.vn'], bcc: ['b@x.vn'] };
    // The proof that matters: the built MIME carries Cc and Bcc, or Gmail/Graph would send to nobody.
    const MailComposer = (await import('nodemailer/lib/mail-composer')).default;
    const mail = new MailComposer({ from: 'me@t.vn', to: 'lead@a.vn', subject: 's', text: 't', ...copyRecipientFields(copies) });
    const mime = (await buildRawMime(mail, copies)).toString();
    expect(mime).toMatch(/^Cc: c@x\.vn/m);
    expect(mime).toMatch(/^Bcc: b@x\.vn/m);
    const smtp = (
      await new MailComposer({ from: 'me@t.vn', to: 'lead@a.vn', subject: 's', text: 't', ...copyRecipientFields({ bcc: ['b@x.vn'] }) })
        .compile()
        .build()
    ).toString();
    expect(smtp).not.toMatch(/^Bcc:/m);
  });
});
