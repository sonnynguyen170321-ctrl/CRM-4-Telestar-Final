# Research discovery

Discovery finds companies and people the CRM has never seen. It is the counterpart to the enrichment
already in `lib/research/engine.ts`: enrichment adds detail to a record that exists, discovery creates
the record in the first place.

Ported from the leadgen app, rebuilt on the CRM's own schema, writers and role boundary.

## The pipeline

```
plan queries → search → reject junk → dedupe → score → (operator picks) → promote
```

Every stage is deterministic. No AI decides whether a candidate is real. `fitScore` is a heuristic
count of how many ICP hint tokens actually surface in the harvested evidence, stored beside
`fitSource: 'heuristic'` so an AI re-rank layer can later overwrite it without the two being confused.

| Stage | Where | Notes |
| --- | --- | --- |
| Plan | `@telestar/core-research/buildDiscoveryQueries` | From an ICP version's rules, or free-form builder params. |
| Search | `@telestar/core-search` via `lib/research/searchGateway.ts` | exa → brave → serper → searxng → ddg. |
| Reject | `parseDiscoveryResults` + `icpDiscoveryFilter` | Listicle titles, media/directory hosts, ICP exclusions. |
| Dedupe | unique `(tenantId, runId, dedupeFingerprint)` + `ResearchProspect` | Within a run, and across runs. |
| Score | `scoreCandidateHeuristic` | Deterministic, zero AI. |
| Promote | `lib/research/promote.ts` | Through the shared identity writers. |

## Running one

1. `POST /api/research/runs` — plans the queries and stores them. **Nothing is searched and nothing is
   charged at this point.** A run whose ICP produces no queries is rejected here, while a human is
   still watching, rather than sitting `queued` forever looking like a stuck worker.
2. `POST /api/research/runs/{id}/execute` — runs one bounded batch (`DISCOVERY_QUERY_BATCH`, 10
   queries) and returns `finished`. Call it until `finished` is true. The bound exists so no single
   request holds a connection for minutes; `queryCursor` on the run makes a resume exact.
3. `GET /api/research/candidates?runId=…` — the ranked list.
4. `POST /api/research/candidates/promote` — creates the records.

The `/research` page drives all four.

## What promotion actually does

```
candidate → resolveAccount → (resolveContact, if an email is known) → LeadPoolItem → scoreImportedPoolItem
```

Promotion goes through `lib/identity/resolveAccount.ts` and `resolveContact.ts` — the same writers the
CSV import worker uses — so a researched lead and an uploaded lead resolve to **one** Account rather
than two spellings of one company. The pool record is then scored by `scoreImportedPoolItem`, the same
function the import worker calls, against the same ICP version. A researched lead and an uploaded lead
end up in an identical state.

A person with no email stays a pool record and does not become a Contact. An email address is the
CRM's identity for a person; inventing a placeholder to satisfy the column is how the fabricated
`noemail@telestar.vn` addresses got into the database in the first place.

Promotion is idempotent per candidate: the second call returns `already_promoted` and creates nothing.

## Cost and accounting

Search is billed per query, across three paid providers. `lib/research/searchGateway.ts` wraps the
`fetchImpl` the search package accepts and writes every call to `ResearchProviderAttempt` — provider,
status, timing, and the request URL with any key-shaped query parameter redacted.

It does not route through `lib/ai/gateway.ts`. `recordAiCall` has a fixed provider union wired into
token pricing; search engines bill per query, not per token, and putting both behind one number would
make neither readable.

## Idempotency, and the trap to remember

- **Candidates** — unique `(tenantId, runId, dedupeFingerprint)`. The same company surfacing on several
  queries in one run is the ordinary case, not an error; the constraint is the dedupe, and the loser of
  the race is counted as a duplicate.
- **Evidence** — unique `(tenantId, idempotencyKey)`, keyed on run + fingerprint + source URL.
- **The ledger** — `ResearchProspect` is keyed on the fingerprint alone, across runs. It answers "have
  we surfaced this before, and did anyone take it", which is what stops a weekly run from re-offering
  everything the team already imported.

The trap: **company intelligence enrichment keys its idempotency on `researchVersion`.** Changing
classification logic without bumping `COMPANY_INTEL_PIPELINE_VERSION` means every re-enqueue no-ops and
the fix never reaches the database. That exact mistake kept a classification fix invisible for six
weeks in the leadgen app.

## Tenant isolation

Every query is scoped by `tenantId` from the session — `requireTenantId`, never a client parameter.
`runDiscoveryPass` throws when the run does not belong to the caller's tenant rather than returning an
empty result, so a cross-tenant attempt is loud. `tests/research-discovery.test.ts` covers both.

Promotion writes a `LeadgenActivity`, which lets the client extension in `lib/prisma.ts` stamp the
tenant from ambient context, so it must run inside a tenant context — routes get that from the session,
and tests establish it with `tenantStorage.run`.
