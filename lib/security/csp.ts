/**
 * Content Security Policy.
 *
 * Ships in **report-only** mode. Nothing is blocked; violations are posted to
 * `/api/csp-report` so the real origin inventory can be observed before enforcement is
 * switched on with the domain deploy. Turning a guessed CSP straight to enforcing is how
 * you take down your own login page on a Friday.
 *
 * ---------------------------------------------------------------------------
 * THE ORIGIN INVENTORY (2026-08-08)
 * ---------------------------------------------------------------------------
 * Browser-facing, so they belong in the policy:
 *
 *   images.unsplash.com    demo imagery
 *   login.microsoftonline.com   the Entra ID sign-in redirect
 *
 * Fonts are **not** listed and must not be re-added. `app/globals.css` used to open with an
 * `@import` from fonts.googleapis.com, which then pulled files from fonts.gstatic.com, and both
 * origins were allowed here purely to serve that. `app/fonts.ts` replaced it with
 * `next/font/google`, which downloads the three IBM Plex cuts at **build** time and serves them
 * from our own origin — so 'self' already covers them and the browser never contacts Google.
 * Leaving the entries in would keep the policy wider than the app, and would silently permit a
 * regression that reintroduces the render-blocking third-party @import.
 *
 * Server-side only, so they must NOT appear here — the browser never contacts them, and
 * listing them would widen the policy for no reason:
 *
 *   graph.microsoft.com · www.googleapis.com · api.tavily.com · r.jina.ai
 *
 * Navigation targets (`<a href>`), which CSP does not govern and which need no entry:
 *
 *   linkedin.com · wa.me · meet.google.com · calendly.com
 */

/** Where violation reports are posted. Must stay unauthenticated — see the route. */
export const CSP_REPORT_PATH = '/api/csp-report';

const DEMO_IMAGES = 'https://images.unsplash.com';
const ENTRA_ID = 'https://login.microsoftonline.com';

/**
 * Build the policy.
 *
 * `nonce` is accepted but currently unused — see `script-src` below. It is threaded
 * through now so switching to nonces later is a change to this function, not to every
 * caller.
 */
export function buildCsp({ nonce }: { nonce?: string } = {}): string {
  const directives: Record<string, string[]> = {
    // Everything not named explicitly falls back to same-origin only.
    'default-src': ["'self'"],

    // ── The one loose directive, and the one thing to fix before enforcing ──
    // Next.js inlines its bootstrap and hydration scripts. Blocking them breaks every
    // page, so 'unsafe-inline' stays until nonces are wired.
    //
    // Nonces need the middleware to mint one per request and set it on both the request
    // header and this policy — but `proxy.ts` deliberately does not run on /login,
    // _next/static, the health probe or the public client-report routes, so a
    // middleware-only nonce would leave exactly those pages with a policy their scripts
    // violate. Doing it properly means either moving CSP generation into the middleware
    // AND widening its matcher (which risks a redirect loop on /login, the one route that
    // must stay reachable), or adopting Next's built-in nonce support once this app is on
    // a version that applies it to framework scripts automatically.
    //
    // Deliberately NOT including 'unsafe-eval': nothing here needs it, and report-only
    // mode will say so if that is wrong.
    'script-src': ["'self'", "'unsafe-inline'", ...(nonce ? [`'nonce-${nonce}'`] : [])],

    // Tailwind and Next both emit inline <style>. Hashing them is impractical while the
    // class set changes per build.
    'style-src': ["'self'", "'unsafe-inline'"],
    // Self-hosted by next/font (see the header note). `data:` stays for inline icon fonts.
    'font-src': ["'self'", 'data:'],

    // data: for inline SVG and generated avatars; blob: for client-side file previews on
    // the import screens.
    'img-src': ["'self'", 'data:', 'blob:', DEMO_IMAGES],

    // The API is same-origin. If this ever needs widening, that is a signal a browser is
    // talking to a third party directly and it deserves scrutiny rather than an entry.
    'connect-src': ["'self'"],

    // Sign-in posts to Entra ID; everything else stays home.
    'form-action': ["'self'", ENTRA_ID],

    // Nothing embeds this app, and it embeds nothing.
    'frame-ancestors': ["'none'"],
    'frame-src': ["'none'"],

    // No plugins, and <base> cannot be repointed to hijack relative URLs.
    'object-src': ["'none'"],
    'base-uri': ["'self'"],

    // Same-origin workers only.
    'worker-src': ["'self'", 'blob:'],

    'report-uri': [CSP_REPORT_PATH],
  };

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/**
 * The header name.
 *
 * Report-only until the domain deploy. Enforcement is a one-word change here, and must
 * not happen until the reports are quiet — see `docs/pre-domain-hardening/STATUS.md`.
 */
export const CSP_HEADER_NAME = 'Content-Security-Policy-Report-Only';
