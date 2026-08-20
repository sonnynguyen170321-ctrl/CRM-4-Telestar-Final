# Telestar AI — production verification gate

Everything here runs **after** the branch is deployed. Nothing in this document was run
against production by the remediation itself: `https://crm.telestar.cloud` is serving commit
`9ba27b8`, which predates the fix, and deploying to a live system carrying real users is not
something to do unattended.

Run these in order. Every step reports its own exit code; none of them is a pipe.

---

## 0. Before deploying

```bash
# The three provider credentials must be present in .env.production ON THE VM.
docker compose -f docker-compose.yml -f docker-compose.gcp.yml \
  run --rm -v $PWD/.env.production:/app/.env.production:ro web npm run prod:check-env
```

Expect, among the other checks:

```
PASS: OPENAI_API_KEY configured
PASS: GEMINI_API_KEY configured
PASS: GROQ_API_KEY configured
```

A missing key is a `FAIL: <KEY> is required`. The check reports presence only — it never
prints a key, a prefix, a suffix, or a length.

---

## 1. The containers actually received them

A key in `.env.production` and a key inside the running process are different facts, and the
difference is a whole class of outage: supplied to `web` and not to `worker` gives a chatbox
that looks healthy while every background AI job fails.

```bash
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.gcp.yml" \
  ./scripts/verify-container-secrets.sh
```

Expect `SET` for all three keys on **both** `web` and `worker`, then:

```
GREEN: every service received every provider credential.
```

---

## 2. The providers answer, and the gateway routes to them

```bash
# Each SDK, one tiny call, with the approved production model.
docker compose ... exec -T web node node_modules/tsx/dist/cli.mjs scripts/ai-provider-smoke.ts

# The path the product actually calls: registry, router, parameter adaptation,
# streaming, the tool loop, and failover in all three directions.
docker compose ... exec -T web node node_modules/tsx/dist/cli.mjs scripts/ai-gateway-smoke.ts
```

Both exit 0 or the deployment is not green. The gateway smoke test asserts **which model
answered**, so a silent failover cannot pass it.

---

## 3. Provider health, as the product reports it

```bash
curl -s https://crm.telestar.cloud/api/ai/status -H "Cookie: <director session>" | jq
```

Expect `chat: "healthy"`, `router.status: "healthy"`, and `configured: true` with
`circuitHealthy: true` for all three providers. Floor Manager and above only.

---

## 4. The chatbox, in a real browser, as real users

This is the gate that matters, and the one whose absence let the defect ship. It drives the
actual widget against the actual providers for four roles — send, stream, multi-turn context,
lead scoping, tools, refusals, layout, and recovery from a dead request.

```bash
# Seed the audit fixture against production ONLY if it is already the convention there;
# otherwise point the run at existing accounts.
BASE_URL=https://crm.telestar.cloud E2E_PASSWORD='<run-scoped>' \
  node node_modules/@playwright/test/cli.js test --project=audit \
  e2e/journeys/telestar-ai-chat.spec.ts
```

The spec fails on the exact production sentence:

```ts
const GENERIC_FAILURE = /Sorry, I ran into a problem generating that/i;
```

so its appearance during healthy operation is a test failure, not a judgement call.

---

## 5. The ledger names models that actually answered

```bash
docker compose ... exec -T web \
  SINCE_MINUTES=30 OPERATION=chat node node_modules/tsx/dist/cli.mjs scripts/verify-ai-attribution.ts
```

Expect every row to name a registered model, its own provider, and carry token counts and a
cost. This is what the alias layer used to make impossible.

---

## 6. Production logs are clean

```bash
docker compose ... logs --since 30m web | grep -E '\[ai/chat\]|\[ai/gateway\]'
```

Every `[ai/chat] turn` line should read `"status":"ok"` with a `provider`, a `model`, and
`"failure":null`. A `[ai/gateway] provider attempt failed` line is not automatically a
problem — it carries a `failure` classification and the turn may still have succeeded on a
fallback, which is the system working. What must not appear is a turn whose `status` is not
`ok` during normal operation.

Each line carries a `turnId`, and the response carries the same value in `X-Telestar-Turn-Id`.
One id ties a user's report to the server's account of what happened — which is precisely what
nobody had while this defect was live.
