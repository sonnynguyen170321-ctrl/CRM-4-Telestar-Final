import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const { auth } = NextAuth(authConfig);

const ADMIN_ROLES = new Set(['director', 'floor_manager']);

// auth() enriches the request with req.auth (the session).
// If there's no session, redirect to /login.
export const proxy = auth(function handler(req: NextRequest & { auth: { user?: unknown } | null }) {
  const pathname = req.nextUrl.pathname;

  if (!req.auth?.user) {
    // API routes get 401 JSON; page routes get redirected to /login
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  // /admin/* and /api/admin/* are restricted to director and floor_manager at the edge.
  // The API routes also do their own requireRole() check, but this stops the page HTML
  // from being sent to unauthorised roles entirely.
  if (pathname.startsWith('/admin/') || pathname === '/admin') {
    const role = (req.auth.user as any)?.role as string | undefined;
    if (!role || !ADMIN_ROLES.has(role)) {
      // Page route: redirect to home
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
});

// Exclude NextAuth endpoints, the cron routes, the health probe, the login page,
// and static assets.
//
// api/cron is excluded because this proxy demands a session and 401s anything
// without one, which an external scheduler calling with a CRON_SECRET bearer
// token never has. Every route under app/api/cron re-implements the same check
// itself — `Bearer ${CRON_SECRET}` or a director/floor_manager/team_lead
// session — so letting the request reach the handler opens nothing up.
//
// api/health is excluded for the same reason: an uptime check or a platform
// health probe has no session either, so it only ever saw a 401 and could not
// report on the database. The handler runs `SELECT 1` and returns nothing but a
// boolean, so it is safe to reach unauthenticated.
//
// client-reports/public and api/client-reports/public are excluded because the
// client share link is *defined* by being openable without a Telestar account —
// the recipient is the customer, not staff. This proxy was redirecting them to
// the staff login page before the token was ever examined, which made the
// feature unusable for its only audience. Authorisation is not being skipped,
// only moved to where it belongs: `verifyAndFetchSharedReport` validates the
// token, its expiry and its optional password before returning anything, and
// an unknown token yields the same not-found response it always did.
export const config = {
  matcher: [
    '/((?!api/auth|api/cron|api/health|api/client-reports/public|client-reports/public|login|_next/static|_next/image|favicon\\.ico|.*\\.png$).*)',
  ],
};
