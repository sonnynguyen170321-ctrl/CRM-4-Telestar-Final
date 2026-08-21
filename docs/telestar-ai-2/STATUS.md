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

## P0 — LIVE: all three provider credentials are rejected

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

## P1 — Seventeen "intelligence" modules are dead code

Every module below has exactly **one** importer, and in every case that importer is its own
test. Nothing in `app/`, `components/`, `workers/` or the chat runtime reaches any of them.

```
roleCopilots  commercialMemory  whyNowEngine  campaignAutopsy  campaignDigitalTwin
zeroAdminEngine  winningPatternEngine  scenarioSimulator  playbookEvolution
experimentLab  decisionLedger  relationshipGraph  proactiveSignals  leadSupplyEngine
meetingQualityEngine  deliveryGuardian  aiMissions
```

Verified by exhaustive grep across `.ts`/`.tsx`, not by import-path guessing.

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
