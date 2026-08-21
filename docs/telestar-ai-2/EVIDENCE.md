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
| Unit + integration | `vitest run` | **2337 / 2338**, then **exit 0** after routing registration |
| Commercial memory | `vitest run tests/commercial-claims.test.ts` | **14 / 14, exit 0** |
| Release gate tests | `vitest run tests/ai-release-gate.test.ts` | **12 / 12, exit 0** |
| Provider auth | `curl` model-list per provider | **3 / 3 — HTTP 200** |
| Provider contract | `npm run ai:smoke-providers` | **2 / 3, exit 1** — Groq TPM, see §3 |
| Gateway | `npm run ai:smoke-gateway` | **13 / 14, exit 1** — same cause |
| Degraded provider drill | `scripts/ai-degraded-provider-drill.ts` | **7 / 7, exit 0** |
| Chat journeys, `next dev` | Playwright, `--project=audit` | **10 / 30** |
| **Chat journeys, production build** | Playwright against `next start` | **30 / 30, exit 0** |
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

**`ai:smoke-providers` is 2/3 and `ai:smoke-gateway` 13/14.** Groq's account tier caps tokens
per minute at 8,000; the smoke sends the registry's `defaultMaxOutputTokens: 8192`. No
production caller sends that — chat sends 1200, `generation.ts` 1200, onboarding 130 — and the
degraded-provider drill answered four consecutive fast-tier calls **from Groq** in ~500 ms each.
So the product is unaffected and the gate is asserting against a path the product does not
exercise. Making it representative is a real improvement and is deliberately **not** done:
editing a release gate while it is red is the pattern the directive warns against, and the
operator's decision was to upgrade the tier.

**The deployment gate currently blocks deploys.** That is the gate working, and it is a live
constraint until Groq's tier is raised or the gate is made representative.

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
