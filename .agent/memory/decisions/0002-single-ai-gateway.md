---
id: ADR-0002
title: One gateway, one router, three providers
status: accepted
classification: CURRENT_CANONICAL
---

# ADR-0002 — One AI gateway

## Context

The product reached models from three places: `lib/ai/gateway.ts`, `lib/ai/provider.ts` for
chat, and `lib/ai/providerRouting.ts` for background generation. Each had its own idea of which
provider to try and what counted as a failure worth failing over.

The disagreement is what shipped. Chat hard-coded a Groq model that had been withdrawn. Groq
returned 404. The legacy router only failed over on rate limits, so a 404 was not a fallback
condition — it rethrew, and every message in production came back as *"Sorry, I ran into a
problem generating that."* Nothing in the response distinguished a withdrawn model from an
expired key from a malformed request.

## Decision

`lib/ai/gateway.ts` is the only entrypoint for generation, streaming, structured output and
tool loops. Nothing else constructs a provider SDK client. `lib/ai/provider.ts` and
`lib/ai/providerRouting.ts` are deleted and must not return.

The gateway owns routing, circuit breaking, timeouts, budget reservation and settlement, usage
attribution, and the provider-neutral tool loop. It deliberately does **not** own tool
authorization — that stays in the CRM domain services.

## Why

Three code paths to the same providers is three failure-classification policies, three
fallback policies and three places a model id can rot. The outage was not caused by any one of
them being wrong; it was caused by them disagreeing while all appearing correct in isolation.

One path also makes the governance attachable: budget, attribution and circuit state have
exactly one place to live.

## Alternatives

- **Shared helper, separate callers.** Rejected: the helper drifts into a lowest common denominator and callers add "just one" special case.
- **Provider SDK directly at each call site.** Rejected: this is what produced the outage.

## Consequences

- A new capability means a gateway parameter, not a second path.
- Provider-specific quirks live in `providerAdapters.ts` and nowhere else.
- Adding a provider client anywhere fails the build.

## Protection

- `tests/ai-provider-client-containment.test.ts` — source scan; also asserts the two legacy modules have not reappeared
- `tests/ai-gateway.test.ts`, `tests/phase-8a-provider-routing.test.ts`
- `scripts/check-stale-models.mjs` — a retired model id in runtime code fails the build
