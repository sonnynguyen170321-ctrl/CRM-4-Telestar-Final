import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuth, type SessionUser } from '@/lib/auth';
import { cacheGet, cacheSet } from '@/lib/cache';
import type { WebhookConfig, WebhookEvent } from '@/lib/webhooks/dispatcher';

export const dynamic = 'force-dynamic';

const WEBHOOK_CACHE_TTL = 3600 * 24 * 30; // 30 days in Redis

function getCacheKey(tenantId: string): string {
  return `webhooks:configs:${tenantId}`;
}

export async function GET() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!user.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  const cached = await cacheGet<WebhookConfig[]>(getCacheKey(user.tenantId));
  return NextResponse.json({ webhooks: cached || [] });
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!user.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { url, events, isActive, secret } = body;

    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return NextResponse.json({ error: 'Valid URL (http/https) is required' }, { status: 400 });
    }

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: 'At least one event must be selected' }, { status: 400 });
    }

    const current = (await cacheGet<WebhookConfig[]>(getCacheKey(user.tenantId))) || [];
    const webhookId = body.id || `wh_${crypto.randomUUID().slice(0, 8)}`;

    const newWebhook: WebhookConfig = {
      id: webhookId,
      url: url.trim(),
      secret: secret && typeof secret === 'string' ? secret.trim() : crypto.randomBytes(24).toString('hex'),
      events: events as WebhookEvent[],
      isActive: isActive !== false,
      tenantId: user.tenantId,
      createdAt: new Date().toISOString(),
      lastDeliveryAt: null,
      lastStatus: null,
    };

    const updated = current.filter((w) => w.id !== webhookId).concat(newWebhook);
    await cacheSet(getCacheKey(user.tenantId), updated, WEBHOOK_CACHE_TTL);

    return NextResponse.json({ success: true, webhook: newWebhook });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to save webhook' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!user.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Webhook id is required' }, { status: 400 });
    }

    const current = (await cacheGet<WebhookConfig[]>(getCacheKey(user.tenantId))) || [];
    const updated = current.filter((w) => w.id !== id);
    await cacheSet(getCacheKey(user.tenantId), updated, WEBHOOK_CACHE_TTL);

    return NextResponse.json({ success: true, deletedId: id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to delete webhook' }, { status: 500 });
  }
}
