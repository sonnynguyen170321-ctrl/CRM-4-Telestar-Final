import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';
import { aiGateway } from '@/lib/ai/gateway';
import { MODEL_REGISTRY, type ModelProvider } from '@/lib/ai/registry';
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
 * ## "Healthy" means a provider answered, not that a key exists
 *
 * This endpoint used to compute `configured && circuitHealthy ? 'healthy' : ...`. Both inputs
 * are real, and neither is evidence:
 *
 *   - `configured` is true for any non-empty string. A revoked key, a key for the wrong
 *     project, and a key with a trailing newline are all "configured".
 *   - `circuitHealthy` is true whenever the breaker has not *recently* opened — which is also
 *     its state before anything has ever been tried.
 *
 * A deployment with three expired keys therefore reported three healthy providers, right up
 * until an SDR sent a message. Health is now derived from **evidence that a provider actually
 * answered**: the `AiCall` ledger the gateway already writes on every attempt. Within
 * `HEALTH_EVIDENCE_TTL_MS` of a successful call a provider is `healthy`; older than that it is
 * `stale`; with no success ever recorded it is `unknown`. None of those are failures — they
 * are honest descriptions of what is and is not known.
 *
 * ## Why it does not call the providers
 *
 * Probing three providers on every dashboard refresh spends real money to answer a question
 * the ledger already answers for free, and a status page on a wall-mounted screen would do it
 * every minute forever. Real traffic is the probe.
 *
 * When a definitive live answer is needed — during a deployment, say — that is what
 * `scripts/ai-gateway-smoke.ts` is for, run inside the container being certified. It is
 * deliberately an operator action with a cost, not something a page refresh can trigger.
 */

/**
 * How recently a provider must have answered to count as healthy.
 *
 * Fifteen minutes: long enough that a quiet lunch hour does not turn the board amber, short
 * enough that a key revoked this morning is not still reported as healthy this afternoon.
 */
const HEALTH_EVIDENCE_TTL_MS = 15 * 60 * 1000;

/**
 * Distinct states, because "not healthy" covers several different operator actions.
 *
 * `unknown` and `stale` are explicitly not `healthy` and explicitly not failures — conflating
 * either with `healthy` is the bug this replaced.
 */
type ProviderHealth = 'unconfigured' | 'unknown' | 'healthy' | 'degraded' | 'unavailable' | 'stale';

interface ProviderStatus {
  provider: ModelProvider;
  displayName: string;
  modelId: string;
  configured: boolean;
  circuitHealthy: boolean;
  status: ProviderHealth;
  /** When this provider last answered successfully, from the attribution ledger. */
  lastSuccessAt: string | null;
  /** Latency of that successful call. */
  lastSuccessLatencyMs: number | null;
  /** When it last failed, and how — a safe classification, never a provider payload. */
  lastFailureAt: string | null;
  lastFailureClass: string | null;
  /** Whether the success evidence is inside the TTL. */
  evidenceFresh: boolean;
}

/**
 * The gateway records Google under `google`; older rows and other call sites used `gemini`.
 * Both name the same provider and health must not depend on which spelling a row used.
 */
const PROVIDER_ALIASES: Record<ModelProvider, string[]> = {
  openai: ['openai'],
  google: ['google', 'gemini'],
  groq: ['groq'],
};

interface LedgerEvidence {
  lastSuccessAt: Date | null;
  lastSuccessLatencyMs: number | null;
  lastFailureAt: Date | null;
  lastFailureClass: string | null;
}

/**
 * Last success and last failure per provider, from calls this tenant already paid for.
 *
 * Scoped to the caller's tenant so the query stays inside the same authorization boundary as
 * everything else the caller can read.
 */
async function loadLedgerEvidence(tenantId: string): Promise<Map<ModelProvider, LedgerEvidence>> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const evidence = new Map<ModelProvider, LedgerEvidence>();

  for (const provider of Object.keys(PROVIDER_ALIASES) as ModelProvider[]) {
    const names = PROVIDER_ALIASES[provider];
    const [success, failure] = await Promise.all([
      prisma.aiCall.findFirst({
        where: { tenantId, provider: { in: names }, status: 'ok', createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, latencyMs: true },
      }),
      prisma.aiCall.findFirst({
        where: { tenantId, provider: { in: names }, status: { not: 'ok' }, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, errorCode: true },
      }),
    ]);

    evidence.set(provider, {
      lastSuccessAt: success?.createdAt ?? null,
      lastSuccessLatencyMs: success?.latencyMs ?? null,
      lastFailureAt: failure?.createdAt ?? null,
      lastFailureClass: failure?.errorCode ?? null,
    });
  }

  return evidence;
}

function classify(
  configured: boolean,
  circuitHealthy: boolean,
  evidence: LedgerEvidence,
  now: number,
): { status: ProviderHealth; evidenceFresh: boolean } {
  const successAt = evidence.lastSuccessAt?.getTime() ?? null;
  const evidenceFresh = successAt !== null && now - successAt <= HEALTH_EVIDENCE_TTL_MS;

  // No credential in this process is the one state that needs no evidence: this provider
  // cannot be reached at all, whatever the ledger remembers from another deployment.
  if (!configured) return { status: 'unconfigured', evidenceFresh };

  // An open breaker is current, first-hand evidence of failure and outranks a stale success.
  if (!circuitHealthy) return { status: 'unavailable', evidenceFresh };

  if (successAt === null) {
    // Configured, breaker closed, and nothing has ever come back from it. That is not health.
    return { status: 'unknown', evidenceFresh };
  }

  if (!evidenceFresh) return { status: 'stale', evidenceFresh };

  const failureAt = evidence.lastFailureAt?.getTime() ?? null;
  // Answering, but not cleanly — worth showing differently from a provider with a clean run.
  if (failureAt !== null && failureAt > successAt) return { status: 'degraded', evidenceFresh };

  return { status: 'healthy', evidenceFresh };
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

    const now = Date.now();
    const evidence = user.tenantId
      ? await loadLedgerEvidence(user.tenantId)
      : new Map<ModelProvider, LedgerEvidence>();

    const providers: ProviderStatus[] = Object.values(MODEL_REGISTRY).map((model) => {
      const configured = aiGateway.isProviderConfigured(model.provider);
      const circuitHealthy = circuitBreaker.isAvailable(model.provider, model.modelId);
      const seen: LedgerEvidence = evidence.get(model.provider) ?? {
        lastSuccessAt: null,
        lastSuccessLatencyMs: null,
        lastFailureAt: null,
        lastFailureClass: null,
      };
      const { status, evidenceFresh } = classify(configured, circuitHealthy, seen, now);

      return {
        provider: model.provider,
        displayName: model.displayName,
        modelId: model.modelId,
        configured,
        circuitHealthy,
        status,
        lastSuccessAt: seen.lastSuccessAt?.toISOString() ?? null,
        lastSuccessLatencyMs: seen.lastSuccessLatencyMs,
        lastFailureAt: seen.lastFailureAt?.toISOString() ?? null,
        lastFailureClass: seen.lastFailureClass,
        evidenceFresh,
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
    //
    // `unknown` and `stale` providers are counted as usable but not as confirmed: a fresh
    // deployment that has served nothing yet reports `degraded`, which is the truth. It is
    // not reported `healthy` on the strength of three unverified key strings.
    const confirmed = providers.filter((p) => p.status === 'healthy');
    const usable = providers.filter((p) => p.status === 'healthy' || p.status === 'degraded' || p.status === 'unknown' || p.status === 'stale');
    const chat =
      router.status === 'unroutable' || usable.length === 0
        ? 'unavailable'
        : confirmed.length === providers.length
          ? 'healthy'
          : 'degraded';

    return NextResponse.json({
      chat,
      router,
      providers,
      evidenceTtlMs: HEALTH_EVIDENCE_TTL_MS,
      // Says out loud that nothing here called a provider, so a reader does not mistake this
      // for a live probe.
      evidenceSource: 'ai_call_ledger',
      checkedAt: new Date().toISOString(),
      checkedBy: user.id,
    });
  } catch (err) {
    return handleApiError('api/ai/status GET', err);
  }
}
