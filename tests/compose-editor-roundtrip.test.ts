/**
 * The composer's HTML round trip: stored HTML -> editor document -> stored HTML.
 *
 * Run through the real TipTap schema (`lib/compose/editorExtensions.ts`) with `@tiptap/html`, which
 * needs no browser. What this proves: a rep who opens an HTML template sees formatted text and never
 * raw tags, saving it again keeps the formatting, merge tags stay plain `{{field}}` text in the
 * stored form, and nothing dangerous survives the sanitiser afterwards.
 */
import { describe, it, expect } from 'vitest';
import { generateHTML, generateJSON } from '@tiptap/html/server';
import { composeExtensions } from '@/lib/compose/editorExtensions';
import { blockRemoteImages, chipifyMergeTags, editorHtmlToStored, sanitizeComposeHtml } from '@/lib/compose/html';

const extensions = composeExtensions();

/** What the editor does to a stored body: load it (merge tags become chips), then emit it. */
function roundTrip(stored: string): string {
  const doc = generateJSON(chipifyMergeTags(stored), extensions);
  return editorHtmlToStored(generateHTML(doc, extensions));
}

describe('editor round trip', () => {
  it('keeps bold, italic, underline, lists and links', () => {
    const stored =
      '<p>Hi {{firstName|there}},</p><p>We help <strong>sales teams</strong> <em>book</em> <u>more</u> meetings.</p>' +
      '<ul><li>Outbound</li><li>Qualification</li></ul><ol><li>One</li><li>Two</li></ol>' +
      '<p>See <a rel="noopener noreferrer" href="https://telestar.vn/book">our page</a>.</p>';
    expect(roundTrip(stored)).toBe(stored);
  });

  it('loads a merge tag as a chip node, not as text the rep has to read', () => {
    const doc = generateJSON(chipifyMergeTags('<p>Hi {{firstName|there}}</p>'), extensions);
    const inline = doc.content[0].content;
    expect(inline.map((n: { type: string }) => n.type)).toEqual(['text', 'mergeTag']);
    expect(inline[1].attrs).toEqual({ field: 'firstName', fallback: 'there' });
  });

  it('stores merge tags as plain text, never as chip markup', () => {
    const out = roundTrip('<p>{{company}} and {{lastName|Sir}}</p>');
    expect(out).toBe('<p>{{company}} and {{lastName|Sir}}</p>');
    expect(out).not.toContain('data-merge-tag');
  });

  it('shows an HTML template as formatted content, with no tags left as text', () => {
    const doc = generateJSON('<p>Hello <strong>there</strong></p>', extensions);
    const text = JSON.stringify(doc.content);
    expect(text).not.toContain('<strong>');
    expect(text).not.toContain('&lt;');
    expect(doc.content[0].content[1].marks[0].type).toBe('bold');
  });

  it('keeps an https image and a line break, drops what the schema does not know', () => {
    const out = roundTrip('<p>Line<br>two <img src="https://cdn.telestar.vn/logo.png" alt="logo"></p><table><tr><td>cell</td></tr></table>');
    expect(out).toContain('<br>');
    expect(out).toContain('src="https://cdn.telestar.vn/logo.png"');
    expect(out).not.toContain('<table');
    // The text of the dropped table is not lost, only its layout.
    expect(out).toContain('cell');
  });

  it('opens a web image unloaded and still stores the original address when the draft is edited', () => {
    const stored = '<p>Hi <img src="https://track.example/pixel.gif" alt="x"></p>';
    const doc = generateJSON(blockRemoteImages(chipifyMergeTags(stored)), extensions);
    const html = generateHTML(doc, extensions);
    // What the editor renders while images are not loaded: nothing from the web.
    expect(html).not.toMatch(/ src="https?:/);
    expect(editorHtmlToStored(html)).toContain('src="https://track.example/pixel.gif"');
    expect(editorHtmlToStored(html)).not.toContain('data-remote-src');
  });

  it('refuses a javascript: link at load time, and the sanitiser would remove it anyway', () => {
    const out = roundTrip('<p><a href="javascript:alert(1)">x</a></p>');
    expect(out).not.toContain('javascript:');
    expect(sanitizeComposeHtml('<p><a href="javascript:alert(1)">x</a></p>')).not.toContain('javascript:');
  });

  it('survives the sanitiser unchanged, so what the rep saved is what is queued', () => {
    const stored = roundTrip('<p>Hi {{firstName|there}}, <strong>meet</strong> <a href="https://telestar.vn">us</a></p>');
    expect(sanitizeComposeHtml(stored)).toBe(stored);
  });

  it('round trips the empty document to a blank paragraph', () => {
    expect(roundTrip('')).toBe('<p></p>');
  });
});
