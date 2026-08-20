---
classification: CURRENT_CANONICAL
note: Live handoff for the AI remediation branch.
---

# RESUME HERE — Telestar AI remediation

**Written 2026-08-20. Read this first, on any machine, before touching `lib/ai/` or the deploy
pipeline.** It is deliberately self-contained: nothing here depends on a previous session's
memory, a local scratch file, or a particular computer.

---

## One-line status

The chat defect is **fixed and proven locally**. Nothing is deployed. Certification is
**NOT GREEN**, and it is blocked on three things that need a human, not on the code.

| | |
|---|---|
| Branch | `fix/telestar-ai-three-provider` |
| Head commit | `b1a2a9e` |
| PR | [#98](https://github.com/sonnynguyen170321-ctrl/CRM-4-Telestar-Final/pull/98) — **open**, 7 commits |
| `main` | untouched, still `90037f9` |
| Production `crm.telestar.cloud` | still `9ba27b8` — **the broken build** |

---

## What was wrong, in one paragraph

Every Telestar AI message in production returned *"Sorry, I ran into a problem generating
that."* Underneath it was a Groq **404**: `DEFAULT_MODEL` was `llama-3.3-70b-versatile`, which
Groq withdrew. `lib/ai/provider.ts` sent it, and `shouldFallbackToGemini` only failed over on a
**rate limit**, so a 404 rethrew into the route's generic catch. Every Groq model the picker
offered was dead, so no model choice recovered it. Ten further defects were found in the same
sweep — full list in [`STATUS.md`](./STATUS.md).

## What the fix is

One gateway (`lib/ai/gateway.ts`), three models, `internalAlias === modelId` as an asserted
invariant. `lib/ai/provider.ts` and `lib/ai/providerRouting.ts` are **deleted — do not
reintroduce a second router under any name.** Architecture detail is in `CLAUDE.md` under
*"Telestar AI — three providers, one gateway"*.

---

## Verified locally (all exit codes captured from the tool, never a pipe)

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `eslint .` | 0 (9 pre-existing warnings) |
| `vitest run` | 0 — **2118/2118**, 167 files |
| `node scripts/build.cjs` | 0 |
| `npm run check:stale-models` | 0 |
| `npm run ai:smoke-providers` | 0 — 3/3 real providers |
| `npm run ai:smoke-gateway` | 0 — 14/14 incl. failover all three directions |
| Chat E2E, real browser + real providers | **30/30** |
| `scripts/verify-ai-attribution.ts` | 0 — 80 chat rows, all `ok`, all `gpt-5.6-luna` |

---

## THE THREE BLOCKERS

### 1. GitHub Actions billing — hard stop, nothing moves past this

The CI run at 2026-08-20 12:07 produced eight jobs that all died in ~3 seconds:

> The job was not started because recent account payments have failed or your spending limit
> needs to be increased.

**Action:** GitHub → Settings → Billing & plans. No CI, no image, no deploy until this clears.

### 2. CI has never been green on this repository

`CodeQL` fails every run with *"Code scanning is not enabled for this repository"* — it needs
GitHub Advanced Security, which a private repo on this plan does not have. `Dependency review`
fails for the same reason. GitHub computes a workflow's conclusion from **every** job, so CI
concludes `failure` every time, and `docker-image.yml` — which gates on
`workflow_run.conclusion == 'success'` — has been **skipped on every commit**. The image
production runs today exists only because someone manually ran `workflow_dispatch`.

**The fix, not yet applied:** gate publishing on CI's own `ci-required` job instead of the
workflow conclusion. `ci-required` already states exactly which results are acceptable — it
demands `success` from quality, migrations, e2e, docker and secret-scan, and already tolerates
`codeql` being unavailable. Gating on it loosens nothing.

> Editing `.github/workflows/` was refused by the permission classifier in the session that
> found this. It needs the operator to allow the workflow edit, or to apply it by hand.

**Interim workaround** (what has been done before): after CI, manually run the *Docker Image*
workflow via `workflow_dispatch` on the merge commit.

### 3. The VM is not reachable from a dev machine, and needs keys first

- No `gcloud` CLI on the machine this was done from. There is an SSH key at
  `~/.ssh/google_compute_engine`.
- `scripts/deploy.sh` prompts interactively for a **Cloud SQL backup ID**; operating
  restrictions require a backup before every deploy.
- **`.env.production` on the VM must define `OPENAI_API_KEY`, `GEMINI_API_KEY` and
  `GROQ_API_KEY` before deploying.** `scripts/prod-check-env.ts` now *requires* all three and
  will fail without them. They must also reach the **worker**, not just `web` — a worker
  without them fails every background AI job while the chatbox looks perfectly healthy.
  Verify with `scripts/verify-container-secrets.sh` (reports SET / NOT SET only, never a key).

---

## The remaining path, in order

1. Clear the Actions billing (blocker 1).
2. Re-run CI on PR #98. Expect `Lint · types · tests`, `Docker build`, `Migration validation`,
   `Secret scan` and `Build · Playwright` to pass; `CodeQL` and `Dependency review` will still
   fail for the environmental reason above.
3. Apply the `docker-image.yml` gate fix (blocker 2) — or plan to dispatch the image manually.
4. Merge PR #98 to `main`. **No schema changes in this branch** — `git diff main...HEAD --
   prisma/` is empty, so there is no migration to worry about.
5. Confirm the three provider keys are in `.env.production` on the VM.
6. Deploy: `./scripts/deploy.sh <merge-sha>` from the deployment root on the VM.
7. Run the post-deploy gate: [`PRODUCTION_GATE.md`](./PRODUCTION_GATE.md), all six steps.

Step 7 is what turns certification green. In particular:

```bash
BASE_URL=https://crm.telestar.cloud E2E_PASSWORD='<run-scoped>' TELESTAR_AI_E2E=1 \
  node node_modules/@playwright/test/cli.js test --project=audit \
  e2e/journeys/telestar-ai-chat.spec.ts
```

Expect **30 passed**. `TELESTAR_AI_E2E=1` is mandatory — without it the sixteen
provider-dependent tests skip themselves and the run is green while proving nothing. Any
`skipped` count above zero means the flag did not reach the run.

---

## Traps that will cost an hour if forgotten

- **Postgres and Redis run as Docker containers here** (`telestar-pg`, `telestar-redis`), not
  as the Windows service `postgresql-x64-16` that older docs describe. `docker ps` to check.
- **`prisma generate` EPERM on Windows is a file lock**, not a Prisma bug. A live `next start`
  or a hung `tsx` holds `query_engine-windows.dll.node`. Find the holder with
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*CRM-4-Telestar-Final*' }`
  and stop it.
- **`tests/import-load-benchmark.test.ts` fails under load.** It timed out at 45s during a full
  Vitest run held concurrently with the browser suite, and passes 3/3 alone. Re-run it in
  isolation before believing a failure there.
- **Gemini takes no caller-supplied output cap.** It spends output budget on reasoning before
  emitting a character, so a 64-token ceiling produces an empty response.
- **Gemini tool results must be replayed as plain user text.** Role `'function'` is rejected
  outright, and a `functionResponse` part needs a `thought_signature` the SDK does not
  round-trip.
- **`gpt-5.6-luna` rejects `max_tokens`, rejects any non-default `temperature`, and refuses
  function tools without `reasoning_effort: 'none'`.** All three are in
  `ModelMetadata.parameters`; read them there rather than rediscovering them.

---

## Files worth opening first

| Path | Why |
|---|---|
| `docs/telestar-ai-remediation/STATUS.md` | full root-cause account, all 11 defects, gate run |
| `docs/telestar-ai-remediation/PRODUCTION_GATE.md` | the six post-deploy steps |
| `lib/ai/gateway.ts` | the only module that constructs a provider client |
| `lib/ai/registry.ts` | the three approved models and their parameter contracts |
| `lib/ai/chatRuntime.ts` | the chat turn and its tool authorization |
| `e2e/journeys/telestar-ai-chat.spec.ts` | the gate that would have caught the original defect |
