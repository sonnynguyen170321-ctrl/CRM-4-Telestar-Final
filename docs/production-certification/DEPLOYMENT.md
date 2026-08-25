# Telestar CRM — Deployment & Release Identity

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/EV-RELEASE-IDENTITY.json
  Regenerate: node scripts/certification/render-deployment.mjs
-->

**Requirement**: `REL-001`
**Defect**: `TEL-P1-018`
**Chain status**: **COMPLETE**
**Candidate SHA**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
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
| APPLICATION_SOURCE_SHA | `9b2b44c9f0987139e2f48ee21b14ec36e10690a8` | — |
| CI_RUN_ID | `32891125645` | — |
| IMAGE_DIGEST | `sha256:99fbfe8229e6f298e3c80c8ba280e235ac9b9e528741fc547f3e73fd7364ff2b` | — |
| WEB_DIGEST | `sha256:99fbfe8229e6f298e3c80c8ba280e235ac9b9e528741fc547f3e73fd7364ff2b` | — |
| WORKER_DIGEST | `sha256:99fbfe8229e6f298e3c80c8ba280e235ac9b9e528741fc547f3e73fd7364ff2b` | — |
| HEALTH_SHA | `9b2b44c9f0987139e2f48ee21b14ec36e10690a8` | — |
| Deployment timestamp | `2026-08-25T21:39:18.398Z` | — |
| Migration set | **not established** | `prisma migrate status` against the deployed database |

## 3. Identity assertions

- `APPLICATION_SOURCE_SHA == HEALTH_SHA` — **holds**
- `IMAGE_DIGEST == WEB_DIGEST` — **holds**
- `IMAGE_DIGEST == WORKER_DIGEST` — **holds**

## 4. Rollback

Executed. Rolled from `ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final@sha256:99fbfe8229e6f298e3c80c8ba280e235ac9b9e528741fc547f3e73fd7364ff2b` to `ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final@sha256:791210e226a60b0c8220768cef60f6a32abe32aa6a1125e9b89edf05838e9523` in 1.5s.

## 5. Post-deployment gate

Not yet applicable — nothing has been deployed from a frozen candidate. When it is, the gate
is: DNS, TLS, login, health, Postgres, Redis, worker heartbeat, migration state, release SHA,
image digest; the six-role smoke; the golden workflow smoke; email safe mode confirmed; no
stuck queue jobs; no new fatal errors in logs.

No secret values appear in this document, by construction: the generator only ever reads
digests, identifiers and timestamps.
