---
classification: CURRENT_CANONICAL
note: Master tracker for the Telestar AI 2.0 directive. Progress state lives here.
---

# Telestar AI 2.0 — master tracker

**Directive received** 2026-08-21. **Baseline commit** `4e8145c`. This file is the pinned
progress record: every wave, its state, and the evidence that justifies the state.

A phase is `DONE` only when a command ran and its own exit code was captured. `BLOCKED_EXTERNAL`
and `NOT_TESTED` are not green.

---

## Baseline established at `4e8145c` (2026-08-21)

What was measured, not assumed.

| Check | Command | Result |
|---|---|---|
| TypeScript | `tsc --noEmit` | **exit 0** |
| Production liveness | `curl /api/health` | **HTTP 200**, `commit=daa8ffb`, `schema=ready` |
| Release identity | `EV-RELEASE-IDENTITY.json` | HEALTH_SHA == candidate SHA — chain holds |
| Provider contract | `npm run ai:smoke-providers` | **exit 1 — 0/3 providers**, all HTTP 401 |
| Machine capability | `npm run agent -- doctor` | docker/redis/postgres/playwright present; **gcloud missing** |

### The certificate at HEAD says NO-GO, and two of its blockers are stale

`docs/production-certification/FINAL_CERTIFICATE.md` reports NO-GO on six findings, of which
four are "docker is not installed on this machine". Docker **is** installed now (29.7.2), so
`19-docker-build`, `20-image-inspection` and the rollback drill are no longer externally
blocked — they are simply unrun. `gcloud` is still absent, so DR-007 (RPO) remains genuinely
blocked.

---

## P0 — RESOLVED for two of three providers (2026-08-21 12:30)

**Found** 2026-08-21, during baseline. **Layer C** in the directive's §0.7 taxonomy —
provider authentication.

```
OPENAI_API_KEY: SET   → HTTP 401  "Incorrect API key provided"
GEMINI_API_KEY: SET   → HTTP 401  "invalid authentication credentials"
GROQ_API_KEY:   SET   → HTTP 401  "Invalid API Key"
0/3 providers passed
```

Presence checks pass; every call fails. This is precisely the failure mode
`app/api/ai/status/route.ts` was rewritten to stop mis-reporting as healthy.

**It is not a local edit.** `.env.local` was last written `2026-08-20 14:51`, which is *before*
the recorded 3/3 pass at `2026-08-21 03:49`. Same file, same keys, passing then, rejected now.
Three independent providers do not revoke simultaneously by chance: the keys were rotated or
revoked upstream between those two times.

**Not a leak from this repository.** `.env.local` is gitignored and was never committed.
`git log -S` across all history for `sk-proj-`, `gsk_` and `AIzaSy` returns only placeholders
(`sk-proj-xxxxx`), detection patterns (`startsWith('gsk_')`) and secret-scan test fixtures.

**Consequence.** Every gate that calls a provider cannot run: §0.3 provider smoke, §0.4 gateway
smoke, §0.5 authenticated chat, §0.6 background AI, and the whole of WAVE 2's live evaluation.

**Only the operator can clear it** — new keys must be minted at the three provider consoles.
Work that does not depend on a live provider continues in the meantime.

**Unknown, and it matters:** whether `.env.production` on the VM holds these same keys. If it
does, production Telestar AI is failing right now with the users seeing a generic error. That
cannot be determined from this machine — `gcloud` is absent and there are no production
credentials here.

---

### Resolution

The operator minted new credentials at 12:30. Re-probed, auth-only, against each provider's
model-list endpoint — no SDK, no gateway, no model in the path:

```
OpenAI  HTTP 200      Groq  HTTP 200      Gemini  HTTP 200
```

All three also grant the exact model the registry names (`gpt-5.6-luna`, `gemini-3.6-flash`,
`openai/gpt-oss-20b`). Ambient shadowing was ruled out first: the three variables are unset at
Process, User and Machine scope, so `.env.local` is the only source.

### What the full gates then found

`npm run ai:smoke-providers` — **2/3, exit 1**

| Provider | Result | Detail |
|---|---|---|
| openai | **PASS** | completion, streaming, tools, structured — 7.7 s |
| google | **PASS** | completion, streaming, tools, structured — 7.5 s |
| groq | **FAIL** | `413` TPM: limit 8000, requested 8268 |

`npm run ai:smoke-gateway` — **13/14, exit 1**. The one failure is the gate being honest:
`gateway generate via Groq` reports `attribution mismatch: asked for openai/gpt-oss-20b,
answered by gpt-5.6-luna` — Groq rate-limited, the gateway failed over to OpenAI, and the
smoke refused to count someone else's answer as Groq's. Failover itself is proven working in
all three directions, including `OpenAI + Gemini unavailable -> Groq answers` in 550 ms,
genuinely from Groq.

### Groq: a tier limit, not a defect — and a correction

Groq bills `prompt + max_tokens` against tokens-per-minute. The key is on the free/on-demand
tier at 8,000 TPM. The provider smoke sends the registry's `defaultMaxOutputTokens: 8192`,
which exceeds the ceiling on its own, before a single prompt token.

**A claim made earlier in this initiative was wrong and is withdrawn**: that every default Groq
call would 413 in production. It would not. Every production call site caps output explicitly —
`chatRuntime.ts:136` sends `maxTokens: 1200`, `lib/ai/generation.ts:129` sends
`input.maxOutputTokens ?? 1200`, `app/api/ai/onboarding/route.ts:113` sends `130`. Nothing in
production relies on the 8192 default; only the smoke does. Interactive chat fits inside the
free tier.

Two facts survive that correction, and both matter:

1. The smoke exercises an output budget **no production caller uses**. A gate that tests an
   unused path is weaker than it looks. Worth fixing on its own merits, with its own proof —
   not while it is red, and not as a way to turn it green.
2. 8,000 TPM cannot carry fallback traffic. Groq is the third fallback: it is reached precisely
   when OpenAI and Gemini are both failing and the entire tenant's load concentrates on it. A
   fallback that rate-limits under exactly the conditions it exists for is not a fallback.

**Operator decision taken: upgrade Groq to Dev Tier.** No code change, restores the
three-provider contract, and gives the fallback real headroom.

### Observed live, previously only theorised

The Redis boot-window defect recorded as a P1 finding in the fast-track plan is real and
reproduced on every gateway smoke run:

```
[ai-circuit] failed to clear shared circuit state: Stream isn't writeable and enableOfflineQueue options is false
[ai-circuit] failed to read shared circuit state:  Stream isn't writeable and enableOfflineQueue options is false
```

`lib/bullmq/connection.ts` builds the client with `lazyConnect: true` and
`enableOfflineQueue: false`, so commands issued before the connection settles fail outright. A
short-lived CLI process may never reach Redis at all — which means the shared circuit state a
gate reads is `{}` and the state it writes is silently dropped. R3: it changes worker and queue
behaviour, so it needs its own proof rather than an opportunistic edit.

---

## P1 — 37% of `lib/ai/` is unreachable from production

Every module below has exactly **one** importer, and in every case that importer is its own
test. Nothing in `app/`, `components/`, `workers/` or the chat runtime reaches any of them.

```
roleCopilots  commercialMemory  whyNowEngine  campaignAutopsy  campaignDigitalTwin
zeroAdminEngine  winningPatternEngine  scenarioSimulator  playbookEvolution
experimentLab  decisionLedger  relationshipGraph  proactiveSignals  leadSupplyEngine
meetingQualityEngine  deliveryGuardian  aiMissions
```

Verified by exhaustive grep across `.ts`/`.tsx`, not by import-path guessing.

**1,445 lines of unreachable production code, guarded by 26 tests across 635 lines of test
code.** Those 26 tests pass, and they counted toward the 2,340 in the current certificate.

This is worse than the directive assumed. The directive asks to "replace prototype intelligence
with real CRM-derived intelligence" — but this prototype intelligence is not *serving* anything.
Its tests pass, and those passes were counted toward "114/114 AI evals & capability tests
passing" in an earlier certificate. Green tests over unreachable code are a confidence defect.

Two concrete instances of what the code does:

- `lib/ai/commercialMemory.ts:41` — `private claims = new Map<string, CommercialClaim>()`.
  Process-local, lost on restart, invisible to the worker. Exactly what §6 forbids.
- `lib/ai/roleCopilots.ts` — returns template strings. `whyThisContact` is
  `` `Matches target executive persona as ${title} at ${company}.` `` — no CRM read, no
  evidence, no inference. It cannot be wrong because it never consults anything.

---

### The full measurement

The first pass counted seventeen modules by grepping for importers. A transitive reachability
walk — start at every `@/lib/ai/*` import made by `app/`, `components/`, `workers/`, `hooks/`,
`context/` and the rest of `lib/`, then follow imports — gives the real number.

```
entry points reached from production code: 15
REACHABLE   modules: 21   (5,744 loc)
UNREACHABLE modules: 35   (3,358 loc)
```

**35 of 56 modules. 3,358 of 9,102 lines.** Not merely uncalled by the chat runtime: unreachable
from any production entry point in the application.

Three of those are worse than the rest, because of what they are:

| Module | loc | Why it matters |
|---|---:|---|
| `lib/ai/engine/security-guards` | 50 | prompt-injection detection and secret scrubbing — **not wired to anything** |
| `lib/ai/securityGuards` | 39 | a *second*, separate security-guard module, also unreachable |
| `lib/ai/engine/tool-registry` | 85 | a *second* tool registry; the live one is `lib/ai/tools.ts` |

Two security-guard modules and two tool registries, one of each dead. A reader auditing this
codebase for "is prompt injection handled" finds a module that handles it, and no way to learn
it is never called.

### The evaluation suite could not fail

`tests/telestar-ai-certification-evals.test.ts` had two tests:

- The first called `classifyIntent(scenario.userMessage)` and asserted `toBeDefined()`.
  `classifyIntent` returns a non-nullable object, so this passed for every input including an
  empty string. `expectedIntent` — declared on every scenario — was never read.
- The second ran `scrubSecrets` over the **user's own message** and asserted the result did not
  contain `postgresql://`. The message never contained it.

Rewritten to assert what the dataset declares. It went red immediately, and found two real
defects rather than test-only problems:

1. **`scrubSecrets` does not redact AI provider keys.** `SECRET_PATTERNS` covers `tl_live_`,
   Postgres URLs, bearer JWTs and `ghp_`. It misses `sk-proj-` (OpenAI), `AIzaSy` (Google) and
   `gsk_` (Groq) — the three credential formats this system actually holds.
2. **The intent classifier disagrees with the dataset on 3 of 4 scenarios.** "Who should I
   contact next?" classifies as `LOOKUP`, not `PRIORITIZE`; so does its Vietnamese equivalent.
   A third scenario declared `EXECUTIVE`, which is not a member of `AiIntent` at all — it is a
   `requiredDepth` value. `expectedIntent` was typed `string`, so nothing caught it.

Both defects sit in unreachable modules, which bounds their production impact to zero today and
makes them certain to bite whenever the modules are wired.

---

## WAVE 5 (partial) + security — the unreachable layer is gone

**Decision taken by the operator:** wire the security guard, delete the rest.

### Security wired, and taught our own credential formats — `ca44fa2`

`lib/ai/engine/security-guards.ts` is now imported by `lib/ai/chatRuntime.ts` and applied to
every tool result before it returns to the model. Tool results are CRM content — lead notes,
imported fields, prospect email bodies, provider error strings — all untrusted by
`AGENTS.md`'s definition.

`SECRET_PATTERNS` gained the three provider formats it was missing (`sk-proj-`, `AIza`, `gsk_`)
plus Redis/Mongo URLs with passwords, AWS key ids, Slack tokens, GitHub PATs and bare JWTs.
`lib/ai/securityGuards.ts` — a second guard module with a different opinion — was merged in and
deleted.

**Not done, and stated rather than implied:** the model's streamed answer is not scrubbed.
Chunk boundaries can split a credential in half, so a per-chunk scrub would miss it while
implying a protection that does not exist. That needs a windowed scrubber and its own proof.

### 34 modules deleted, 3,308 lines

Every module unreachable from a production entry point, except `lib/ai/evals/golden-dataset.ts`
which is a test dataset by design. With them went 8 test files whose subject no longer exists.

Two deletions are worth naming because they were counted as coverage:

- `lib/ai/actions.ts:generateToolIdempotencyKey` — a parallel idempotency-key implementation
  that nothing called, tested under the heading "Phase 1: Durable Tool Idempotency Keys". The
  key production actually uses is built in `chatRuntime.ts` from a per-turn ordinal, and is
  asserted against its real format in `tests/agent-runtime-integration.test.ts:158`. "Write
  idempotency" is a line on the required certificate; it was being evidenced by the wrong
  function.
- `lib/ai/engine/autonomy-matrix.ts` — tested with "refuses critical mutations to SDRs without
  management authority". Real autonomy and object authorization live in the CRM domain services
  and are covered by `agent-capability-autonomy`, `agent-object-authorization` and
  `work-order-approvals`.

### The evaluation suite now asserts things

Rebuilt `lib/ai/evals/golden-dataset.ts`: 8 families, all six roles, 47 scenarios, no
duplicates written to inflate a count. `expectedIntent` was removed — the classifier it named is
deleted, and the suite's rule is that a field nobody asserts does not stay.

One test in the rewritten suite was wrong and is recorded as such: it asserted that a
scenario's `forbiddenClaims` do not appear in the **user's own message**, which they always do,
since the phrase is drawn from the request. `forbiddenClaims` constrains a *model answer* and
cannot be checked without a model. It is now structurally validated here and left to the
live-model suite to assert semantically.

**Adversarial scope, stated honestly.** The `SECURITY` family is regression protection for a
pattern matcher, not a red team. A pattern matcher cannot catch a semantically phrased
injection, and encoding such cases here would only record a permanent failure. Real adversarial
coverage needs a model in the loop — WAVE 10.

### Evidence

`tsc --noEmit` **exit 0**, captured from the tool. ESLint **exit 0** (11 pre-existing warnings,
all in `prisma/seed-demo.ts`). `check-test-discipline` **exit 0**.

---

## OPEN P1 — the assistant does not mount under `next dev`

`e2e/journeys/telestar-ai-chat.spec.ts` fails **20 of 30** locally. Two distinct problems were
found; one is fixed, one is not.

### Fixed — an ambiguous locator (worth 1 test)

`openChat` located the trigger with `getByRole('button', { name: /^Open / })`. Under `next dev`,
Next.js 16 renders its own **"Open Next.js Dev Tools"** button, and a probe confirmed the
locator was resolving to it:

```
PROBE: trigger matches = 1
PROBE: trigger label   = Open Next.js Dev Tools
```

Narrowed to `/^Open (?!Next\.js)/` in the helper and the two other call sites. Real, but it
moved the result only from 21 failures to 20 — which is how the second problem surfaced.

### Not fixed — the component is absent, and every guard says it should be present

With the locator corrected, the failure is `element(s) not found`: the assistant's trigger is
genuinely not in the DOM. `components/AiAssistant.tsx` returns `null` on four conditions, and
all four were measured from the browser as satisfied:

```
PROBE: viewport      = {"innerWidth":1440,"matches1024":true,"pathname":"/"}
PROBE: session status= 200
PROBE: session body  = {"user":{"id":"cmt2i…","role":"sdr","tenantId":"pw-audit-tenant-a"}…}
PROBE: buttons       = […,"Open Next.js Dev Tools"]     ← no assistant trigger
```

So `pathname !== '/login'`, `isDesktop` is true, and `currentUserId` is populated. The component
is mounted through `components/ClientLayoutAddons.tsx` as
`dynamic(() => import('@/components/AiAssistant'), { ssr: false })`, correctly nested inside
`SessionProvider` → `AppProvider`. It simply never appears.

Two theories were tested and **both were wrong**, recorded so they are not retried:

- *CSP blocking `eval`.* The dev log carries `[csp-report] directive=script-src blocked=eval`,
  and `next dev` needs `eval` for its chunks. But `lib/security/csp.ts` sets
  `CSP_HEADER_NAME = 'Content-Security-Policy-Report-Only'` — report-only enforces nothing.
- *`isSessionLoading` unmounting the panel.* Disproved by rerun, and the speculative guard
  change was reverted.

### The experiment that decides whether this is a product defect

CI runs the Playwright gate against a **production build**, not `next dev`, and the current
certification's six-role browser acceptance passed 6/6 with zero console errors against a built
image. Production is serving `daa8ffb` with `/api/health` 200. So the open question is narrow:
does the assistant mount in a production build?

`npm run build` then the same spec against `next start` answers it. Until that runs, the honest
statement is: **the chat journeys fail under `next dev` on this machine, and no evidence yet
shows the shipped product is affected.**

---

## WAVE 4 (in progress) — persistent commercial memory

The prototype this replaces held claims in `new Map<string, CommercialClaim>()` in one process:
empty after every deploy, invisible to the worker, different in each web container, and
unreachable from production so none of it was ever felt. It was deleted in `5d46eaa`.

**Schema** — `CommercialClaim` in `prisma/schema.prisma`, migration
`20260821000000_commercial_claim`. `npm run check:migration-order` reports 51 migrations, 1
new, exit 0. `prisma validate` exit 0.

The model encodes the rules rather than describing them:

| Rule | How it is held |
|---|---|
| Inference is never fact | `claimType` is stored, and a `FACTUAL` claim without `sourceType` is refused at the write |
| Inference carries strength | `INFERRED` requires `confidence` in [0, 1] |
| Correction is not mutation | `supersedesId` + status `superseded`; the wrong belief keeps its text |
| AI memory decays faster | default TTL 30 days for `INFERRED` against 365 for `FACTUAL` |
| Tenancy | `tenantId` on every row and every query; the Prisma extension derives tenant-owned models from the DMMF, so the new table is enforced without registration |

**Service** — `lib/memory/claims.ts`, placed outside `lib/ai/` because `.claude/rules/ai.md`
holds the line that nothing under `lib/ai/` touches a CRM table directly.

**Tests** — `tests/commercial-claims.test.ts`, 14 cases including the two tenancy ones that
matter: a read never returns another tenant's claims, and a correction by id across a tenant
boundary is refused with the same "not found" message used for a genuinely absent claim,
because the difference is itself information about another tenant.

**Not yet run.** The Prisma client needs regenerating and the query engine is held by the
running browser suite. Nothing here is claimed as passing.

---

## Wave status

| Wave | Scope | State |
|---|---|---|
| 1 | Production AI recovery · deployment gating · provider + gateway certification · observability baseline | **IN PROGRESS** — deployment gating **DONE** (`4c50c06`); live certification blocked on P0 |
| 2 | EvalLab foundation · golden dataset · failure cases | NOT STARTED |
| 3 | Context Compiler · context authorization · budgeting | NOT STARTED |
| 4 | Persistent Commercial Memory · provenance · correction/freshness | NOT STARTED |
| 5 | Six real role copilots · remove hard-coded intelligence | NOT STARTED |
| 6 | Tool Design 2.0 · action pipeline · idempotency · approval integrity | NOT STARTED |
| 7 | Model Routing 2.0 · model lifecycle · shadow eval · cost intelligence | NOT STARTED |
| 8 | Proactive intelligence · role alerts | NOT STARTED |
| 9 | AI Control Plane · flight recorder · incident workflow | NOT STARTED |
| 10 | Red team · six-role browser acceptance · failover drills · certification | NOT STARTED |

## Phase 1 — deployment AI gate — DONE, `4c50c06`

`scripts/deploy.sh` could print "Successfully deployed" with Telestar AI entirely unable to
answer. Nothing in the deploy path or in either CI workflow ever made a provider call, so the
only signal was a user reporting a generic error sentence. Five gates now run, in failure-chain
order, each through one `ai_gate` helper that calls `fail` on a non-zero exit:

| Gate | Proves | Runs |
|---|---|---|
| `env-contract` | all three keys declared, no placeholders | inside the new image, **before** the backup prompt |
| `container-secrets` | web *and* worker received them | after the container swap |
| `provider-smoke-web` | a real completion from each provider | inside `web` |
| `provider-smoke-worker` | the same from the worker process | inside `worker` |
| `gateway-smoke` | routing, parameters, streaming, three-way failover | inside `web` |

All five precede the existing application smoke. The immutable deployment record now carries
per-gate outcomes as `aiGates`. There is deliberately no skip flag.

Also fixed: `verify-container-secrets.sh` hard-coded a bare `docker compose` while `deploy.sh`
drives `sudo docker` — on the VM that failed with a permission error indistinguishable from a
missing credential.

**Evidence.** `tests/ai-release-gate.test.ts` 12/12, exit 0. `bash -n` clean on both scripts.
The helper was executed against a failing command: it exits 1 and the following line never
runs. Both the `python3` and `node` record writers emit identical `aiGates` objects.
`check-test-discipline` exit 0; ESLint exit 0.

**Not done here.** CI does not make provider calls on every push — that needs provider secrets
in GitHub Actions and spends money per commit. The deploy-time gate is where the directive
places the chain, and that is where it now is. Adding a CI-side live gate is an operator call.

**Already fixed before this directive, confirmed not a gap:** `docker-image.yml` gates on the
`CI required checks` job's own conclusion rather than the CI workflow conclusion, so CodeQL
being unavailable on this plan no longer blocks image publication.

---

## Open questions for the operator

1. **Provider keys** — three new keys are needed before any live AI gate can run.
2. **Production reach** — is production expected to be verified from this machine? It needs
   either `gcloud` installed and authorised, or a production session credential. Today neither
   exists here, so §0.5 and §0.6 cannot be executed at all.
