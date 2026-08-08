import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { buildCsp, CSP_HEADER_NAME, CSP_REPORT_PATH } from '@/lib/security/csp';

const policy = buildCsp();
const directive = (name: string): string[] => {
  const found = policy.split('; ').find((d) => d.startsWith(`${name} `));
  return found ? found.split(' ').slice(1) : [];
};

describe('CSP — rollout safety', () => {
  it('ships report-only, so a wrong guess cannot take the app down', () => {
    // Enforcement is a deliberate later step, tied to the domain deploy.
    expect(CSP_HEADER_NAME).toBe('Content-Security-Policy-Report-Only');
  });

  it('points violations at a route that exists and is unauthenticated', () => {
    expect(directive('report-uri')).toContain(CSP_REPORT_PATH);
    // The middleware must skip it, or browsers post reports into a 401.
    const proxy = readFileSync('proxy.ts', 'utf8');
    expect(proxy).toMatch(/api\/csp-report/);
  });
});

describe('CSP — the directives that should be closed', () => {
  it.each([
    ['object-src', "'none'"],
    ['frame-ancestors', "'none'"],
    ['frame-src', "'none'"],
    ['base-uri', "'self'"],
    ['default-src', "'self'"],
  ])('%s is %s', (name, expected) => {
    expect(directive(name)).toEqual([expected]);
  });

  it('never allows unsafe-eval anywhere', () => {
    // Nothing in this app needs it. Report-only mode will say so if that is wrong.
    expect(policy).not.toContain("'unsafe-eval'");
  });
});

describe('CSP — the origin inventory', () => {
  it('allows the font stylesheet and the font files it references', () => {
    // app/globals.css @imports from googleapis, which then loads from gstatic. Allowing
    // one without the other yields a page with no fonts and a confusing report.
    expect(directive('style-src')).toContain('https://fonts.googleapis.com');
    expect(directive('font-src')).toContain('https://fonts.gstatic.com');
  });

  it('allows the Entra ID sign-in target as a form action', () => {
    expect(directive('form-action')).toContain('https://login.microsoftonline.com');
  });

  it('keeps connect-src same-origin', () => {
    // The API is same-origin. Widening this would mean a browser talks to a third party
    // directly, which deserves scrutiny rather than a quiet entry.
    expect(directive('connect-src')).toEqual(["'self'"]);
  });

  it('does not list server-side-only origins', () => {
    // Graph, Tavily, jina and googleapis are fetched by the server. The browser never
    // contacts them, so listing them would widen the policy for nothing.
    for (const origin of ['graph.microsoft.com', 'api.tavily.com', 'r.jina.ai', 'www.googleapis.com']) {
      expect(policy).not.toContain(origin);
    }
  });

  it('does not list navigation targets, which CSP does not govern', () => {
    for (const origin of ['linkedin.com', 'wa.me', 'meet.google.com', 'calendly.com']) {
      expect(policy).not.toContain(origin);
    }
  });
});

describe('CSP — known gap before enforcement', () => {
  it('still allows inline script, and says so', () => {
    // Next.js inlines its bootstrap and hydration scripts; blocking them breaks every
    // page. This is the one directive that must tighten before enforcing, and the
    // reasoning — plus why a middleware-only nonce is not sufficient here — is documented
    // in lib/security/csp.ts.
    expect(directive('script-src')).toContain("'unsafe-inline'");
    expect(readFileSync('lib/security/csp.ts', 'utf8')).toMatch(/nonce/i);
  });

  it('accepts a nonce so the switch is a change here, not at every caller', () => {
    expect(buildCsp({ nonce: 'abc123' })).toContain("'nonce-abc123'");
  });
});
