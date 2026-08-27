import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';

/**
 * Telestar Typography Architecture — Impeccable Non-AI Brand Stack.
 *
 * • IBM Plex Sans (--font-sans / --font-plex-sans): Primary operational voice.
 *   Loaded at build-time via next/font/google with full Latin + Vietnamese glyph coverage.
 *
 * • IBM Plex Mono (--font-mono): Technical monospace voice.
 *   Used for technical IDs, tokens, metrics, tabular numbers, and timestamps.
 */

export const plexSans = IBM_Plex_Sans({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
  preload: true,
});

export const mono = IBM_Plex_Mono({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
});

/** Applied to <html> so CSS variables are in scope everywhere. */
export const fontVariables = [
  plexSans.variable,
  mono.variable,
].join(' ');
