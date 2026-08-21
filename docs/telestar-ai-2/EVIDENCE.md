---
classification: CURRENT_CANONICAL
note: Command-level evidence for the Telestar AI 2.0 initiative. Every row is a command that ran.
---

# Telestar AI 2.0 — evidence

Every figure here came from a command whose **own** exit code was captured, never a pipe's.
Where something was not done, this document says so rather than omitting it.

**Branch** `feat/telestar-ai-2` · **base** `4e8145c` · **date** 2026-08-21

---

## 1. Gates run

| Gate | Command | Result |
|---|---|---|
| TypeScript | `tsc --noEmit` | **exit 0** |
| ESLint | `eslint .` | **exit 0** — 11 warnings, all pre-existing in `prisma/seed-demo.ts` |
| Test discipline | `node scripts/check-test-discipline.mjs` | **exit 0** — 7 allowlisted exemptions |
| Migration order | `node scripts/check-migration-order.mjs` | **exit 0** — 51 migrations, 1 new |
| Prisma schema | `prisma validate` | **exit 0** |
| Production build | `npm run build` | **exit 0** — compiled in 79 s |
| Unit + integration | `vitest run` | **2387 / 2387, exit 0** — 175/175 files, after waves 3, 5, 6, 7 and 9 |
| Commercial memory | `vitest run tests/commercial-claims.test.ts` | **17 / 17, exit 0** — includes the writer’s object-authorization cases |
| Release gate tests | `vitest run tests/ai-release-gate.test.ts` | **12 / 12, exit 0** |
| Provider auth | `curl` model-list per provider | **3 / 3 — HTTP 200** |
| Provider contract | `npm run ai:smoke-providers` | **3 / 3, exit 0** — after the gate stopped over-asking |
| Gateway | `npm run ai:smoke-gateway` | **14 / 14, exit 0** on the third of three runs; the two earlier runs lost different checks to transient OpenAI/Gemini weather |
| Degraded provider drill | `scripts/ai-degraded-provider-drill.ts` | **7 / 7, exit 0** |
| Chat journeys, `next dev` | Playwright, `--project=audit` | **10 / 30** |
| **Chat journeys, production build** | Playwright against `next start` | **30 / 30, exit 0** |
| **Six-role browser acceptance** (§24) | Playwright `--project=certification-roles` against `next start` | **15 passed, exit 0** |
| Chat route contract | `vitest run tests/ai-chat-route.test.ts` | **42 / 42, exit 0** |
| Production liveness | `curl https://crm.telestar.cloud/api/health` | **HTTP 200**, `commit=daa8ffb`, `schema=ready` |

### Two failures investigated, both environmental

- `tests/import-load-benchmark.test.ts` failed in the full run and passes **3/3, exit 0** in
  isolation — the load flakiness its own documentation describes.
- `tests/agent-check.test.ts` and later `tests/agent-routing.test.ts` failed because this work
  changed the tree: deleting modules invalidated `.agent/generated/`, and `lib/memory/` was
  unmapped in the domain registry. Both are the drift detection working. Regenerated and
  registered; **35/35, exit 0**.

---

## 2. What the gates found that was real

### The credentials were all revoked (Layer C)

Presence checks passed, every call returned 401, on all three providers. `.env.local` was last
written *before* the recorded 3/3 pass, so the keys were revoked upstream rather than edited.
The operator minted new ones; auth probes returned 200/200/200 and each key grants the exact
model the registry names.

This is the failure mode `app/api/ai/status/route.ts` was rewritten to stop mis-reporting, and
it is the reason the deployment gate below makes real calls rather than checking presence.

### 37% of `lib/ai` was unreachable from production

A transitive reachability walk from every production entry point found **35 of 56 modules**
unreachable — 3,358 of 9,102 lines. Their tests passed and counted toward the certificate's
2,340. Three were worse than the rest: `lib/ai/engine/security-guards` (prompt injection and
secret scrubbing, wired to nothing), `lib/ai/securityGuards` (a *second* guard module), and
`lib/ai/engine/tool-registry` (a second tool registry).

`lib/ai/actions.ts:generateToolIdempotencyKey` had a describe block titled "Phase 1: Durable
Tool Idempotency Keys" and no caller. "Write idempotency" is a required certificate line; it
was being evidenced by a function production never ran. The real key is built in `chatRuntime`
from a per-turn ordinal and is asserted in `tests/agent-runtime-integration.test.ts:158`.

### Guards added, and proven able to fail

Three of the defects this initiative found were tests that could not fail. Anything added since
has been checked the same way it criticised:

| Guard | Proven how |
|---|---|
| `tests/ai-model-evidence.test.ts` | one context limit perturbed in the evidence file → red; reverted → green |
| `tests/ai-output-budget.test.ts` | scans real call sites; would fail on any uncapped `aiGateway` call |
| `tests/ai-role-policy.test.ts` | checked against `.agent/generated/role-map.json`, and it **did** fail on the constitution's invented "Admin" role before that was fixed |
| `tests/ai-claim-label.test.ts` | asserts the poisoning case directly — an AI-written FACTUAL claim must not read as factual |

### After the deletion

The same reachability walk, re-run on the current tree:

```
REACHABLE   modules: 22   (5,877 loc)
UNREACHABLE modules:  1   (551 loc)
```

The single remaining unreachable module is `lib/ai/evals/golden-dataset.ts`, which is a test
dataset and is not supposed to have a production caller.

### The evaluation suite could not fail

Two tests: one asserted `classifyIntent(...)` was `toBeDefined()` — it returns a non-nullable
object, so it passed for any input including an empty string. The other ran `scrubSecrets` over
the *user's own message* and asserted the result lacked `postgresql://`, which it never
contained. Rewritten to assert what the dataset declares, it went red immediately and found two
real defects: the scrubber matched **none** of the three provider key formats this deployment
holds, and the intent classifier disagreed with the dataset on 3 of 4 scenarios including one
expectation (`EXECUTIVE`) that is not a member of `AiIntent`.

### Nothing in the deploy path ever called a provider

`scripts/deploy.sh` could print "Successfully deployed" with Telestar AI entirely unable to
answer, and neither CI workflow made a provider call. Five gates now run before the deployment
is recorded, each aborting on failure, with no skip flag.

---

## 3. Known gaps, stated rather than omitted

**Resolved: the gates were over-asking, and Groq was never the problem.** They sent
`parameters.defaultMaxOutputTokens` (8192), which no production caller sends — chat 1200,
`generation.ts` 1200, onboarding 130. Groq's tier caps tokens-per-minute at 8,000, so the gates
failed on a request no user could produce. Both now import `CHAT_OUTPUT_BUDGET_TOKENS` from the
registry, as does the runtime, so gate and product cannot drift again.

The budget had drifted twice, in opposite directions, both times because the gate picked its own
number: 32, which truncated a reasoning model mid-thought and returned empty; then 8192, on the
reasoning that the registry grants it. What 8192 was *incidentally* protecting — that no caller
silently falls back to the default — is now asserted directly by `tests/ai-output-budget.test.ts`,
which scans every production gateway call site and can fail for the right reason.

Result: `ai:smoke-providers` **3/3 exit 0**, with Groq passing completion, streaming, tools and
structured output and reporting `actual=openai/gpt-oss-20b`. `ai:smoke-gateway` **14/14 exit 0**.

**The gateway smoke is sensitive to transient provider weather.** Three consecutive runs gave
12/14, 13/14, 14/14, and a different check failed each time — always by *failing over* rather
than erroring, which is the gate refusing to count another model's answer as the requested one.
All nine Groq checks passed in every run. For a release gate that sensitivity is arguably
correct: shipping while a provider is flapping is a decision, not a default. It does mean a red
run deserves a re-run before it is believed.

**The chat suite fails under `next dev`.** Same code passes 30/30 built. The assistant is
mounted with `dynamic(..., { ssr: false })` and does not appear under Turbopack dev while all
four of its render guards measure as satisfied. Costs local developers a chatbox; costs
production nothing. Not root-caused.

**Production was never exercised from this machine.** `gcloud` is not installed and there are no
production credentials here, so directive §0.5 and §0.6 were run against a local production
build, not against `crm.telestar.cloud`. The only production fact established is that
`/api/health` returns 200 on `daa8ffb`.

**The Redis boot window drops the first commands of every process.** Reproduced on every gateway
smoke run: `[ai-circuit] failed to read shared circuit state: Stream isn't writeable`. It means
a short-lived CLI reads `{}` for shared circuit state and silently drops its writes. R3, needs
its own proof, not fixed here.

**Something in the local toolchain rewrote the Node version pins mid-session.** The tree was
clean at `4e8145c`. By the end, `.nvmrc`, `.node-version`, `package.json` `engines`,
`package-lock.json` and all three `Dockerfile` stages had been changed from `24.18.0` to
`24.16.0` — this machine's Node version. Committing that would have downgraded the production
base image to match a developer laptop.

Reverted; the tree is clean and the Dockerfile is back on `24.18.0`. The writer was **not**
identified: `scripts/doctor-core.mjs` only evaluates the pins and errors when they diverge, and
nothing else under `scripts/` writes them. Worth finding, because a command that silently
rewrites a release pin is a supply-chain footgun regardless of which one it is.

**No live-model evaluation exists.** The `SECURITY` family is regression protection for a
pattern matcher, not a red team — a matcher cannot catch a semantically phrased injection, and
encoding such cases would record a permanent failure. That needs a model in the loop.

---

## 4. Corrections issued during this work

Recorded because the reasoning matters more than the conclusions.

| Claim | Correction |
|---|---|
| "Every default Groq call 413s in production" | False. Every production call site caps output explicitly; only the smoke sends 8192. |
| "tsc clean — the drill compiles" | The background notification's exit 0 was the shell pipeline's, not tsc's. The drill did **not** compile; four errors were fixed. |
| "The chat failure is role-dependent" | The spec iterates four roles and has no leadgen case. All role tests failed. |
| "`isSessionLoading` unmounts the assistant" | Disproved by rerun; the fix was reverted rather than left unverifiable. |
| "Clicking the assistant signs the user out" | An artefact of a probe that omitted `storageState` and ran signed out. |
| "CSP blocks `eval`, breaking dynamic imports" | The header is `Content-Security-Policy-Report-Only`, which enforces nothing. |
