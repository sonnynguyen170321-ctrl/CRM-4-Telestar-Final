import crypto from 'crypto';
import { fetch as undiciFetch } from 'undici';

import { assertPublicDestination, guardedDispatcher } from '@/lib/webhooks/ssrfGuard';

export type WebhookEvent = 
  | 'lead.created'
  | 'lead.stage_changed'
  | 'meeting.booked'
  | 'sequence.completed'
  | 'inbound.reply_received'
  | 'test.ping';

/**
 * A webhook as the API returns it. The signing secret is write-only — it is echoed once on
 * creation and never read back, because it is enough to forge payloads the receiving system
 * would accept as ours (TEL-P1-031).
 */
export type WebhookConfigPublic = Omit<WebhookConfig, 'secret'> & { secretSet: boolean };

export interface WebhookConfig {
  id: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  isActive: boolean;
  tenantId: string;
  createdAt: string;
  lastDeliveryAt?: string | null;
  lastStatus?: number | null;
}

export interface WebhookPayload {
  id: string;
  event: WebhookEvent;
  timestamp: string;
  tenantId: string;
  data: Record<string, unknown>;
}

/**
 * Sign payload using HMAC-SHA256
 */
export function signWebhookPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Dispatch an event to a specific webhook endpoint
 */
export async function deliverWebhook(
  url: string,
  secret: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
  tenantId: string
): Promise<{ success: boolean; statusCode?: number; latencyMs: number; error?: string }> {
  const payload: WebhookPayload = {
    id: `evt_${crypto.randomUUID()}`,
    event,
    timestamp: new Date().toISOString(),
    tenantId,
    data,
  };

  const payloadString = JSON.stringify(payload);
  const signature = signWebhookPayload(payloadString, secret);
  const startTime = Date.now();

  // The guard lives here rather than in the routes so that every caller inherits it — the test
  // ping and the real event dispatcher alike. Validating in one route and forgetting the other
  // is how this class of hole reopens (TEL-P1-030).
  const destination = await assertPublicDestination(url);
  if (!destination.ok) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: `Refused webhook destination: ${destination.reason}`,
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await undiciFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Telestar-Webhooks/1.0',
        'X-Telestar-Event': event,
        'X-Telestar-Delivery': payload.id,
        'X-Telestar-Signature-256': `sha256=${signature}`,
      },
      body: payloadString,
      signal: controller.signal,
      // Authoritative guard: re-checks the resolved address at connect time, so a DNS record
      // that changes between the pre-check and the connection cannot be used.
      dispatcher: guardedDispatcher,
      // A validated public URL that answers 302 to http://169.254.169.254 would otherwise be
      // followed automatically, defeating the check above. Webhook endpoints have no reason to
      // redirect, so a redirect is a failed delivery rather than something to chase.
      redirect: 'manual',
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (response.status >= 300 && response.status < 400) {
      return {
        success: false,
        statusCode: response.status,
        latencyMs,
        error: 'Refused webhook destination: endpoint redirected; provide the final URL',
      };
    }

    return {
      success: response.ok,
      statusCode: response.status,
      latencyMs,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      success: false,
      latencyMs,
      error: err.name === 'AbortError' ? 'Connection timed out (8s limit)' : err.message || 'Delivery failed',
    };
  }
}
