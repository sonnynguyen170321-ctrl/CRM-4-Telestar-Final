import { Montserrat, JetBrains_Mono } from 'next/font/google';

/**
 * Telestar Typography Architecture.
 *
 * • Montserrat (--font-sans / --font-montserrat): Primary operational voice.
 *   Used for all UI chrome, body text, data cells, forms, navigation, and AI text.
 *   Loaded at build-time via next/font/google with full Latin + Vietnamese glyph coverage.
 *
 * • Futura (--font-brand / --font-futura): Brand identity voice.
 *   Used for wordmarks, top-level brand titles, major section accents, and high-impact cards.
 *   Configured in CSS with local font-face support and robust fallback stack:
 *   'Futura', 'Futura PT', 'Futura-Medium', 'Trebuchet MS', -apple-system, BlinkMacSystemFont, sans-serif.
 *
 * • JetBrains Mono (--font-mono): Technical monospace voice.
 *   Used for technical IDs, tokens, JSON, and code blocks.
 */

export const montserrat = Montserrat({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-montserrat',
  display: 'swap',
  preload: true,
});

export const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
});

/** Applied to <html> so CSS variables are in scope everywhere. */
export const fontVariables = [
  montserrat.variable,
  mono.variable,
].join(' ');
