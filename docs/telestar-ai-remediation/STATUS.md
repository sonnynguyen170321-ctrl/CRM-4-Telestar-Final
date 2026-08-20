# Telestar AI + Chatbox Production Green Remediation — STATUS

**Resume pointer. Read this first, then `PLAN.md`.**

Started: 2026-08-20 · Branch: `fix/telestar-ai-three-provider`

---

## CURRENT CHAT ROOT CAUSE

The production symptom —

> "Sorry, I ran into a problem generating that. Please try again in a moment."

— is produced by [route.ts:152](../../app/api/ai/chat/route.ts#L152), the generic catch in the
chat stream. The underlying exception is a **Groq 404 `model_not_found`**.

Captured live against the real production credentials on 2026-08-20:

```
GROQ  FAIL llama-3.3-70b-versatile -> [404] {"error":{"message":"The model
      `llama-3.3-70b-versatile` does not exist or you do not have access to it.",
      "type":"invalid_request_error","code":"model_not_found"}}
```

Chain of causation:

1. `app/api/ai/chat/route.ts` defaults `modelId` to `DEFAULT_MODEL`.
2. `lib/ai/models.ts` sets `DEFAULT_MODEL = 'llama-3.3-70b-versatile'`.
3. `lib/ai/provider.ts` `streamGroq` sends that id to Groq. Groq returns **404**.
4. `shouldFallbackToGemini` only falls back on a **rate limit**, so a 404 is not a fallback
   condition — the error rethrows.
5. The tool-error retry branch matches `status === 400`, not 404, so it does not catch it either.
6. The route's catch writes the generic sentence.

**Every Groq model the chat runtime can select is dead**, so no model choice in the picker
recovers it:

| Model the picker offers | Live result |
|---|---|
| `llama-3.3-70b-versatile` | 404 `model_not_found` |
| `llama-3.1-8b-instant` | 404 `model_not_found` |
| `gemma2-9b-it` | 400 "has been decommissioned and is no longer supported" |
| `gemini-flash-latest` | works (the only survivor) |

### Four further causes found in the same sweep

**Cause 2 — the gateway would fail on OpenAI too.** `lib/ai/gateway.ts` sends `max_tokens` and
`temperature: 0.7`. The approved model rejects both:

```
[400] Unsupported parameter: 'max_tokens' is not supported with this model.
      Use 'max_completion_tokens' instead.
[400] Unsupported value: 'temperature' does not support 0.7 with this model.
      Only the default (1) value is supported.
```

**Cause 3 — false model attribution.** `lib/ai/registry.ts` maps the alias `gpt-5.6-luna` to the
API id `gpt-4o-mini`, `gpt-5.6-terra` to `gpt-4o`, `gpt-5.6-sol` to `o3-mini`. `gpt-5.6-luna` is a
real OpenAI model id that answers directly — the alias layer was inventing a mapping that made
every `AiCall` row claim a model that was never called.

**Cause 4 — tools are refused on the approved OpenAI model unless asked for correctly.**

```
[400] Function tools with reasoning_effort are not supported for gpt-5.6-luna in
      /v1/chat/completions. To use function tools, use /v1/responses or set
      reasoning_effort to 'none'.
```

**Cause 5 — every non-chat AI feature is broken by the same dead model.**
`lib/ai/generation.ts` (draft-reply, daily-briefing, enrich-lead, SDR assist, reply
classification, lead refinement, sequence drafts) sends `DEFAULT_MODEL` to Groq — the same 404.

---

## VERIFIED PROVIDER CONTRACT (live, 2026-08-20)

`node node_modules/tsx/dist/cli.mjs scripts/ai-provider-smoke.ts` → **3/3 PASS, exit 0**

| Provider | Model | Verified |
|---|---|---|
| openai | `gpt-5.6-luna` | completion, streaming + usage chunk, tools with `reasoning_effort:'none'`; needs `max_completion_tokens`; temperature must be default |
| google | `gemini-3.6-flash` | completion, streaming + usage, `systemInstruction`, `functionDeclarations` |
| groq | `openai/gpt-oss-20b` | completion, streaming + `x_groq` usage, tools |

Credentials: `OPENAI_API_KEY` SET · `GEMINI_API_KEY` SET · `GROQ_API_KEY` SET.

---

## Progress

| Phase | State |
|---|---|
| 0 Diagnose | ✅ done — root cause above, evidence captured |
| 1 Trace chat flow | ✅ done — see `PLAN.md` §Flow |
| 2 Remove legacy provider path | ✅ done — `lib/ai/provider.ts` + `lib/ai/providerRouting.ts` deleted |
| 3 Consolidate model registry | ✅ done — three models, alias == modelId |
| 4 Chat model experience | ✅ done — Auto default + three models |
| 5 Routing intention | ✅ done — tiers rewritten |
| 6 API key production contract | ⬜ |
| 7 Container secret injection | ⬜ |
| 8 Direct provider smoke test | ✅ done — 3/3 |
| 9 Gateway-level test | ✅ done — 14/14, `scripts/ai-gateway-smoke.ts` |
| 10 Chat API contract | ✅ done — zod validation, 4xx separated from provider failure |
| 11 Chat context preserved | ✅ done |
| 12 Role-aware behaviour | ⬜ |
| 13 Chat input experience | ⬜ |
| 14 Streaming experience | ✅ done — real token streaming with tools attached |
| 15 Loading / UX states | ✅ done — no ghost bubble, input refocuses, empty stream handled |
| 16 Chat error design | ✅ done — `userMessageForFailure` |
| 17 Observability | ✅ done — `turnId` + structured log lines |
| 18 Retry behaviour | ✅ done — execution id preserved, ordinal action keys |
| 19 Tool security preserved | ✅ done — `executeAgentAction` unchanged, both guards carried over |
| 20 Tool call matrix | ⬜ |
| 21 Conversation continuity | ⬜ |
| 22 AI memory | ⬜ |
| 23 Lead context | ⬜ |
| 24 Page context | ⬜ |
| 25 Chatbox layout | ⬜ |
| 26 Accessibility | ✅ done — dialog/log roles, labels, Escape, non-colour state |
| 27 Network failure | ⬜ |
| 28 Provider failover | ✅ done — verified live, all three directions + total outage |
| 29 Circuit breaker | ✅ done — verified live |
| 30 Budget governance | ✅ done — `tests/ai-stream-governance.test.ts` 10/10 |
| 31 All AI entry points | ✅ done — `generation.ts` rebuilt on the gateway |
| 32 AI status panel | ⬜ |
| 33 Automated chat route tests | ⬜ |
| 34 Playwright chat E2E | ⬜ |
| 35 Production chat smoke | ⬜ |
| 36 Provider attribution | ⬜ |
| 37 Stale model scan | ⬜ |
| 38 Security regression | ⬜ |
| 39 Quality gates | ⬜ |
| 40 No certification cheating | ⬜ |
