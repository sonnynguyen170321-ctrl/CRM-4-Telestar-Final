import { NextResponse, type NextRequest } from "next/server";

import { isOAuthProvider } from "@/lib/v2/outreach/oauth/providers";
import { completeOAuthConnect } from "@/lib/v2/outreach/oauth/oauthConnect";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

// S6c-runtime: OAuth callback. Gated on outreach.admin. Atomically consumes the
// one-time state, exchanges the code (with the PKCE verifier + client secret,
// server-side only) for tokens, encrypts the refresh token, and creates/updates
// the OAuth sender (liveSendEnabled=false). Secrets never touch the response.
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

  const params = request.nextUrl.searchParams;
  const oauthError = params.get("error");
  if (oauthError) {
    // Provider-side denial/error — surface the code only, never anything else.
    sendersUrl.searchParams.set("notice", "oauth-denied");
    return NextResponse.redirect(sendersUrl);
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    sendersUrl.searchParams.set("notice", "oauth-missing-params");
    return NextResponse.redirect(sendersUrl);
  }

  const result = await completeOAuthConnect({
    organizationId: ctx.organizationId,
    provider,
    code,
    state,
  });

  if (!result.ok) {
    sendersUrl.searchParams.set("notice", `oauth-${result.reason.toLowerCase()}`);
    return NextResponse.redirect(sendersUrl);
  }

  sendersUrl.searchParams.set("notice", "oauth-connected");
  return NextResponse.redirect(sendersUrl);
}
