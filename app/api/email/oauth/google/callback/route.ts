import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { describeOAuthFailure, settingsRedirect } from '@/lib/email/oauthRedirect';
import type { SessionUser } from '@/lib/auth';
import { exchangeGoogleCode } from '@/lib/email/adapters/GmailAdapter';
import { upsertOAuthEmailAccount } from '@/lib/email/oauthAccounts';

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code) {
    const res = settingsRedirect(req.url, { error: 'google_auth_failed' });
    res.cookies.delete('oauth_nonce_google');
    return res;
  }

  // CSRF validation: compare state against the nonce stored in the HttpOnly cookie
  const nonce = req.cookies.get('oauth_nonce_google')?.value;
  if (!nonce || state !== nonce) {
    const res = settingsRedirect(req.url, { error: 'google_invalid_state' });
    res.cookies.delete('oauth_nonce_google');
    return res;
  }

  try {
    const { email, accessToken, refreshToken, tokenExpiry } = await exchangeGoogleCode(code);

    const result = await upsertOAuthEmailAccount({
      user,
      provider: 'gmail',
      email,
      accessToken,
      refreshToken,
      tokenExpiry,
    });

    if (!result.ok) {
      const res = settingsRedirect(req.url, { error: 'google_missing_refresh_token' });
      res.cookies.delete('oauth_nonce_google');
      return res;
    }

    const res = settingsRedirect(req.url, { success: 'gmail_connected' });
    res.cookies.delete('oauth_nonce_google');
    return res;
  } catch (error) {
    // Fields only: the error object carries the token request, client secret included.
    const failure = describeOAuthFailure(error);
    console.error('Error exchanging Google OAuth code:', failure);
    const res = settingsRedirect(req.url, { error: 'google_token_exchange_failed', reason: failure.reason });
    res.cookies.delete('oauth_nonce_google');
    return res;
  }
}
