import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeHeaders,
} from '@/lib/email/unsubscribe';
import { GET, POST } from '@/app/api/unsubscribe/route';
import { NextRequest } from 'next/server';

const mockFindFirst = vi.fn();
const mockCreate = vi.fn();
const mockUpdateMany = vi.fn();
const mockActivityCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    suppressionEntry: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
    sequenceEnrollment: {
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
    activity: {
      create: (...args: unknown[]) => mockActivityCreate(...args),
    },
  },
}));

vi.mock('@/lib/contact-intelligence/events', () => ({
  onSuppressionOrArchive: vi.fn().mockResolvedValue(undefined),
}));

describe('Unsubscribe HMAC token and RFC 8058 handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = 'test-auth-secret-for-hmac-32-chars-long';
  });

  it('generates a valid token and successfully decodes payload', () => {
    const payload = {
      tenantId: 'tenant-123',
      email: 'lead@example.com',
      leadId: 'lead-456',
      campaignId: 'camp-789',
    };

    const token = generateUnsubscribeToken(payload);
    expect(typeof token).toBe('string');
    expect(token).toContain('.');

    const decoded = verifyUnsubscribeToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.tenantId).toBe('tenant-123');
    expect(decoded?.email).toBe('lead@example.com');
    expect(decoded?.leadId).toBe('lead-456');
    expect(decoded?.campaignId).toBe('camp-789');
  });

  it('rejects tampered tokens', () => {
    const payload = { tenantId: 'tenant-1', email: 'user@example.com' };
    const token = generateUnsubscribeToken(payload);
    const tampered = token.slice(0, -4) + 'abcd';

    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it('rejects completely malformed tokens', () => {
    expect(verifyUnsubscribeToken('')).toBeNull();
    expect(verifyUnsubscribeToken('not-a-token')).toBeNull();
    expect(verifyUnsubscribeToken('a.b.c')).toBeNull();
  });

  it('fails safely when signing secrets are absent in production mode', () => {
    delete process.env.AUTH_SECRET;
    delete process.env.ENCRYPTION_KEY;
    vi.stubEnv('NODE_ENV', 'production');

    try {
      expect(() =>
        generateUnsubscribeToken({ tenantId: 't1', email: 'test@example.com' })
      ).toThrow('AUTH_SECRET or ENCRYPTION_KEY is required');
      expect(verifyUnsubscribeToken('invalid.token')).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('builds valid RFC 8058 compliant headers', () => {
    const headers = buildUnsubscribeHeaders('https://crm.telestar.cloud', 'sample-token-xyz');
    expect(headers['List-Unsubscribe']).toBe('<https://crm.telestar.cloud/api/unsubscribe?token=sample-token-xyz>');
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  describe('API Route /api/unsubscribe', () => {
    it('POST (RFC 8058 one-click) creates suppression entry idempotently and returns 200 JSON', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockCreate.mockResolvedValueOnce({ id: 'supp-1' });

      const token = generateUnsubscribeToken({
        tenantId: 't-1',
        email: 'prospect@acme.corp',
        leadId: 'l-1',
      });

      const req = new NextRequest(`https://crm.telestar.cloud/api/unsubscribe?token=${token}`, {
        method: 'POST',
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 't-1',
            email: 'prospect@acme.corp',
            campaignId: null,
          }),
        })
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't-1',
            email: 'prospect@acme.corp',
            campaignId: null,
            reason: 'unsubscribed',
          }),
        })
      );
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't-1', leadId: 'l-1', status: 'active' },
          data: expect.objectContaining({ status: 'unenrolled' }),
        })
      );
    });

    it('repeated unsubscribe is completely idempotent (skips create when already exists)', async () => {
      mockFindFirst.mockResolvedValueOnce({ id: 'supp-existing', email: 'prospect@acme.corp' });

      const token = generateUnsubscribeToken({
        tenantId: 't-1',
        email: 'prospect@acme.corp',
        leadId: 'l-1',
      });

      const req = new NextRequest(`https://crm.telestar.cloud/api/unsubscribe?token=${token}`, {
        method: 'POST',
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('handles concurrent race condition safely if create throws unique constraint P2002', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      const p2002Error = new Error('Unique constraint failed');
      (p2002Error as any).code = 'P2002';
      mockCreate.mockRejectedValueOnce(p2002Error);

      const token = generateUnsubscribeToken({
        tenantId: 't-1',
        email: 'prospect@acme.corp',
      });

      const req = new NextRequest(`https://crm.telestar.cloud/api/unsubscribe?token=${token}`, {
        method: 'POST',
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it('GET (Browser click) returns 200 HTML page', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockCreate.mockResolvedValueOnce({ id: 'supp-2' });

      const token = generateUnsubscribeToken({
        tenantId: 't-1',
        email: 'person@company.com',
      });

      const req = new NextRequest(`https://crm.telestar.cloud/api/unsubscribe?token=${token}`, {
        method: 'GET',
      });

      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('Unsubscribed Successfully');
      expect(html).toContain('person@company.com');
    });

    it('returns 400 when given an invalid token', async () => {
      const req = new NextRequest('https://crm.telestar.cloud/api/unsubscribe?token=invalid', {
        method: 'POST',
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });
});
