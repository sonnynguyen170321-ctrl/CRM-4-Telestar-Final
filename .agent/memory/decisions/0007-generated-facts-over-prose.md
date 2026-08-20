---
id: ADR-0007
title: Derivable facts are generated; the kernel does not grow
status: accepted
classification: CURRENT_CANONICAL
---

# ADR-0007 — Generated facts over prose

## Context

Agent instructions had reached 317,116 bytes across 113 always-loaded files — roughly 79,300
tokens before an agent read a line of the task. Two mechanisms produced it, and they compound.

**Facts were written by hand.** Role lists, model tables, command inventories, environment
requirements and deployment topology all lived as prose. Prose does not fail when the code
moves. It drifts silently, and it is trusted *precisely because* someone wrote it deliberately.
The repository carried a four-role architecture document for a six-role system, a Vercel + Neon
topology for a GCP deployment, and a warning about a destructive seed hazard that had already
been fixed — an agent following that last one would have defended against nothing and never
learned about the guard that replaced it.

**Corrections were appended to the kernel.** When a stale fact was discovered, the fix was a
note in the file every agent must read. `CLAUDE.md` accumulated at least three self-corrections
of its own earlier claims. The kernel grew monotonically, and every future session paid for
every past mistake.

## Decision

**Nothing derivable is hand-maintained.** Roles, routes, models, env requirements, queues,
scripts and compose services are generated into `.agent/generated/` from the code that defines
them, and read from there.

**Prose explains meaning only** — why a decision was made, what breaks if an invariant is
violated. It does not restate facts the code already states.

**Corrections route to the layer that prevents recurrence**, never to the kernel: a generated
drift check, a contract test, a regression test, a scoped rule, or a skill amendment.

**Scoped over global.** A rule loads only when a matching path is touched. Global instructions
are budgeted and a regression against the budget is a defect.

## Why

A generated fact cannot drift; at worst its generator breaks, loudly, in CI. A hand-written
fact drifts quietly and is believed.

The kernel rule follows from the same reasoning applied to instructions rather than data: if
the cheapest place to record a correction is the always-loaded file, the always-loaded file is
where all corrections end up, and it grows without bound.

## Consequences

- `agent facts` must exist before docs stop hand-maintaining these; that ordering is deliberate.
- A generated file is never hand-edited.
- Adding to `AGENTS.md` requires justifying why no narrower layer will hold it.
- Deleting knowledge is normal. Git preserves history; the working tree carries what is current.

## Protection

- Context budget: `agent context-audit` (phase 4), CI gate (phase 6)
- Drift: `agent check` role/model/env synchronization (phase 6)
- Measured: startup context fell from ~79,300 to ~2,460 tokens; the target is ≤ 2,000 once prose facts in `AGENTS.md` become generated
