import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireAuth } from '@/lib/auth';
import { settingsRedirect } from '@/lib/email/oauthRedirect';
import { getMicrosoftAuthUrl } from '@/lib/email/adapters/OutlookAdapter';

export async function GET(_req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;

  if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET || !process.env.MICROSOFT_REDIRECT_URI) {
    return settingsRedirect(_req.url, { error: 'microsoft_not_configured' });
  }

  try {
    const nonce = randomBytes(32).toString('hex');
    const authUrl = getMicrosoftAuthUrl(nonce);

    const res = NextResponse.redirect(authUrl);
    res.cookies.set('oauth_nonce_microsoft', nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });
    return res;
  } catch (err) {
    console.error('[oauth/microsoft] Failed to generate auth URL:', err);
    return settingsRedirect(_req.url, { error: 'microsoft_auth_failed' });
  }
}
