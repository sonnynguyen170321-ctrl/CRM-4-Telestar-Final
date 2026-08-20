---
paths:
  - lib/ai/**
  - lib/agent/**
  - app/api/ai/**
  - components/AiAssistant.tsx
  - scripts/ai-*.ts
domain: telestar-ai
risk: R3
---

# Telestar AI

## One gateway, one router, three providers

`lib/ai/gateway.ts` is the only entrypoint for generation, streaming, structured output and
tool loops. Nothing else constructs a provider SDK client —
`tests/ai-provider-client-containment.test.ts` enforces that as a source scan.

There used to be three ways to reach a model, disagreeing about which provider to try and what
counted as a failure worth failing over. Chat hard-coded a withdrawn Groq model, got a 404,
and because the legacy router only failed over on rate limits every message came back as
"Sorry, I ran into a problem generating that."

## The model registry is the only source of model truth

`lib/ai/registry.ts` holds three production models, and `internalAlias === modelId` for each.
Limits, capabilities and prices are dated facts re-read from provider documentation — see
`docs/telestar-ai-remediation/MODEL_VERIFICATION.json` for the evidence behind each number.

Pricing is effective-dated and lives only on the model. There is no second price table.
`lib/ai/pricing.ts` is the arithmetic, not the rates. A registered model whose price will not
resolve raises `PricingConfigurationError` — never a silent `$0`, which reads as a free call
and bypasses the tenant's budget cap.

`npm run check:stale-models` fails the build on a retired model id in runtime code.

## Cost is governed per provider attempt

One turn can bill two providers. Each attempt reserves its own estimate and settles its own
actual cost, including the partial usage of an attempt that failed mid-stream. Never collapse
that back to one reservation per turn.

## Authorization

Capability authorization is **not** object authorization. `tasks = auto` means "may create
tasks at all", not "may act on this lead". Object scope — tenant, `canAccessLead`,
`canAccessUser`, pod hierarchy, campaign scope, send-window permission — stays in the CRM
domain services and is never reproduced in the agent layer.

No agent tool holds a Prisma client. Nothing under `lib/ai/` may read a CRM table directly;
it calls a domain service, which already enforces tenancy, permissions and audit.
`tests/agent-object-authorization.test.ts` enforces both halves.

A blocked action is never reported to the model or the user as if it succeeded.

## Client/server boundary

`lib/ai/models.ts` is client-safe and must stay import-free. `provider.ts`, `usage.ts`,
`tools.ts` and any Prisma-backed AI service are server-only — no `"use client"` module may
import them, directly or transitively. `provider.ts` reaches the database through `usage.ts`,
so a client import pulls `async_hooks`/`dns`/`net` into the browser bundle and `next build`
fails. **tsc and Vitest pass while this is broken**; `tests/ai-optional.test.ts` holds the line.

## The browser supplies hints, not facts

The chat route accepts `page` and `leadId` and nothing else. Identity, role, tenant and every
counter are read server-side. A client-supplied counter is a counter the client chose.

AI down must never mean CRM down.
