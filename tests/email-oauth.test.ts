import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/auth';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getGoogleAuthUrl: vi.fn((state?: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`),
  exchangeGoogleCode: vi.fn(),
  getMicrosoftAuthUrl: vi.fn((state?: string) => `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=${state}`),
  exchangeMicrosoftCode: vi.fn(),
  encrypt: vi.fn(async (value: string) => `enc:${value}`),
  emailAccountFindFirst: vi.fn(),
  emailAccountCreate: vi.fn(),
  emailAccountUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: (...args: any[]) => mocks.requireAuth(...args),
}));

vi.mock('@/lib/email/adapters/GmailAdapter', () => ({
  getGoogleAuthUrl: (...args: any[]) => mocks.getGoogleAuthUrl(...args),
  exchangeGoogleCode: (...args: any[]) => mocks.exchangeGoogleCode(...args),
}));

vi.mock('@/lib/email/adapters/OutlookAdapter', () => ({
  getMicrosoftAuthUrl: (...args: any[]) => mocks.getMicrosoftAuthUrl(...args),
  exchangeMicrosoftCode: (...args: any[]) => mocks.exchangeMicrosoftCode(...args),
}));

vi.mock('@/lib/crypto', () => ({
  encrypt: (...args: [string]) => mocks.encrypt(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailAccount: {
      findFirst: (...args: any[]) => mocks.emailAccountFindFirst(...args),
      create: (...args: any[]) => mocks.emailAccountCreate(...args),
      update: (...args: any[]) => mocks.emailAccountUpdate(...args),
    },
    auditLog: {
      create: (...args: any[]) => mocks.auditLogCreate(...args),
    },
  },
}));

const { GET: getProviders } = await import('@/app/api/email/providers/route');
const { GET: startGoogleOAuth } = await import('@/app/api/email/oauth/google/route');
const { GET: googleCallback } = await import('@/app/api/email/oauth/google/callback/route');
const { GET: startMicrosoftOAuth } = await import('@/app/api/email/oauth/microsoft/route');
const { GET: microsoftCallback } = await import('@/app/api/email/oauth/microsoft/callback/route');

const user: SessionUser = {
  id: 'user-1',
  email: 'sdr@example.com',
  firstName: 'Sam',
  lastName: 'Sender',
  role: 'sdr',
  tenantId: 'tenant-1',
};

const savedEnv = { ...process.env };

const setOAuthEnv = () => {
  process.env.GOOGLE_CLIENT_ID = 'google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/email/oauth/google/callback';
  process.env.MICROSOFT_CLIENT_ID = 'microsoft-client';
  process.env.MICROSOFT_CLIENT_SECRET = 'microsoft-secret';
  process.env.MICROSOFT_REDIRECT_URI = 'http://localhost:3000/api/email/oauth/microsoft/callback';
};

describe('email OAuth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...savedEnv };
    mocks.requireAuth.mockResolvedValue(user);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('reports configured and missing provider env keys', async () => {
    setOAuthEnv();
    delete process.env.MICROSOFT_CLIENT_SECRET;

    const res = await getProviders();
    const body = await res.json();

    expect(body.gmail).toEqual({ configured: true, missing: [] });
    expect(body.outlook).toEqual({
      configured: false,
      missing: ['MICROSOFT_CLIENT_SECRET'],
    });
  });

  it('redirects to Google OAuth and sets the nonce cookie', async () => {
    setOAuthEnv();

    const res = await startGoogleOAuth(new NextRequest('http://localhost:3000/api/email/oauth/google'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(res.headers.get('set-cookie')).toContain('oauth_nonce_google=');
    expect(mocks.getGoogleAuthUrl).toHaveBeenCalledWith(expect.any(String));
  });

  it('redirects to Microsoft OAuth and sets the nonce cookie', async () => {
    setOAuthEnv();

    const res = await startMicrosoftOAuth(new NextRequest('http://localhost:3000/api/email/oauth/microsoft'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(res.headers.get('set-cookie')).toContain('oauth_nonce_microsoft=');
    expect(mocks.getMicrosoftAuthUrl).toHaveBeenCalledWith(expect.any(String));
  });

  it('rejects callback requests with an invalid state', async () => {
    setOAuthEnv();

    const req = new NextRequest('http://localhost:3000/api/email/oauth/google/callback?code=abc&state=wrong', {
      headers: { cookie: 'oauth_nonce_google=expected' },
    });
    const res = await googleCallback(req);

    expect(res.headers.get('location')).toContain('/settings?error=google_invalid_state');
    expect(mocks.exchangeGoogleCode).not.toHaveBeenCalled();
  });

  it('creates a Gmail account with encrypted OAuth tokens and audit log', async () => {
    setOAuthEnv();
    const tokenExpiry = new Date('2026-07-14T00:00:00.000Z');
    mocks.exchangeGoogleCode.mockResolvedValue({
      email: 'sender@gmail.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenExpiry,
    });
    mocks.emailAccountFindFirst.mockResolvedValue(null);
    mocks.emailAccountCreate.mockResolvedValue({ id: 'account-1' });

    const req = new NextRequest('http://localhost:3000/api/email/oauth/google/callback?code=abc&state=nonce', {
      headers: { cookie: 'oauth_nonce_google=nonce' },
    });
    const res = await googleCallback(req);

    expect(res.headers.get('location')).toContain('/settings?success=gmail_connected');
    expect(mocks.emailAccountCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        email: 'sender@gmail.com',
        provider: 'gmail',
        accessToken: null,
        refreshToken: null,
        encAccessToken: 'enc:access-token',
        encRefreshToken: 'enc:refresh-token',
        tokenExpiry,
        isActive: true,
      }),
    });
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'connect_email',
        tableName: 'EmailAccount',
        recordId: 'account-1',
        tenantId: 'tenant-1',
      }),
    });
  });

  it('reactivates an existing Outlook account without requiring a new refresh token', async () => {
    setOAuthEnv();
    const tokenExpiry = new Date('2026-07-14T01:00:00.000Z');
    mocks.exchangeMicrosoftCode.mockResolvedValue({
      email: 'sender@outlook.com',
      accessToken: 'new-access-token',
      refreshToken: null,
      tokenExpiry,
    });
    mocks.emailAccountFindFirst.mockResolvedValue({
      id: 'account-2',
      encRefreshToken: 'enc:old-refresh-token',
      refreshToken: null,
    });
    mocks.emailAccountUpdate.mockResolvedValue({ id: 'account-2' });

    const req = new NextRequest('http://localhost:3000/api/email/oauth/microsoft/callback?code=abc&state=nonce', {
      headers: { cookie: 'oauth_nonce_microsoft=nonce' },
    });
    const res = await microsoftCallback(req);

    expect(res.headers.get('location')).toContain('/settings?success=outlook_connected');
    expect(mocks.emailAccountUpdate).toHaveBeenCalledWith({
      where: { id: 'account-2' },
      data: expect.objectContaining({
        accessToken: null,
        encAccessToken: 'enc:new-access-token',
        tokenExpiry,
        isActive: true,
      }),
    });
    expect(mocks.emailAccountUpdate.mock.calls[0][0].data.refreshToken).toBeUndefined();
    expect(mocks.emailAccountUpdate.mock.calls[0][0].data.encRefreshToken).toBeUndefined();
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'reconnect_email',
        recordId: 'account-2',
      }),
    });
  });

  // 2026-10-05: behind the proxy the server sees its own bind address in `req.url`, so a failed
  // Gmail connect on crm.telestar.cloud sent the browser to http://localhost:3000/settings.
  describe('redirects back to the public origin, not the address the server is bound to', () => {
    const internalCallback = (provider: 'google' | 'microsoft', state = 'nonce') =>
      new NextRequest(`http://localhost:3000/api/email/oauth/${provider}/callback?code=abc&state=${state}`, {
        headers: { cookie: `oauth_nonce_${provider}=nonce` },
      });

    it('sends a Google failure to NEXTAUTH_URL', async () => {
      setOAuthEnv();
      process.env.NEXTAUTH_URL = 'https://crm.telestar.cloud';
      mocks.exchangeGoogleCode.mockRejectedValue(new Error('boom'));

      const res = await googleCallback(internalCallback('google'));

      expect(res.headers.get('location')).toMatch(
        /^https:\/\/crm\.telestar\.cloud\/settings\?error=google_token_exchange_failed/
      );
    });

    it('sends every callback outcome to NEXTAUTH_URL, including a bad state and a success', async () => {
      setOAuthEnv();
      process.env.NEXTAUTH_URL = 'https://crm.telestar.cloud/';
      mocks.exchangeMicrosoftCode.mockResolvedValue({
        email: 'sender@outlook.com', accessToken: 'a', refreshToken: 'r', tokenExpiry: null,
      });
      mocks.emailAccountFindFirst.mockResolvedValue(null);
      mocks.emailAccountCreate.mockResolvedValue({ id: 'account-3' });

      const badState = await googleCallback(internalCallback('google', 'wrong'));
      const success = await microsoftCallback(internalCallback('microsoft'));

      expect(badState.headers.get('location')).toBe('https://crm.telestar.cloud/settings?error=google_invalid_state');
      expect(success.headers.get('location')).toBe('https://crm.telestar.cloud/settings?success=outlook_connected');
    });

    it('sends a not-configured start to NEXTAUTH_URL', async () => {
      process.env.NEXTAUTH_URL = 'https://crm.telestar.cloud';
      delete process.env.GOOGLE_CLIENT_ID;

      const res = await startGoogleOAuth(new NextRequest('http://localhost:3000/api/email/oauth/google'));

      expect(res.headers.get('location')).toBe('https://crm.telestar.cloud/settings?error=google_not_configured');
    });

    it('falls back to the request origin when NEXTAUTH_URL is unset or malformed', async () => {
      setOAuthEnv();
      delete process.env.AUTH_URL;

      delete process.env.NEXTAUTH_URL;
      const unset = await googleCallback(internalCallback('google', 'wrong'));
      process.env.NEXTAUTH_URL = 'not a url';
      const malformed = await googleCallback(internalCallback('google', 'wrong'));

      expect(unset.headers.get('location')).toBe('http://localhost:3000/settings?error=google_invalid_state');
      expect(malformed.headers.get('location')).toBe('http://localhost:3000/settings?error=google_invalid_state');
    });
  });

  describe('a failed token exchange says why, without logging the request', () => {
    // The shape googleapis (gaxios) throws: `config` carries the token request, client secret included.
    const gaxiosError = (status: number, data: unknown) =>
      Object.assign(new Error('Request failed'), {
        response: { status, data },
        config: { data: 'code=abc&client_secret=google-secret&grant_type=authorization_code' },
      });

    const loggedText = (spy: ReturnType<typeof vi.spyOn>) =>
      JSON.stringify(spy.mock.calls, (_k, v) => (v instanceof Error ? { ...v, message: v.message } : v));

    it.each([
      ['redirect_uri_mismatch', gaxiosError(400, { error: 'redirect_uri_mismatch', error_description: 'Bad Request' })],
      ['invalid_grant', gaxiosError(400, { error: 'invalid_grant', error_description: 'Malformed auth code.' })],
      ['invalid_client', gaxiosError(401, { error: 'invalid_client', error_description: 'Unauthorized' })],
      [
        'api_not_enabled',
        gaxiosError(403, {
          error: {
            code: 403,
            status: 'PERMISSION_DENIED',
            message: 'Gmail API has not been used in project 123 before or it is disabled.',
            errors: [{ reason: 'accessNotConfigured' }],
          },
        }),
      ],
      ['unknown', new Error('something nobody anticipated')],
    ])('reports %s', async (reason, error) => {
      setOAuthEnv();
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.exchangeGoogleCode.mockRejectedValue(error);

      const res = await googleCallback(
        new NextRequest('http://localhost:3000/api/email/oauth/google/callback?code=abc&state=nonce', {
          headers: { cookie: 'oauth_nonce_google=nonce' },
        })
      );

      const location = new URL(res.headers.get('location')!);
      expect(location.searchParams.get('error')).toBe('google_token_exchange_failed');
      expect(location.searchParams.get('reason')).toBe(reason);
      expect(spy).toHaveBeenCalled();
      expect(loggedText(spy)).toContain(reason === 'unknown' ? 'something nobody anticipated' : reason);
      expect(loggedText(spy)).not.toContain('google-secret');
      spy.mockRestore();
    });

    it('never forwards a provider-supplied code it does not recognise', async () => {
      setOAuthEnv();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.exchangeGoogleCode.mockRejectedValue(gaxiosError(400, { error: '<script>alert(1)</script>' }));

      const res = await googleCallback(
        new NextRequest('http://localhost:3000/api/email/oauth/google/callback?code=abc&state=nonce', {
          headers: { cookie: 'oauth_nonce_google=nonce' },
        })
      );

      expect(new URL(res.headers.get('location')!).searchParams.get('reason')).toBe('unknown');
    });
  });
});
