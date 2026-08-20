---
id: L001
domain: testing-certification
severity: high
protection: automated
---

# L001 — A pipe reports the pipe's exit code

**Symptom.** A full session of gates reported green. A real type error was present the whole
time.

**Root cause.** `node .../tsc --noEmit | tail -20` exits with `tail`'s status, not `tsc`'s.
`tail` always succeeds. Every gate run through a pipe — `| tee`, `| tail`, `| head`, `| grep` —
reports the last stage.

**Why it deceives.** The output *looks* like failure output. The errors are printed. The exit
code says success, and it is the exit code that automation believes. A human skimming sees
errors and assumes the run failed; the script does not.

It survives because it only matters when something is broken. Every green run is honest by
coincidence.

**Permanent protection.**

```bash
node node_modules/typescript/bin/tsc --noEmit > /tmp/tsc.out 2>&1; echo "EXIT=$?"
```

Redirect to a file, capture `$?` immediately, then read the file. In shell scripts,
`set -o pipefail` where a pipe is genuinely required. Report counts, never the word "PASS".

**Where it applies.** Any command whose exit code decides something: CI steps, certification
collection, an agent reporting a gate result.

- Stated in `AGENTS.md`, `.agent/CONSTITUTION.md` §8 and `.agent/registry/tests.yaml`
- Related source: `.github/workflows/ci.yml` uses `set -o pipefail` where it tees
