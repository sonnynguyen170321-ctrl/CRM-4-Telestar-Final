import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));


const { sipUserOf } = await import('@/lib/telephony/parked');

/** The proxy's session exemption for the webhook is that path only, not a prefix of it. */
describe('the proxy exemption for the Telnyx webhook', () => {
  const matcher = readFileSync(join(process.cwd(), 'proxy.ts'), 'utf8').match(/'\/\(\(\?!([^)]*)\)\.\*\)'/)?.[1] ?? '';
  const exempt = (path: string) => new RegExp(`^/(?!${matcher}).*`).test(path) === false;

  it('exempts the webhook itself', () => {
    expect(exempt('/api/telephony/telnyx/webhook')).toBe(true);
    expect(exempt('/api/telephony/telnyx/webhook/')).toBe(true);
  });

  it('does not exempt lookalikes or the rest of the telephony API', () => {
    expect(exempt('/api/telephony/telnyx/webhook-foo')).toBe(false);
    expect(exempt('/api/telephony/telnyx/webhooks')).toBe(false);
    expect(exempt('/api/telephony/telnyx/webhookx/y')).toBe(false);
    expect(exempt('/api/telephony/calls')).toBe(false);
    expect(exempt('/api/telephony/token')).toBe(false);
  });
});

describe('sipUserOf', () => {
  it('reads the user part of a SIP address and nothing else', () => {
    expect(sipUserOf('sip:GencredAb@sip.telnyx.com')).toBe('gencredab');
    expect(sipUserOf('"Rep" <sip:gencredab@sip.telnyx.com>;tag=1')).toBe('gencredab');
    expect(sipUserOf('gencredab@host')).toBe('gencredab');
    expect(sipUserOf('+84948200638')).toBeNull();
    expect(sipUserOf('')).toBeNull();
    expect(sipUserOf(null)).toBeNull();
    expect(sipUserOf(`sip:${'a'.repeat(300)}@host`)).toBeNull();
  });
});
