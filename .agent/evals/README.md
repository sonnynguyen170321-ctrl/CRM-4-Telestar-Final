# `.agent/evals/` — does the control plane work

| Directory | Asserts |
|---|---|
| `routing/` | a task description resolves to the right domain, risk and skills — **and not to the wrong ones** |
| `golden-tasks/` | representative historical Telestar defects, each with expected domain, risk, sources, tests and safety boundaries |
| `regressions/` | a specific past routing or context failure cannot return |

Precision matters as much as recall. A router that loads eight skills to cover the two that
mattered has not solved the problem it exists to solve — it has moved the cost from the agent
to the context window.

Deterministic checks run in normal CI. Full agent benchmarks are expensive and run periodically
after substantial changes to the agent system, not per commit.
