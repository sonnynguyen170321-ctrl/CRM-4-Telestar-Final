import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireManager, type SessionUser } from '@/lib/auth';
import { deliverWebhook } from '@/lib/webhooks/dispatcher';
import { checkDestinationShape } from '@/lib/webhooks/ssrfGuard';
import { listWebhooks } from '@/lib/webhooks/store';

/**
 * Sending a test ping is webhook administration, so it needs the same management capability as
 * creating one — it was gated on `requireAuth()` alone (TEL-P1-031).
 *
 * The caller no longer supplies a secret. Either it names a saved webhook and the server
 * resolves the URL and secret itself, or it supplies a URL to try before saving and the ping is
 * signed with a throwaway value. A caller-supplied secret served no purpose except to require
 * the browser to hold one.
 */

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const userOrRes = await requireManager();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!user.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  try {
    const { url, webhookId, event } = await req.json();

    let targetUrl: string | null = null;
    // A throwaway value, but still a signing secret: Math.random() is not a source for one.
    let signingSecret = `whsec_probe_${crypto.randomBytes(24).toString('hex')}`;

    if (typeof webhookId === 'string' && webhookId) {
      // Read from the durable authority, not the cache. A webhook that Redis has forgotten —
      // evicted, flushed, or simply older than the old 30-day TTL — still exists (TEL-P1-032).
      const saved = await listWebhooks(user.tenantId);
      const match = saved.find((w) => w.id === webhookId);
      if (!match) {
        return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
      }
      targetUrl = match.url;
      signingSecret = match.secret;
    } else {
      targetUrl = typeof url === 'string' ? url : '';
    }

    const shape = checkDestinationShape(targetUrl);
    if (!shape.ok) {
      return NextResponse.json({ error: `Valid https URL required: ${shape.reason}` }, { status: 400 });
    }

    const testEvent = event || 'test.ping';
    const mockData = {
      ping: true,
      message: 'Telestar CRM Webhook Test Ping',
      environment: process.env.NODE_ENV || 'production',
      user: {
        id: user.id,
        email: user.email,
      },
      sampleEntity: {
        leadId: 'lead_test_123',
        firstName: 'Alex',
        lastName: 'Morgan',
        company: 'Apex Cloud Solutions',
        stage: 'meeting_booked',
      },
    };

    const delivery = await deliverWebhook(
      targetUrl,
      signingSecret,
      testEvent,
      mockData,
      user.tenantId
    );

    return NextResponse.json({
      success: delivery.success,
      statusCode: delivery.statusCode,
      latencyMs: delivery.latencyMs,
      error: delivery.error,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Test dispatch failed' }, { status: 500 });
  }
}
