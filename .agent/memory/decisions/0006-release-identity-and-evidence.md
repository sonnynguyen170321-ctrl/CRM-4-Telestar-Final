---
id: ADR-0006
title: Releases carry immutable identity and generated evidence
status: accepted
classification: CURRENT_CANONICAL
---

# ADR-0006 — Release identity and the certification evidence model

## Context

"Is this fixed in production?" is only answerable if two things are true: you can tell exactly
which code is running, and you can tell exactly what was verified about it.

Both had failed here in ordinary ways. A `latest` tag says nothing about content. A `STATUS.md`
saying a gate passed is a claim about a moment that may no longer exist — the repository
carried status documents asserting results that were stale within days, including one asserting
type errors that had already been fixed.

## Decision

**Identity.** Build from the merge SHA. Record image repository, immutable SHA tag, digest,
build SHA and build timestamp. Deploy by digest or exact SHA. `latest` may exist as a
convenience and is never evidence of what is running.

**Evidence.** Certification verdicts are *generated* from collected results, never asserted by
hand. The generator owns the verdict; generated output is not hand-edited.

**Binding.** Evidence belongs to the candidate SHA it was gathered on. If any runtime, test or
configuration file changes afterwards, that evidence is void — new candidate, new
verification. Evidence gathered on one SHA is never attached to another.

## Why

A verdict a human can type is a verdict a human can type optimistically, under deadline, about
a run they half-remember. A verdict a generator produces from collected exit codes can only be
wrong if the collection is wrong, which is a smaller and more findable surface.

The SHA binding is what makes any of it mean anything. Without it, "all gates green" is true of
some tree, and the tree it was true of is unknowable.

## Consequences

- A green gate on the pre-merge candidate does not certify the merge commit if the merge changed the tree.
- `BLOCKED_EXTERNAL` and `NOT_TESTED` are distinct from `RED` and from `GREEN`, and none of them may be reported as another.
- CI must be able to actually run its mandatory checks. A required check that cannot pass on the current plan is not security — it is pressure to delete the check. Platform-dependent scanners are additional signals; the mandatory dependency gate is one that runs everywhere.

## Alternatives

- **Deploy by tag.** Rejected: tags move.
- **Hand-written certification summaries.** Rejected: this is the failure mode being fixed.

## Protection

- `tests/release.test.ts`, `tests/certification-validator.test.ts`
- `.github/workflows/docker-image.yml` gates publication on the mandatory CI aggregate job rather than the workflow conclusion, so an optional scanner cannot block a release and a failed mandatory gate cannot permit one
- Candidate-SHA binding on collected evidence: **not yet enforced** — phase 6
