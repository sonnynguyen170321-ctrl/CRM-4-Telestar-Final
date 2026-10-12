import { describe, expect, it } from 'vitest';
import { bodySnippet, bodyToText, isHtmlBody } from '@/lib/compose/snippet';

describe('bodySnippet', () => {
  it('strips divs and empty line spacers', () => {
    expect(bodySnippet('<div>Good day Anna,</div><div><br></div><div>Quick note.</div>')).toBe('Good day Anna, Quick note.');
  });

  it('keeps merge tags from a TipTap paragraph', () => {
    expect(bodySnippet('<p dir="ltr">Hi {{firstName}},</p>')).toBe('Hi {{firstName}},');
  });

  it('leaves plain text alone', () => {
    expect(bodyToText('Hello\r\nthere')).toBe('Hello\nthere');
    expect(isHtmlBody('1 < 2 and 3 > 2')).toBe(false);
  });

  it('truncates with an ellipsis and handles empty input', () => {
    expect(bodySnippet('<p>' + 'a'.repeat(300) + '</p>', 20)).toHaveLength(20);
    expect(bodySnippet('<p>' + 'a'.repeat(300) + '</p>', 20).endsWith('…')).toBe(true);
    expect(bodySnippet(null)).toBe('');
    expect(bodySnippet('<div><br></div>')).toBe('');
  });

  it('never returns markup or script text', () => {
    expect(bodySnippet('<p>Hi</p><script>alert(1)</script>')).not.toMatch(/[<>]/);
  });
});
