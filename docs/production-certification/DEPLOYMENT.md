# Telestar CRM — Deployment & Release Identity

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/EV-RELEASE-IDENTITY.json
  Regenerate: node scripts/certification/render-deployment.mjs
-->

**Requirement**: `REL-001`
**Defect**: `TEL-P1-018`
**Chain status**: **COMPLETE**
**Candidate SHA**: `42420a01a32c68a3a66418eebcd9ebf297cd044b`
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
| APPLICATION_SOURCE_SHA | `42420a01a32c68a3a66418eebcd9ebf297cd044b` | — |
| CI_RUN_ID | `32703297153` | — |
| IMAGE_DIGEST | `sha256:42f0b0daf870ed43e5bc74f1d85557a22fab37a39bfafc2650d4b824b1f8bc03` | — |
| WEB_DIGEST | `sha256:42f0b0daf870ed43e5bc74f1d85557a22fab37a39bfafc2650d4b824b1f8bc03` | — |
| WORKER_DIGEST | `sha256:42f0b0daf870ed43e5bc74f1d85557a22fab37a39bfafc2650d4b824b1f8bc03` | — |
| HEALTH_SHA | `42420a01a32c68a3a66418eebcd9ebf297cd044b` | — |
| Deployment timestamp | `2026-08-24T08:07:50.890Z` | — |
| Migration set | `52` | — |

## 3. Identity assertions

- `APPLICATION_SOURCE_SHA == HEALTH_SHA` — **holds**
- `IMAGE_DIGEST == WEB_DIGEST` — **holds**
- `IMAGE_DIGEST == WORKER_DIGEST` — **holds**

## 4. Rollback

Executed. Rolled from `ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final@sha256:42f0b0daf870ed43e5bc74f1d85557a22fab37a39bfafc2650d4b824b1f8bc03` to `ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final@sha256:1940f699aa658212e706dd80fd74a1dc79a69a88915341627ac8593d753e6cee` in 22.8s.

## 5. Post-deployment gate

Not yet applicable — nothing has been deployed from a frozen candidate. When it is, the gate
is: DNS, TLS, login, health, Postgres, Redis, worker heartbeat, migration state, release SHA,
image digest; the six-role smoke; the golden workflow smoke; email safe mode confirmed; no
stuck queue jobs; no new fatal errors in logs.

No secret values appear in this document, by construction: the generator only ever reads
digests, identifiers and timestamps.
