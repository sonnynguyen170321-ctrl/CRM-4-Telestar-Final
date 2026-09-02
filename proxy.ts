import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_V2_PATHS = new Set(["/v2/login", "/v2/logout"]);
const SESSION_COOKIE_NAME = process.env.V2_AUTH_COOKIE_NAME?.trim() || "v2_session";
const LEGACY_UI_REDIRECTS: Record<string, string> = {
  "/": "/v2/home",
  "/companies": "/v2/crm/companies",
  "/contacts": "/v2/crm/contacts",
  "/uploads": "/v2/ingestion/uploads",
  "/activity-recaps": "/v2/activity-recaps",
  "/manager-review": "/v2/reviews",
  "/feedback": "/v2/feedback",
  "/settings/ai": "/v2/ai",
  "/exports": "/v2/reports",
};

function safeDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function legacyUiRedirectUrl(request: NextRequest): URL | null {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/") || pathname.startsWith("/v2/")) {
    return null;
  }

  const normalizedPath = pathname !== "/" ? pathname.replace(/\/+$/, "") : pathname;
  const targetPath = LEGACY_UI_REDIRECTS[normalizedPath];
  if (targetPath) {
    const target = new URL(targetPath, request.url);
    target.search = request.nextUrl.search;
    return target;
  }

  const managerReviewMatch = normalizedPath.match(/^\/manager-review\/([^/]+)$/);
  if (managerReviewMatch) {
    const target = new URL("/v2/reviews", request.url);
    target.search = request.nextUrl.search;
    target.searchParams.set("reviewItemId", safeDecodePathSegment(managerReviewMatch[1]));
    return target;
  }

  return null;
}

// Machine-to-machine + public recipient routes under /v2 that must NOT go through
// the user-session gate: the worker daemons (their own V2_WORKER_SECRET) and the
// public tracking pixels/click/unsubscribe (recipients have no session).
function isPublicV2Path(pathname: string): boolean {
  return (
    PUBLIC_V2_PATHS.has(pathname) ||
    pathname === "/v2/outreach/drain" ||
    pathname === "/v2/outreach/imap-poll" ||
    pathname.startsWith("/v2/outreach/track/")
  );
}

// Cross-cutting defenses layered on the session gate. NOT a replacement for
// per-route requirePermission / V2_WORKER_SECRET gates (those are the real
// authorization boundary). Adds security headers to every response + a coarse
// per-IP rate limit on sensitive endpoints (login, worker) to blunt brute-force / DoS.
// The limiter is in-memory (per-instance); a shared store is the multi-instance upgrade.

type RateRule = { test: (path: string) => boolean; max: number; windowMs: number };

const RATE_RULES: RateRule[] = [
  { test: (p) => p === "/v2/outreach/drain" || p === "/v2/outreach/imap-poll", max: 60, windowMs: 60_000 },
  { test: (p) => p.startsWith("/v2/login"), max: 60, windowMs: 60_000 },
];

const HITS = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function isRateLimited(request: NextRequest): boolean {
  const path = request.nextUrl.pathname;
  const rule = RATE_RULES.find((r) => r.test(path));
  if (!rule) return false;

  const now = Date.now();
  if (HITS.size > 10_000) {
    for (const [key, entry] of HITS) {
      if (entry.resetAt <= now) HITS.delete(key);
    }
  }

  const key = `${clientIp(request)}:${path}`;
  const entry = HITS.get(key);
  if (!entry || entry.resetAt <= now) {
    HITS.set(key, { count: 1, resetAt: now + rule.windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > rule.max;
}

function withSecurityHeaders<T extends NextResponse>(response: T): T {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  return response;
}

export async function proxy(request: NextRequest) {
  const legacyRedirectUrl = legacyUiRedirectUrl(request);
  if (legacyRedirectUrl) {
    return withSecurityHeaders(NextResponse.redirect(legacyRedirectUrl, 307));
  }

  if (isRateLimited(request)) {
    return withSecurityHeaders(
      NextResponse.json(
        { error: "Too many requests." },
        { status: 429, headers: { "Retry-After": "60" } }
      )
    );
  }

  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith("/v2/") || isPublicV2Path(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!hasSessionCookie) {
    const loginUrl = new URL("/v2/login", request.url);
    loginUrl.searchParams.set("returnTo", `${pathname}${request.nextUrl.search}`);
    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};