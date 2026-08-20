---
classification: CURRENT_CANONICAL
note: Live resume pointer for the AI remediation branch.
---

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
| 6 API key production contract | ✅ DONE — required by `prod-check-env`, documented in `.env.production.example` |
| 7 Container secret injection | ✅ DONE — `env_file` on the shared anchor; `scripts/verify-container-secrets.sh` |
| 8 Direct provider smoke test | ✅ done — 3/3 |
| 9 Gateway-level test | ✅ done — 14/14, `scripts/ai-gateway-smoke.ts` |
| 10 Chat API contract | ✅ done — zod validation, 4xx separated from provider failure |
| 11 Chat context preserved | ✅ done |
| 12 Role-aware behaviour | ✅ DONE — 4 roles green in Playwright; prompt built from session only |
| 13 Chat input experience | ✅ DONE — Enter/Shift+Enter, blank guard, awkward characters |
| 14 Streaming experience | ✅ done — real token streaming with tools attached |
| 15 Loading / UX states | ✅ done — no ghost bubble, input refocuses, empty stream handled |
| 16 Chat error design | ✅ done — `userMessageForFailure` |
| 17 Observability | ✅ done — `turnId` + structured log lines |
| 18 Retry behaviour | ✅ done — execution id preserved, ordinal action keys |
| 19 Tool security preserved | ✅ done — `executeAgentAction` unchanged, both guards carried over |
| 20 Tool call matrix | ✅ DONE — read tool, write tool, refusal, retry safety |
| 21 Conversation continuity | ✅ DONE — multi-turn recall verified per role |
| 22 AI memory | ✅ DONE — session-scoped load asserted in `tests/ai-chat-route.test.ts` |
| 23 Lead context | ✅ DONE — authorized loader only; unauthorized lead yields no context |
| 24 Page context | ✅ DONE — page drives channel inference; validated and bounded |
| 25 Chatbox layout | ✅ DONE — no horizontal overflow, close/reopen, Escape |
| 26 Accessibility | ✅ done — dialog/log roles, labels, Escape, non-colour state |
| 27 Network failure | ✅ DONE — aborted request recovers without a refresh |
| 28 Provider failover | ✅ done — verified live, all three directions + total outage |
| 29 Circuit breaker | ✅ done — verified live |
| 30 Budget governance | ✅ done — `tests/ai-stream-governance.test.ts` 10/10 |
| 31 All AI entry points | ✅ done — `generation.ts` rebuilt on the gateway |
| 32 AI status panel | ✅ DONE — `GET /api/ai/status`, floor_manager and above |
| 33 Automated chat route tests | ✅ DONE — 35 tests incl. the 404 regression |
| 34 Playwright chat E2E | ✅ DONE — 30/30, exit 0, real providers, 4 roles |
| 35 Production chat smoke | 🟡 READY — needs deploy; see `PRODUCTION_GATE.md` |
| 36 Provider attribution | ✅ DONE — `scripts/verify-ai-attribution.ts` PASS over live rows |
| 37 Stale model scan | ✅ DONE — `npm run check:stale-models` PASS; found and fixed the onboarding route |
| 38 Security regression | ✅ DONE — 126 tests across auth, RBAC, tenancy, RLS, injection |
| 39 Quality gates | ✅ DONE — see the scorecard below |
| 40 No certification cheating | ✅ DONE — no assertion weakened; every model change re-proved live |

---

## Defects found and fixed beyond the reported symptom

| # | Defect | Found by |
|---|---|---|
| 1 | Chat routed to a withdrawn Groq model; a 404 was not a fallback condition | direct provider probe |
| 2 | Gateway sent `max_tokens` + `temperature: 0.7`, both 400s on gpt-5.6-luna | direct provider probe |
| 3 | Registry aliased `gpt-5.6-luna` onto `gpt-4o-mini` — false ledger attribution | code read |
| 4 | Function tools refused on gpt-5.6-luna without `reasoning_effort: 'none'` | direct provider probe |
| 5 | `generation.ts` sent the same dead model, breaking every background AI feature | code read |
| 6 | `pricing.ts` knew no approved model — every call priced null, budget reconciled to zero | test |
| 7 | Gemini starved of output tokens by a caller-supplied cap it should never have received | gateway smoke test |
| 8 | Gemini tool results replayed under role `'function'`, rejected by gemini-3.6-flash | gateway smoke test |
| 9 | `app/api/ai/onboarding` built its own Groq client on a dead model | stale-model scan |
| 10 | `/api/ai/briefing` applied a Task filter to Lead queries — 500 for every non-director role | Playwright recorder |

Defect 10 is worth its own note: it predates this work, and the only reason it was ever
invisible is that the chatbox swallows a failed briefing with `.catch(() => {})`. The symptom
was a morning briefing that silently never appeared.

---

## Final gate run (2026-08-20, nothing running concurrently)

| Gate | Command | Exit |
|---|---|---|
| TypeScript | `tsc --noEmit` | **0** |
| ESLint | `eslint .` | **0** (0 errors, 9 pre-existing warnings) |
| Vitest | `vitest run` | **0** — 2118/2118, 167 files |
| Production build | `node scripts/build.cjs` | **0** |
| Stale model scan | `npm run check:stale-models` | **0** |
| Direct provider smoke | `npm run ai:smoke-providers` | **0** — 3/3 |
| Gateway smoke | `npm run ai:smoke-gateway` | **0** — 14/14 |
| Chat E2E (Playwright) | `--project=audit e2e/journeys/telestar-ai-chat.spec.ts` | **0** — 30/30 |
| Provider attribution | `scripts/verify-ai-attribution.ts` | **0** |
| Production env contract | `prod-check-env --file .env.production.example` | requires all three keys |

Every exit code was captured from the tool itself, never from the tail of a pipe.

**Chat attribution over the E2E run:** 80 `operation=chat` rows, all `status=ok`, all
`openai/gpt-5.6-luna`, 191,866 tokens. Zero failures. Server log: 21 `[ai/chat] turn` lines,
0 non-`ok`, 0 `[ai/gateway] provider attempt failed`.

### Two failures that were not failures

- `tests/import-load-benchmark.test.ts` timed out at 45s during a full Vitest run held
  concurrently with the browser suite; it passes 3/3 in isolation. This is the contention
  `CLAUDE.md` documents for that file.
- The gateway smoke test's original failover check forced a circuit open, then lost the
  manipulation to `circuitBreaker.sync()` reading the cluster's healthy view back from Redis.
  That is the system working. The check now removes a provider's credentials instead.

### Still open

**Phase 35 — production chat smoke.** `https://crm.telestar.cloud` is serving commit
`9ba27b8`, which predates this work. Deploying to a live system carrying real users is not
something to do unattended, so nothing here was run against production. Every step needed
afterwards is written out in [`PRODUCTION_GATE.md`](./PRODUCTION_GATE.md).

---

# Pass 2 — 2026-08-20 — certification directive remediation

**Candidate:** `9cec9d9` on `fix/telestar-ai-three-provider` (PR #98).
Pass 1's head was `e8600a3`; every gate below was re-run on this candidate, not carried over.

## The exact-candidate rule applies to pass 1's evidence

Pass 1 recorded a live 3/3 provider smoke and a 14/14 gateway smoke. Those were true, on
`e8600a3`, on a machine that had the production credentials. **They are not evidence for
`9cec9d9`** and are not repeated as such below. This machine has no `OPENAI_API_KEY`,
`GEMINI_API_KEY` or `GROQ_API_KEY` in the environment and no `.env.local`, so everything that
requires a real provider is `BLOCKED_EXTERNAL` here.

## What was wrong, and is now fixed

| # | Finding | Evidence it was real |
|---|---|---|
| 1 | Registry stale on 11 of 12 limits and rates | Provider docs re-read 2026-08-20; see `MODEL_VERIFICATION.json` |
| 2 | Gemini priced at $0.075/M input against a real $0.75/M | 10x under; budget reconciled against fiction |
| 3 | No effective dating — Gemini's rate changes 2027-01-01 | A scalar is silently wrong from that date |
| 4 | No long-context rule — Luna re-prices the whole request >272K | Linear estimate is 100% low on the largest calls |
| 5 | Budget reserved a flat `$0.005` per turn | `gateway.ts:375`; ~100x under-reservation on a large Luna call |
| 6 | Fallback spend never reached the budget period | `settleOnce` settled once per turn; provider A's cost stayed in the ledger only |
| 7 | Provider smoke exited 0 on **zero** configured providers | `probes` array only populated for present keys |
| 8 | `configured && circuitHealthy` reported as `healthy` | Three revoked keys reported three healthy providers |
| 9 | Chat context comment said `.strip()`, code said `.passthrough()` | `route.ts:42` vs `:56` |
| 10 | Client-supplied performance counters used as CRM truth | Counters read straight from the request body into the prompt |
| 11 | `context.eodData` accepted by the schema and read by nothing | A full browser round trip to nowhere |
| 12 | `check:stale-models` wired into no CI gate | The scan that prevents the original outage was advisory only |
| 13 | Dependency security depended on a plan feature | Dependency Review only; nothing ran on push |
| 14 | 3 high-severity advisories in the email-parsing path | GHSA-ggr8-5vv4-36mx via html-to-text/mailparser |
| 15 | Image publishing gated on the whole CI workflow conclusion | A permanently-red optional scanner blocks every release |

## Gates on `9cec9d9`

Every exit code captured from the tool itself, never from the tail of a pipe.

| Gate | Command | Exit | Result |
|---|---|---|---|
| TypeScript | `node node_modules/typescript/bin/tsc --noEmit` | **0** | 0 errors |
| ESLint | `node node_modules/eslint/bin/eslint.js .` | **0** | 0 errors, 11 warnings |
| Vitest (full) | `node node_modules/vitest/vitest.mjs run` | 1 | **2138 passed**, 1 failed, 13 skipped |
| Production build | `node scripts/build.cjs` | **0** | all routes emitted |
| Stale model scan | `node scripts/check-stale-models.mjs` | **0** | 0 runtime matches |
| Migration order | `node scripts/check-migration-order.mjs` | **0** | 50 migrations, none new |
| Dependency audit | `npm audit --audit-level=high` | **0** | **0 vulnerabilities** (was 3 high) |
| Playwright — roles | `--project=audit e2e/roles` | **0** | **73/73** |
| Playwright — journeys | `--project=audit e2e/journeys` (3 specs) | **0** | **23/23** |

### The one Vitest failure is environmental and pre-existing

`tests/failure-matrix.test.ts` DR-010 "exits on its own after SIGTERM" fails because **no Redis
is running on this machine** — the worker cannot shut down cleanly against a closed connection.
Verified by stashing every change on this branch and re-running the test alone against the
unmodified tree: it fails identically. It touches no `lib/ai` file. CI runs a `redis:7` service
container, where it is expected to pass.

### Playwright coverage is partial, and here is which part

`--project=chromium` (the legacy three-spec list) could not run: those specs sign in with demo
accounts this machine's database does not carry, and the fixture guard refuses the published
demo password. `e2e/journeys/telestar-ai-chat.spec.ts` needs real providers. Everything run
above used the run-scoped audit fixture and passed.

## Still BLOCKED_EXTERNAL — not GREEN, not RED

| Item | Blocker |
|---|---|
| CI on the candidate SHA | GitHub Actions refuses to start jobs: *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* Run `32367576357`, all 8 jobs, 0 steps, 3s each. |
| Live 3/3 provider smoke | No provider credentials on this machine |
| Live gateway smoke | Same |
| Chat E2E with providers | Same |
| Docker build | `docker` is not installed here |
| Merge, image, deploy, six-role production acceptance, cost audit against real invoices | All downstream of CI, and CI cannot run |

**None of these may be reported GREEN on the strength of the code being green locally.**

## Known gap carried forward: the Gemini SDK

`lib/ai/providerAdapters.ts` still uses `@google/generative-ai`, not the current
`@google/genai`. The deprecated-parameter half of that problem is fixed — temperature, top_p
and top_k are no longer sent, and `assertNoRejectedParameters` fails the request if they ever
are. What is not fixed is the tool-result round trip: this SDK refuses `role: 'function'`
outright and rejects `user` + `functionResponse` on a missing `thought_signature` it neither
surfaces nor returns, so the adapter feeds tool results back as plain user text. That works,
and it is not the provider's own representation.

Migrating requires live credentials to verify streaming, structured output, tool calls and
thought-signature preservation against the real API. It is recorded in
`MODEL_VERIFICATION.json` under `sdkStatus` with what is and is not verified.

## Next action

Clear the GitHub Actions billing block, then re-run CI **on the current candidate SHA** —
not on `e8600a3`, and not by reusing run `32367576357`. `PRODUCTION_GATE.md` still describes
every step after that.
