import { NextRequest, NextResponse } from 'next/server';
import { requireManager, type SessionUser } from '@/lib/auth';
import type { WebhookConfig, WebhookEvent } from '@/lib/webhooks/dispatcher';
import { checkDestinationShape } from '@/lib/webhooks/ssrfGuard';
import { listWebhooks, saveWebhook, deleteWebhook } from '@/lib/webhooks/store';

/**
 * Webhook administration is a management capability, not merely an authenticated one.
 *
 * Every verb here gated on `requireAuth()`, so any authenticated user — an SDR, a leadgen —
 * could list, create and delete the tenant's webhooks. A webhook is an outbound data channel
 * carrying lead events, so creating one is a way to forward a client's pipeline to an address
 * of your choosing, and `GET` returned each config's signing `secret`, which is enough to forge
 * payloads the client's systems would accept as ours. (TEL-P1-031)
 */

/** The secret is write-only: it is never read back, only replaced. */
function redactSecret(webhook: WebhookConfig): Omit<WebhookConfig, 'secret'> & { secretSet: boolean } {
  const { secret, ...rest } = webhook;
  return { ...rest, secretSet: Boolean(secret) };
}

export const dynamic = 'force-dynamic';

export async function GET() {
  const userOrRes = await requireManager();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!user.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  const webhooks = await listWebhooks(user.tenantId);
  return NextResponse.json({ webhooks: webhooks.map(redactSecret) });
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireManager();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!user.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { url, events, isActive, secret } = body;

    // `startsWith('http')` also admitted `httpx://` and credentials in the URL. The full
    // address check happens at delivery, where DNS can be resolved; this rejects the obviously
    // malformed early with a useful message.
    const shape = checkDestinationShape(typeof url === 'string' ? url : '');
    if (!shape.ok) {
      return NextResponse.json({ error: `Valid https URL required: ${shape.reason}` }, { status: 400 });
    }

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: 'At least one event must be selected' }, { status: 400 });
    }

    // Durable write. If this throws, the caller learns the webhook was NOT saved — the old
    // Redis-only path answered `{ success: true }` with Redis down and stored nothing.
    const saved = await saveWebhook(user.tenantId, {
      id: typeof body.id === 'string' && body.id ? body.id : null,
      url,
      events: events as WebhookEvent[],
      isActive,
      secret: typeof secret === 'string' ? secret : null,
    });

    // Echo the secret exactly once, on creation, so it can be copied into the receiving system.
    // It is never readable again.
    return NextResponse.json({ success: true, webhook: redactSecret(saved), secret: saved.secret });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to save webhook' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const userOrRes = await requireManager();
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

    const deleted = await deleteWebhook(user.tenantId, id);
    if (!deleted) {
      // Scoped by tenant, so an id belonging to another tenant reaches here rather than
      // deleting anything — and gets the same answer as an id that never existed.
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deletedId: id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to delete webhook' }, { status: 500 });
  }
}
