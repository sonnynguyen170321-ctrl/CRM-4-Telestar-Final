---
id: telestar-ai
version: 1.0.0
domain: telestar-ai
risk: R3
sources: [lib/ai/**, lib/agent/**, app/api/ai/**]
---

# Telestar AI

**LOAD WHEN** changing the gateway, routing, the model registry, pricing, budget reservation,
agent tools, or the chat runtime.

**DO NOT LOAD WHEN** the change is an AI *page* layout with no runtime behaviour — that is
`frontend-role-ux`. Nor for adding a domain service an agent tool happens to call: the service
belongs to its own domain.

## Source authorities

| Subject | Decides |
|---|---|
| `lib/ai/registry.ts` | models, limits, capabilities, prices |
| `lib/ai/gateway.ts`, `router.ts`, `providerAdapters.ts` | how a model is reached |
| `lib/agent/authorization.ts` | capability decisions |
| domain services | object decisions |

Evidence for every registry number: `docs/telestar-ai-remediation/MODEL_VERIFICATION.json`.

## Core invariants

- **One path to a model.** `gateway.ts` is the only entrypoint; nothing else constructs a
  provider SDK client. Three paths existed once, disagreed about what counted as a failure
  worth failing over, and every chat message in production returned a generic apology.
- **`internalAlias === modelId`.** An alias pointing at a different model makes the whole
  `AiCall` ledger fiction.
- **A registered model always prices.** Unresolvable rates raise `PricingConfigurationError`,
  never `$0` — zero against real tokens reads as a free call and walks through the spend cap.
- **Budget is per provider attempt.** One turn can bill two providers; each attempt reserves
  and settles its own cost, including partial usage from an attempt that failed mid-stream.
- **Capability authorization is not object authorization.** `tasks = auto` means "may create
  tasks at all", never "may act on this lead".
- **No Prisma client in the AI layer.** Nothing under `lib/ai/` reads a CRM table directly.
- **AI down never means CRM down.**

## Known failure modes

- **A withdrawn model id.** The original outage. `npm run check:stale-models` fails the build
  on a retired id in runtime code; run it after any registry edit.
- **Deprecated provider parameters.** Gemini's `temperature`/`top_p`/`top_k` are accepted and
  ignored today, documented to error in a future generation. `rejectedParameters` plus
  `assertNoRejectedParameters` stop them being sent.
- **The client/server boundary.** `lib/ai/models.ts` must stay import-free. A `"use client"`
  module importing `provider.ts`/`usage.ts`/`tools.ts` pulls `async_hooks`/`dns`/`net` into
  the browser bundle and `next build` fails — **while tsc and Vitest both pass**.
- **A parameter that fits the ceiling but not the window.** `prompt + max_tokens` must fit the
  context limit, which is why `defaultMaxOutputTokens` is separate from `maxOutputTokens`.
- **Prompt data that never arrives.** A context key the schema accepts and the prompt never
  reads looks like a working feature. Test that output tracks the source by changing it.

## Required tests

```
tests/ai-model-registry.test.ts        tests/ai-pricing-contract.test.ts
tests/ai-gateway.test.ts               tests/ai-stream-governance.test.ts
tests/ai-provider-client-containment.test.ts
tests/agent-object-authorization.test.ts
tests/ai-optional.test.ts              npm run check:stale-models
```

Live provider smoke requires all three credentials and demands 3/3. Without them it is
`BLOCKED_EXTERNAL`, never a pass.

## Eval cases

- chat returns a generic failure for every message → gateway + registry, R3
- tenant billed twice for one turn → budget settlement, R3
- an agent tool reads a lead it should not → object authorization in the domain service, R4
