/**
 * Merge values are data. They are escaped in an HTML body and cannot be expanded as merge fields
 * by a later render pass (a body is rendered by the route or sequence worker, then again by the
 * email worker).
 */
import { describe, it, expect } from 'vitest';

import { renderTemplate } from '@/lib/templates/render';
import { composeEmailBody } from '@/lib/email/signature';

const SDR = { firstName: 'Mei', lastName: 'Tran', role: 'sdr' };

describe('renderTemplate with hostile merge values', () => {
  it('HTML-escapes a value placed in an HTML body', () => {
    const out = renderTemplate('<p>Hi {{firstName}} at {{company}}</p>', { firstName: 'Linh', company: '<img src=x onerror=alert(1)>' }, SDR);
    expect(out).toBe('<p>Hi Linh at &lt;img src=x onerror=alert(1)&gt;</p>');
  });

  it('keeps the escaped value inert through the composed email', () => {
    const body = renderTemplate('<p>{{company}}</p>', { company: '<img src=x onerror=alert(1)>' }, SDR);
    const sent = composeEmailBody(body, true, null, null);
    expect(sent.html).not.toMatch(/<img/i);
  });

  it('leaves a plain-text body and a plain subject unescaped', () => {
    expect(renderTemplate('Hi {{company}}', { company: 'AT&T <Corp>' }, SDR)).toBe('Hi AT&T <Corp>');
  });

  it('does not let a value be expanded by a second render pass', () => {
    const lead = { firstName: '{{lastName}}', lastName: 'Secret' };
    const once = renderTemplate('Hi {{firstName}}', lead, SDR);
    const twice = renderTemplate(once, lead, SDR);
    expect(twice).toBe(once);
    expect(twice).not.toContain('Secret');
    expect(twice.replace(/​/g, '')).toBe('Hi {{lastName}}');
  });

  it('still fills ordinary values and fallbacks', () => {
    expect(renderTemplate('Hi {{firstName|there}}, {{sdrName}}', { firstName: '' }, SDR)).toBe('Hi there, Mei Tran');
  });
});
