# Telestar CRM — Deployment & Release Identity

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/EV-RELEASE-IDENTITY.json
  Regenerate: node scripts/certification/render-deployment.mjs
-->

**Requirement**: `REL-001`
**Defect**: `TEL-P1-018`
**Chain status**: **INCOMPLETE — see §2**
**Candidate SHA**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
**Release tag**: `telestar-internal-rc-2026-08-20`

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
| APPLICATION_SOURCE_SHA | `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb` | — |
| CI_RUN_ID | **not established** | `gh run list --commit <sha> --json databaseId,conclusion,workflowName` |
| IMAGE_DIGEST | **not established** | `docker buildx build --push` then `docker buildx imagetools inspect <ref>` |
| WEB_DIGEST | **not established** | `docker inspect --format {{index .RepoDigests 0}} <web container>` |
| WORKER_DIGEST | **not established** | `docker inspect --format {{index .RepoDigests 0}} <worker container>` |
| HEALTH_SHA | **not established** | `curl -s https://<host>/api/health` and read the release SHA it reports |
| Deployment timestamp | **not established** | recorded by the deploy step |
| Migration set | **not established** | `prisma migrate status` against the deployed database |

## 3. Why the chain is incomplete

No container runtime is available on the certification workstation, so no image has been
built and no digest exists to record. This is a genuine external blocker, not an oversight,
and it is recorded as `BLOCKED_EXTERNAL` rather than omitted: the certificate reports the
chain as unestablished and the verdict cannot reach GO while `REL-001` is unverified.

To complete it, on a host with a container runtime and access to the registry:

```bash
# 1. Build from the frozen candidate, and push by digest.
git checkout dfb172f53afaaae5f8304dd22b8f0dd37af69bcb
docker buildx build --platform linux/amd64 -t <registry>/telestar-crm:telestar-internal-rc-2026-08-20 --push .
IMAGE_DIGEST=$(docker buildx imagetools inspect <registry>/telestar-crm:telestar-internal-rc-2026-08-20 \
  --format '{{json .Manifest.Digest}}')

# 2. Deploy that digest - never the tag.
#    Web and worker run the same image unless separateImagesIntentional is declared.

# 3. Read back what is actually running.
docker inspect --format '{{index .RepoDigests 0}}' <web container>
docker inspect --format '{{index .RepoDigests 0}}' <worker container>
curl -s https://<host>/api/health

# 4. Record it.
node scripts/certification/record-release-identity.mjs \
  --candidate dfb172f53afaaae5f8304dd22b8f0dd37af69bcb \
  --ci-run <run-id> --image <digest> --web <digest> --worker <digest> --health-sha <sha>
```

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
