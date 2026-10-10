import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { canOpenAdminPath } from './lib/admin/teamLeadAdminPaths';

const { auth } = NextAuth(authConfig);

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

  // /admin/* is restricted to director and floor_manager at the edge, except the campaign pages a
  // team lead may open (lib/admin/teamLeadAdminPaths.ts). The API routes also do their own
  // requireRole() check, but this stops the page HTML from being sent to unauthorised roles.
  if (pathname.startsWith('/admin/') || pathname === '/admin') {
    const role = (req.auth.user as any)?.role as string | undefined;
    if (!canOpenAdminPath(role, pathname)) {
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
// api/csp-report is excluded because the browser posts violation reports with no
// cookies and no session. A report that 401s teaches nobody anything, and the handler
// persists nothing and returns 204 to everyone.
//
// api/health is excluded for the same reason: an uptime check or a platform
// health probe has no session either, so it only ever saw a 401 and could not
// report on the database. The handler runs `SELECT 1` and returns nothing but a
// boolean, so it is safe to reach unauthenticated.
//
// api/t/ (open pixel and click redirect) is excluded for the same reason: the person opening or
// clicking an email has no staff session. Its tokens are HMAC-signed — see lib/email/tracking.ts.
// api/unsubscribe is excluded because recipients clicking one-click or web
// unsubscribe headers do not have a staff session — the route authenticates via
// cryptographic HMAC token in the query params.
//
// api/telephony/telnyx/webhook is excluded because Telnyx posts call events with no cookies. The handler
// accepts nothing without a valid Ed25519 signature over the raw body (lib/telephony/telnyx/verify.ts)
// and a timestamp within five minutes, and acts on a call only through its stored Call row and HMAC call
// token — never on the payload alone. Only this one path is open, not api/telephony.
//
// api/email/oauth is excluded because external OAuth providers redirect back with
// authorization codes without an active session cookie.
export const config = {
  matcher: [
    '/((?!api/auth|api/cron|api/health|api/csp-report|api/unsubscribe|api/t/|api/email/oauth|api/telephony/telnyx/webhook$|api/telephony/telnyx/webhook/|api/client-reports/public|client-reports/public|login|_next/static|_next/image|favicon\\.ico|.*\\.png$).*)',
  ],
};
