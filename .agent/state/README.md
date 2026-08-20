# `.agent/state/` — ephemeral session state

**Gitignored except this file.** Nothing here is committed, and nothing here is authority.

Session state is *generated* at the start of a task from the current branch, HEAD, working
tree, the task prompt, the linked PR or issue, and the impact analysis. It dies with the task.

## Why it is not committed

A committed ACTIVE_WORK document outlives the work. It is written when the picture is clearest
and read when it is most stale, and by then it competes with the code for authority — the
repository already carried thirteen `STATUS.md` and `RESUME_HERE.md` files, several describing
finished initiatives as current.

Shared active work belongs on a GitHub issue or PR, which has a lifecycle and closes. A markdown
pointer has neither.

## What may live here

`brief.json` · `impact.json` · `capabilities.json` · scratch notes for the current task

Regenerate rather than reuse. If a value here is worth keeping, it belongs in `memory/` as a
lesson or a decision, or in a test.
