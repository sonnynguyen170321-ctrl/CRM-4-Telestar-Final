import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { describeOAuthFailure, settingsRedirect } from '@/lib/email/oauthRedirect';
import type { SessionUser } from '@/lib/auth';
import { exchangeMicrosoftCode } from '@/lib/email/adapters/OutlookAdapter';
import { upsertOAuthEmailAccount } from '@/lib/email/oauthAccounts';

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code) {
    const res = settingsRedirect(req.url, { error: 'microsoft_auth_failed' });
    res.cookies.delete('oauth_nonce_microsoft');
    return res;
  }

  // CSRF validation: compare state against the nonce stored in the HttpOnly cookie
  const nonce = req.cookies.get('oauth_nonce_microsoft')?.value;
  if (!nonce || state !== nonce) {
    const res = settingsRedirect(req.url, { error: 'microsoft_invalid_state' });
    res.cookies.delete('oauth_nonce_microsoft');
    return res;
  }

  try {
    const { email, accessToken, refreshToken, tokenExpiry } = await exchangeMicrosoftCode(code);

    if (!email) {
      const res = settingsRedirect(req.url, { error: 'microsoft_no_email' });
      res.cookies.delete('oauth_nonce_microsoft');
      return res;
    }

    const result = await upsertOAuthEmailAccount({
      user,
      provider: 'outlook',
      email,
      accessToken,
      refreshToken,
      tokenExpiry,
    });

    if (!result.ok) {
      const res = settingsRedirect(req.url, { error: 'microsoft_missing_refresh_token' });
      res.cookies.delete('oauth_nonce_microsoft');
      return res;
    }

    const res = settingsRedirect(req.url, { success: 'outlook_connected' });
    res.cookies.delete('oauth_nonce_microsoft');
    return res;
  } catch (error) {
    const failure = describeOAuthFailure(error);
    console.error('Error exchanging Microsoft OAuth code:', failure);
    const res = settingsRedirect(req.url, { error: 'microsoft_token_exchange_failed', reason: failure.reason });
    res.cookies.delete('oauth_nonce_microsoft');
    return res;
  }
}
