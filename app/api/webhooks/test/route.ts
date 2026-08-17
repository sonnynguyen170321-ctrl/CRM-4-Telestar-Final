import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, type SessionUser } from '@/lib/auth';
import { deliverWebhook } from '@/lib/webhooks/dispatcher';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!user.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  try {
    const { url, secret, event } = await req.json();

    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return NextResponse.json({ error: 'Valid URL is required' }, { status: 400 });
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
      url,
      secret || 'whsec_test_secret',
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
