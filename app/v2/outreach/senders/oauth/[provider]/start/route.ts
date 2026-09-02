import { NextResponse, type NextRequest } from "next/server";

import { isOAuthProvider } from "@/lib/v2/outreach/oauth/providers";
import { startOAuthConnect } from "@/lib/v2/outreach/oauth/oauthConnect";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

// S6c-runtime: begin the OAuth Authorization Code + PKCE flow. Gated on
// outreach.admin. Persists a one-time tenant-bound state (encrypted PKCE
// verifier) then 302s to the provider's authorize endpoint.
export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const sendersUrl = new URL("/v2/outreach/senders", request.url);

  if (!isOAuthProvider(provider)) {
    sendersUrl.searchParams.set("notice", "oauth-unknown-provider");
    return NextResponse.redirect(sendersUrl);
  }

  let ctx;
  try {
    ctx = await requirePermission("outreach.admin");
  } catch (error) {
    if (error instanceof V2TenantError) {
      sendersUrl.searchParams.set("notice", "oauth-forbidden");
      return NextResponse.redirect(sendersUrl);
    }
    throw error;
  }

  // Build redirect_uri from a TRUSTED base URL (env), not the request Host, so a
  // spoofed Host header cannot steer the OAuth redirect. Falls back to the request
  // origin only when the env is unset (dev). Must match the provider's registered
  // redirect URI exactly.
  const envBase = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const base = envBase || new URL(request.url).origin;
  const redirectUri = `${base}/v2/outreach/senders/oauth/${provider}/callback`;

  const result = await startOAuthConnect({
    organizationId: ctx.organizationId,
    provider,
    createdByUserId: ctx.userId,
    redirectUri,
  });

  if (!result.ok) {
    sendersUrl.searchParams.set("notice", `oauth-${result.reason.toLowerCase()}`);
    return NextResponse.redirect(sendersUrl);
  }

  return NextResponse.redirect(result.url);
}
