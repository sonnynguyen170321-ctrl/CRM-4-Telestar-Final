import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { aiGateway } from '@/lib/ai/gateway';
import { MODEL_REGISTRY } from '@/lib/ai/registry';
import { routeModel, UnroutableRequestError } from '@/lib/ai/router';
import { circuitBreaker } from '@/lib/ai/circuitBreaker';

/**
 * Telestar AI provider health, for Floor Managers and Directors.
 *
 * Read-only, and deliberately narrow. It answers one operational question — "is Telestar AI
 * able to answer right now, and through which model" — because the alternative is what
 * happened in production: the only signal anyone had was an SDR reporting a sentence that
 * looked identical whether the cause was a withdrawn model, an expired key or a rate limit.
 *
 * What it never returns: a key, any part of a key, a key length, a provider error payload, or
 * a stack trace. Credentials are reported as `configured: true|false` and nothing more.
 */

interface ProviderStatus {
  provider: string;
  displayName: string;
  modelId: string;
  configured: boolean;
  circuitHealthy: boolean;
  status: 'healthy' | 'degraded' | 'unconfigured';
}

export async function GET() {
  // Floor Manager and above. An SDR's answer to "is the AI down" is the chat window itself.
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    // Adopt other instances' circuit state before reporting, or this reports one process's
    // opinion as the system's.
    await circuitBreaker.sync();

    const providers: ProviderStatus[] = Object.values(MODEL_REGISTRY).map((model) => {
      const configured = aiGateway.isProviderConfigured(model.provider);
      const circuitHealthy = circuitBreaker.isAvailable(model.provider, model.modelId);
      return {
        provider: model.provider,
        displayName: model.displayName,
        modelId: model.modelId,
        configured,
        circuitHealthy,
        status: !configured ? 'unconfigured' : circuitHealthy ? 'healthy' : 'degraded',
      };
    });

    let router: { status: 'healthy' | 'unroutable'; primaryModel: string | null; failoverChain: string[] };
    try {
      const decision = routeModel({ task: 'chat', requiresTools: true }, { requireConfiguredProvider: true });
      router = {
        status: 'healthy',
        primaryModel: decision.primaryModel.modelId,
        failoverChain: decision.fallbackModels.map((m) => m.modelId),
      };
    } catch (err) {
      if (!(err instanceof UnroutableRequestError)) throw err;
      router = { status: 'unroutable', primaryModel: null, failoverChain: [] };
    }

    // Chat is healthy when *something* can serve it. One provider down is a degraded chain,
    // not an outage — that distinction is the whole reason there are three.
    const usable = providers.filter((p) => p.status === 'healthy');
    const chat =
      router.status === 'unroutable' || usable.length === 0
        ? 'unavailable'
        : usable.length < providers.length
          ? 'degraded'
          : 'healthy';

    return NextResponse.json({
      chat,
      router,
      providers,
      checkedAt: new Date().toISOString(),
      checkedBy: user.id,
    });
  } catch (err) {
    return handleApiError('api/ai/status GET', err);
  }
}
