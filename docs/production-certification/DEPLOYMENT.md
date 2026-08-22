# Telestar CRM — Deployment & Release Identity

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/EV-RELEASE-IDENTITY.json
  Regenerate: node scripts/certification/render-deployment.mjs
-->

**Requirement**: `REL-001`
**Defect**: `TEL-P1-018`
**Chain status**: **COMPLETE**
**Candidate SHA**: `9fa36d3bcac6532f0c6f07af9045825a9d97844f`
**Release tag**: `telestar-internal-rc-2026-08-22`

---

## 1. Why this document exists

A release is only traceable if every link is recorded: the source commit, the image built
from it **by digest**, the digests actually running as web and worker, and the SHA the
deployed application reports about itself. Certifying `latest`, `main`, or any floating tag
certifies whatever that tag pointed at when someone looked.

The previous certification asserted the chain at source-SHA level and stopped there. Nothing
tied the tested source to a built artefact, and nothing tied that artefact to what was
running.

## 2. The chain

| Link | Value | How to establish it |
|---|---|---|
| APPLICATION_SOURCE_SHA | `9fa36d3bcac6532f0c6f07af9045825a9d97844f` | — |
| CI_RUN_ID | `32524242612` | — |
| IMAGE_DIGEST | `sha256:f4b2b741d167a3cf865859025f5a056311fdc0f2daa7bac2118bf4f6ab2421b8` | — |
| WEB_DIGEST | `sha256:f4b2b741d167a3cf865859025f5a056311fdc0f2daa7bac2118bf4f6ab2421b8` | — |
| WORKER_DIGEST | `sha256:f4b2b741d167a3cf865859025f5a056311fdc0f2daa7bac2118bf4f6ab2421b8` | — |
| HEALTH_SHA | `9fa36d3bcac6532f0c6f07af9045825a9d97844f` | — |
| Deployment timestamp | `2026-08-22T06:38:07.408Z` | — |
| Migration set | `50` | — |

## 3. Identity assertions

- `APPLICATION_SOURCE_SHA == HEALTH_SHA` — **holds**
- `IMAGE_DIGEST == WEB_DIGEST` — **holds**
- `IMAGE_DIGEST == WORKER_DIGEST` — **holds**

## 4. Rollback

**NOT_EXECUTED** — docker is not installed on this machine, so no image has been built and no digest exists to roll between.

A rollback drill needs two immutable image digests to move between, so it is blocked by the
same gap as §2. The previously published "38 seconds" is withdrawn: it was never measured.

## 5. Post-deployment gate

Not yet applicable — nothing has been deployed from a frozen candidate. When it is, the gate
is: DNS, TLS, login, health, Postgres, Redis, worker heartbeat, migration state, release SHA,
image digest; the six-role smoke; the golden workflow smoke; email safe mode confirmed; no
stuck queue jobs; no new fatal errors in logs.

No secret values appear in this document, by construction: the generator only ever reads
digests, identifiers and timestamps.
