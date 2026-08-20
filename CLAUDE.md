@AGENTS.md

# Claude Code adapter

`AGENTS.md` is the root and carries all product truth. This file adds only what is specific to
running Claude Code here, and stays small: it loads on every turn.

Architecture, role lists, invariants, initiative status and test counts belong in `AGENTS.md`,
`.agent/`, or a scoped rule. This file previously held all of it, passed 30 KB, and
accumulated corrections of its own stale claims. Do not restart that.

## Scoped rules

`.claude/rules/*.md` carry `paths:` frontmatter and load only when a matching file is touched.
An unscoped rule loads always and must be tiny.

## Before running anything

```bash
npm run agent -- doctor
```

It reports what this machine can actually run, and how to invoke tooling here — the `&` in the
checkout path breaks npm/npx shims, and `tsc`/`next build` need a raised heap. Those are
properties of the machine, so they live with the command that describes it rather than being
re-read every session.

## Subagents

Give a subagent the smallest tool set its job needs. An explorer does not need write access; a
verifier must not silently edit the candidate it is certifying. Authority comes from the
capability profiles in `.agent/agents/`, never from the skill it loaded.
