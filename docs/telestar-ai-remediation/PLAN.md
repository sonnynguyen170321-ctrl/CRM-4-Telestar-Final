# Telestar AI + Chatbox Production Green Remediation — PLAN

Read [`STATUS.md`](./STATUS.md) first for the root cause and the resume pointer.

---

## Flow (Phase 1) — as it exists before the fix

```
components/AiAssistant.tsx        chat launcher, window, message list, input,
  |                               send handler, model picker, streaming reader,
  |                               loading + error state, turn execution id
  |  POST /api/ai/chat  { messages, modelId, context, executionId }
  v
app/api/ai/chat/route.ts          requireAuth -> AiMemory load -> live CRM context
  |                               -> loadAuthorizedLeadContext -> skill retrieval
  |                               -> system prompt -> ReadableStream
  v
lib/ai/provider.ts  streamChat    picks Groq or Gemini itself       <-- LEGACY
  |                               tool loop, executeAgentAction, recordAiCall
  v
lib/ai/providerRouting.ts         second router: hasGroq/hasGemini  <-- LEGACY
  v
Groq `llama-3.3-70b-versatile`    404 model_not_found               <-- THE DEFECT
```

Responsible files, by concern:

| Concern | File |
|---|---|
| launcher / window / list / input / send | `components/AiAssistant.tsx` |
| request payload, model selector, streaming reader, loading + error state, retry | `components/AiAssistant.tsx` |
| turn execution id | `lib/ai/executionId.ts` |
| route, auth, validation, system prompt | `app/api/ai/chat/route.ts` |
| AI memory | `prisma.aiMemory` via the route |
| lead context | `lib/leads/context.ts` |
| skill retrieval | `lib/ai/skill-retriever.ts` |
| provider invocation (legacy) | `lib/ai/provider.ts`, `lib/ai/providerRouting.ts` |
| provider invocation (target) | `lib/ai/gateway.ts` |
| tool definitions | `lib/ai/tools.ts` |
| tool authorization + execution | `lib/agent/runtime.ts`, `lib/agent/authorization.ts`, `lib/agent/toolCapabilities.ts` |
| usage ledger | `lib/ai/usage.ts` |
| budget | `lib/ai/budget.ts` |
| circuit breaker | `lib/ai/circuitBreaker.ts` |

---

## Target architecture

```
                    TELESTAR AI
                         |
                  lib/ai/gateway.ts            (the only provider caller)
                         |
     +-------------------+-------------------+
     |                   |                   |
   OPENAI              GOOGLE               GROQ
 gpt-5.6-luna     gemini-3.6-flash    openai/gpt-oss-20b
```

`lib/ai/provider.ts` and `lib/ai/providerRouting.ts` are deleted.
`lib/ai/generation.ts` becomes a thin structured-output adapter over the gateway.
`lib/ai/registry.ts` holds exactly three models with **true** provider model ids.

### Registry contract

| Alias (= model id) | Provider | Display | Notes |
|---|---|---|---|
| `gpt-5.6-luna` | openai | GPT-5.6 Luna | `max_completion_tokens`; default temperature only; `reasoning_effort:'none'` when tools are attached |
| `gemini-3.6-flash` | google | Gemini 3.6 Flash | `systemInstruction`; `functionDeclarations` |
| `openai/gpt-oss-20b` | groq | Groq GPT-OSS 20B | `max_tokens`; temperature supported |

No internal alias may differ from the provider model id, so an `AiCall` row can never claim a
model that was not called.

### Chat model experience (Phase 4)

Default is **Telestar AI · Auto** — the router picks. The picker offers Auto plus the three
approved models and nothing else. `'auto'` is the stored default, so no saved preference can
resurrect a retired id.

### Routing intention (Phase 5)

| Tier | Order |
|---|---|
| standard / tool execution | `gpt-5.6-luna`, `gemini-3.6-flash`, `openai/gpt-oss-20b` |
| fast / latency-sensitive | `openai/gpt-oss-20b`, `gpt-5.6-luna`, `gemini-3.6-flash` |
| deep / high-context | `gemini-3.6-flash`, `gpt-5.6-luna`, `openai/gpt-oss-20b` |

Capability filters still run first, so a fallback can never satisfy weaker requirements than the
primary.

---

## Task list

### Milestone A — one architecture

- [ ] A1 `lib/ai/registry.ts`: exactly three models, true ids, per-model parameter profile
- [ ] A2 `lib/ai/models.ts`: client-safe `'auto' | <3 aliases>`, `DEFAULT_MODEL = 'auto'`
- [ ] A3 `lib/ai/router.ts`: tiers rewritten to the three aliases
- [ ] A4 `lib/ai/gateway.ts`: per-model parameter adaptation (OpenAI/Gemini/Groq)
- [ ] A5 `lib/ai/gateway.ts`: `streamWithTools` — provider-neutral tool loop, tool execution
      delegated to a caller-supplied callback so no agent/Prisma import enters the gateway
- [ ] A6 `lib/ai/gateway.ts`: attribution returns `aiCallId` + attempts; accept raw attribution
      without a `SessionUser`
- [ ] A7 `lib/ai/generation.ts`: reimplemented over the gateway, same `GenerationOutcome`
- [ ] A8 delete `lib/ai/provider.ts` and `lib/ai/providerRouting.ts`

### Milestone B — the chat route

- [ ] B1 zod request validation; 4xx for bad input, never confused with provider failure
- [ ] B2 gateway execution, tool authorization preserved verbatim
- [ ] B3 error classification + human messages, no raw provider payloads
- [ ] B4 observability: correlation id per turn, safe structured log line
- [ ] B5 context, memory, lead context, skills, role note preserved

### Milestone C — the chatbox

- [ ] C1 model picker rebuilt around Auto + three models
- [ ] C2 error recovery: input usable again after a failure, no ghost bubble
- [ ] C3 accessibility: labels, focus, non-colour-only state

### Milestone D — production contract

- [ ] D1 `.env.production.example` provider block
- [ ] D2 `scripts/prod-check-env.ts` requires all three keys
- [ ] D3 container secret injection verified (web + worker)
- [ ] D4 AI status readiness endpoint / panel

### Milestone E — tests and gates

- [ ] E1 chat route unit + integration tests, regression test pinning the 404 defect
- [ ] E2 gateway tests updated to the three-model registry
- [ ] E3 Playwright chat E2E per role
- [ ] E4 stale-model scan clean
- [ ] E5 all gates green with captured exit codes
- [ ] E6 production chat smoke test
