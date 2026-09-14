import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Every `dangerouslySetInnerHTML` that renders text a person typed must pass through DOMPurify.
 *
 * The template preview did not: `app/templates/page.tsx` rendered the merge-field-expanded
 * template body as raw markup, so a template containing `<img src=x onerror=...>` executed in
 * its author's session and in any reviewer's. The inbox page, twenty files away, sanitized the
 * same shape of content with the same dependency. Two standards in one repo is how the gap
 * reopened, so this pins the rule at the file level rather than trusting review to notice.
 *
 * The AI assistant is exempt: it builds its HTML from escaped text and its own `<strong>`/`<br/>`,
 * never from a user-supplied fragment.
 */
const ROOT = process.cwd();
const RENDERS_USER_HTML = ['app/templates/page.tsx', 'app/inbox/page.tsx'];

describe('user-authored HTML is sanitized before render', () => {
  for (const file of RENDERS_USER_HTML) {
    it(`${file} wraps every dangerouslySetInnerHTML in DOMPurify.sanitize`, () => {
      const source = readFileSync(path.join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

      const sites = [...source.matchAll(/dangerouslySetInnerHTML=\{\{[\s\S]*?\}\}/g)].map((m) => m[0]);
      expect(sites.length, `${file} has no dangerouslySetInnerHTML — the scan is stale`).toBeGreaterThan(0);

      for (const site of sites) {
        expect(site, `unsanitized render in ${file}:\n${site}`).toMatch(/DOMPurify\.sanitize\(/);
      }
      expect(source).toMatch(/from 'isomorphic-dompurify'/);
    });
  }
});
