import Link from 'next/link';
import type { ReactNode } from 'react';

export const LEGAL_ENTITY = 'Telestar LLC';
export const LEGAL_CONTACT_EMAIL = 'ac@telestar.vn';
export const LEGAL_EFFECTIVE_DATE = 'October 14, 2026';

/**
 * The frame for the public legal pages (/privacy, /terms).
 *
 * They are read by people with no account — Google's OAuth reviewers, prospects, a client's
 * security team — so they render outside the staff shell (components/DashboardShell.tsx) and
 * the desktop gate, and link only to each other and to sign-in.
 */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-main text-text-primary">
      <header className="border-b border-card-border">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <Link href="/login" className="font-semibold text-brand-red">
            Telestar
          </Link>
          <nav className="flex gap-4 type-meta text-text-secondary">
            <Link href="/privacy" className="hover:text-text-primary">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-text-primary">Terms of Service</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1>{title}</h1>
        <p className="mt-2 type-meta text-text-muted">Effective {LEGAL_EFFECTIVE_DATE}</p>
        <div className="prose-measure mt-8 space-y-8 type-body text-text-secondary">{children}</div>
      </main>

      <footer className="border-t border-card-border">
        <div className="mx-auto max-w-3xl px-6 py-6 type-meta text-text-muted">
          {LEGAL_ENTITY} · <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="underline">{LEGAL_CONTACT_EMAIL}</a>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2>{heading}</h2>
      {children}
    </section>
  );
}
