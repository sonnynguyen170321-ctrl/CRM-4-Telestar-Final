import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed, IBM_Plex_Mono } from 'next/font/google';

/**
 * The three IBM Plex cuts, self-hosted.
 *
 * `app/globals.css` used to open with
 * `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans…')`, which is the worst
 * available way to load a font and the reason the E2E suites carry a `fonts.gstatic.com`
 * allowlist:
 *
 *   - a CSS `@import` is render-blocking and cannot be preloaded, so it delays first paint by a
 *     full extra round trip to a third-party origin;
 *   - it makes every page load depend on a host we do not control, on a CDN slice that returned
 *     404 in CI — which is why a console-error assertion had to be widened to stay green;
 *   - the CSP in the web security rules would have to allow both `fonts.googleapis.com` and
 *     `fonts.gstatic.com` purely for decoration;
 *   - and it discloses every visitor's IP to a third party, which is a real question for a BPO
 *     handling EU prospect data rather than a theoretical one.
 *
 * `next/font/google` downloads these families at **build** time and serves them from our own
 * origin. No runtime request to Google is made at all, so the allowlist entries that hid the
 * 404 are removed rather than kept: an unexpected external font request is now a genuine
 * failure again, which is what the assertion was for.
 *
 * Weights match what the CSS actually uses — see the type scale in `globals.css`. `display:
 * 'swap'` keeps text visible during load; `preload` is left on for the two families that render
 * above the fold and off for mono, which only appears in data cells.
 */

export const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
});

export const plexSansCondensed = IBM_Plex_Sans_Condensed({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-plex-condensed',
  display: 'swap',
});

export const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
  preload: false,
});

/** Applied to <html> so the variables are in scope for every token in `globals.css`. */
export const fontVariables = [
  plexSans.variable,
  plexSansCondensed.variable,
  plexMono.variable,
].join(' ');
