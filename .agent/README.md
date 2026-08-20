# `.agent/` — the agent control plane

Canonical, tool-neutral. `AGENTS.md`, `CLAUDE.md` and `.claude/rules/*` are **adapters**: they
carry loading mechanics for a particular tool. Product truth lives here and in the code.

| Directory | Holds | Authority |
|---|---|---|
| `CONSTITUTION.md` | How engineering work is done here. Versioned. | HIGH |
| `registry/` | Machine-readable maps: domains, risks, tests, skills, sources, policies | HIGH |
| `memory/` | `INVARIANTS.md`, `decisions/` (ADRs), `lessons/` | HIGH |
| `agents/` | Capability profiles — *authority*, not knowledge | HIGH |
| `skills/` | Domain expertise, loaded 1–3 per task | MEDIUM |
| `generated/` | Facts derived from code. Never hand-edited. | Derived from code |
| `evals/` | Routing fixtures, golden tasks, regressions | test |
| `state/` | Ephemeral session state. Gitignored. | none |

## The rule that keeps this useful

**Anything derivable from code is generated, never written by hand.** Roles, routes, models,
env requirements, queues and scripts come from `generated/`. A human writing them into prose
is how a repository ends up with a four-role architecture document describing a six-role
system.

Prose here explains *meaning* — why a decision was made, what breaks if an invariant is
violated. It does not restate facts the code already states.

## Reading order for a new agent

1. `AGENTS.md` — the kernel
2. `npm run agent -- brief` — what this task needs
3. The 1–3 skills it names, the source files, their tests

Do not read this directory exhaustively. It is indexed so it does not have to be.

## Adding to it

| You have | It goes in |
|---|---|
| A rule that holds regardless of task | `memory/INVARIANTS.md` — with a source and a protecting test |
| A decision whose *rationale* matters later | `memory/decisions/` as an ADR |
| A failure pattern that cost real time | `memory/lessons/` — and ideally a test or checker |
| Expertise needed only for one domain | `skills/` |
| A fact the code already knows | nowhere — generate it |

If a correction would otherwise be appended to `AGENTS.md`, that is the signal it belongs in
one of the rows above instead. The kernel does not grow.
