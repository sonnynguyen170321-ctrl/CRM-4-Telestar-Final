import crypto from 'crypto';

export type WebhookEvent = 
  | 'lead.created'
  | 'lead.stage_changed'
  | 'meeting.booked'
  | 'sequence.completed'
  | 'inbound.reply_received'
  | 'test.ping';

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

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
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
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

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
