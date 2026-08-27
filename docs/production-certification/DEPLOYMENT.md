# Telestar CRM — Deployment & Release Identity

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/EV-RELEASE-IDENTITY.json
  Regenerate: node scripts/certification/render-deployment.mjs
-->

**Requirement**: `REL-001`
**Defect**: `TEL-P1-018`
**Chain status**: **COMPLETE**
**Candidate SHA**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
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
| APPLICATION_SOURCE_SHA | `396d3652c619c25f8f26005127e9b7291cdaeedf` | — |
| CI_RUN_ID | `33108408475` | — |
| IMAGE_DIGEST | `sha256:0b0f49774e3b64d2d77c0a682a3b2fb52ed51762596669ef4e2f21a1ffa2a9eb` | — |
| WEB_DIGEST | `sha256:0b0f49774e3b64d2d77c0a682a3b2fb52ed51762596669ef4e2f21a1ffa2a9eb` | — |
| WORKER_DIGEST | `sha256:0b0f49774e3b64d2d77c0a682a3b2fb52ed51762596669ef4e2f21a1ffa2a9eb` | — |
| HEALTH_SHA | `396d3652c619c25f8f26005127e9b7291cdaeedf` | — |
| Deployment timestamp | **not established** | recorded by the deploy step |
| Migration set | **not established** | `prisma migrate status` against the deployed database |

## 3. Identity assertions

- `APPLICATION_SOURCE_SHA == HEALTH_SHA` — **holds**
- `IMAGE_DIGEST == WEB_DIGEST` — **holds**
- `IMAGE_DIGEST == WORKER_DIGEST` — **holds**

## 4. Rollback

Executed. Rolled from `ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final@sha256:0b0f49774e3b64d2d77c0a682a3b2fb52ed51762596669ef4e2f21a1ffa2a9eb` to `ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final@sha256:6cd77511e157b14528ddd05dd4aea2b5464d9243b64709a94e80ddea2d039136` in 18.76s.

## 5. Post-deployment gate

Not yet applicable — nothing has been deployed from a frozen candidate. When it is, the gate
is: DNS, TLS, login, health, Postgres, Redis, worker heartbeat, migration state, release SHA,
image digest; the six-role smoke; the golden workflow smoke; email safe mode confirmed; no
stuck queue jobs; no new fatal errors in logs.

No secret values appear in this document, by construction: the generator only ever reads
digests, identifiers and timestamps.
