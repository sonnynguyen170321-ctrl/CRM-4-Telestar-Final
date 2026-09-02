import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

import { AppShell } from "@/components/shared/AppShell";
import { ThemeProvider } from "@/components/shared/ThemeProvider";

import "./globals.css";

// Use the locally-vendored `geist` package (Vercel) instead of next/font/google
// so the production build never fetches fonts from fonts.googleapis.com at build
// time. This keeps the build deterministic / offline-safe (P0.1). The package
// exposes the same CSS variables: --font-geist-sans and --font-geist-mono.
const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  title: "TeleStar Company Filter",
  description: "Company-first lead filtering and scoring foundation for TeleStar.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning on <html>: next-themes stamps the theme class + a color-scheme style
    // onto <html> before React hydrates, so the server HTML and the client markup legitimately differ
    // on this one element. This is the theme provider's documented requirement — it only silences the
    // <html>/<body> attribute diff, not real app-level hydration bugs in children.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* Browser extensions (Bitdefender, Grammarly, ...) also inject attributes onto <body> before
          React hydrates — suppress that benign diff too. */}
      <body className="min-h-full" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          themes={['light', 'dark', 'midnight', 'dim']}
        >
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
