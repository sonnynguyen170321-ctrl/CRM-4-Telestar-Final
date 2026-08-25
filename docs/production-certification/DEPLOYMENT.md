# Telestar CRM — Deployment & Release Identity

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/EV-RELEASE-IDENTITY.json
  Regenerate: node scripts/certification/render-deployment.mjs
-->

**Requirement**: `REL-001`
**Defect**: `TEL-P1-018`
**Chain status**: **COMPLETE**
**Candidate SHA**: `00661af99e645060dafefcfc85a1c5ca3a0d0c13`
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
| APPLICATION_SOURCE_SHA | `00661af99e645060dafefcfc85a1c5ca3a0d0c13` | — |
| CI_RUN_ID | `32711776013` | — |
| IMAGE_DIGEST | `sha256:791210e226a60b0c8220768cef60f6a32abe32aa6a1125e9b89edf05838e9523` | — |
| WEB_DIGEST | `sha256:791210e226a60b0c8220768cef60f6a32abe32aa6a1125e9b89edf05838e9523` | — |
| WORKER_DIGEST | `sha256:791210e226a60b0c8220768cef60f6a32abe32aa6a1125e9b89edf05838e9523` | — |
| HEALTH_SHA | `c7bf639ef988a6ba9fffba3c88761dad245ef7a3` | — |
| Deployment timestamp | `2026-08-24T09:41:35.285Z` | — |
| Migration set | `52` | — |

## 3. Identity assertions

- `APPLICATION_SOURCE_SHA == HEALTH_SHA` — **FAILS**
- `IMAGE_DIGEST == WEB_DIGEST` — **holds**
- `IMAGE_DIGEST == WORKER_DIGEST` — **holds**

## 4. Rollback

Executed. Rolled from `ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final@sha256:791210e226a60b0c8220768cef60f6a32abe32aa6a1125e9b89edf05838e9523` to `ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final@sha256:904fa6c51775f39b1f584abc79b6adc0a94fcd259ce170a3acd2fb7bd86ed0d8` in 1.5s.

## 5. Post-deployment gate

Not yet applicable — nothing has been deployed from a frozen candidate. When it is, the gate
is: DNS, TLS, login, health, Postgres, Redis, worker heartbeat, migration state, release SHA,
image digest; the six-role smoke; the golden workflow smoke; email safe mode confirmed; no
stuck queue jobs; no new fatal errors in logs.

No secret values appear in this document, by construction: the generator only ever reads
digests, identifiers and timestamps.
