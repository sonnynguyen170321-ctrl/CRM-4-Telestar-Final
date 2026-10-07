import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { insertMergeTag } from '@/lib/templates/insertMergeTag';

/**
 * Owner request, 2026-10-07: insert variables into a template's subject line the way the body
 * already allows. The send path renders `{{field}}` in subjects (workers/sequence.ts,
 * workers/email.ts); only the editor had no way to put one there.
 */
describe('insertMergeTag', () => {
  it('inserts at the cursor', () => {
    expect(insertMergeTag('Hi  at Acme', 3, 3, 'firstName')).toEqual({ value: 'Hi {{firstName}} at Acme', cursor: 16 });
  });

  it('replaces the selected text', () => {
    expect(insertMergeTag('Quick question for Sarah', 19, 24, 'firstName')).toEqual({
      value: 'Quick question for {{firstName}}',
      cursor: 32,
    });
  });

  it('appends when the field has no cursor', () => {
    expect(insertMergeTag('Meeting with ', null, null, 'company').value).toBe('Meeting with {{company}}');
  });

  it('clamps a stale selection instead of cutting the text', () => {
    expect(insertMergeTag('Hello', 40, 99, 'company')).toEqual({ value: 'Hello{{company}}', cursor: 16 });
    expect(insertMergeTag('Hello', 4, 1, 'company').value).toBe('Hell{{company}}o');
  });
});

describe('the template editor', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'templates', 'page.tsx'), 'utf-8');

  it('offers the merge fields beside the subject', () => {
    expect(page).toContain('handleInsertSubjectField');
    expect(page).toContain('ref={subjectRef}');
  });

  // The preview used to render the body alone, so the author never saw the signature or the
  // spacing a prospect would get.
  it('previews through the same composition the send path uses', () => {
    expect(page).toContain("from '@/lib/email/composeBody'");
    expect(page).toContain('composeEmailContent(');
  });
});
