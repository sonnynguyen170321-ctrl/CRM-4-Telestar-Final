@AGENTS.md

# Claude Code adapter

`AGENTS.md` above is the root and carries all product truth. This file adds only what is
specific to running Claude Code against this repository. It must stay small: everything here
loads on every turn, for every task.

If you are about to add project architecture, a role list, an invariant, an initiative status
or a test count to this file — it belongs in `AGENTS.md`, `.agent/`, or a scoped rule under
`.claude/rules/`. This file previously held all of that and grew past 30 KB, accumulating
corrections of its own stale claims. Do not restart that.

## Scoped rules

`.claude/rules/*.md` use `paths:` frontmatter and load only when a matching file is touched.
A rule with no `paths:` loads always and must be tiny.

## Running commands in this checkout

The checkout path contains an `&` (`.../Sonny & AI/...`). This breaks npm and npx `.bin`
shims — `npx tsc` resolves to a path that does not exist. Call entry scripts through node
directly:

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node node_modules/eslint/bin/eslint.js .
node node_modules/prisma/build/index.js migrate deploy
node node_modules/tsx/dist/cli.mjs <script>
node ./node_modules/next/dist/bin/next dev
```

`scripts/build.cjs` already does this.

`tsc` and `next build` need `NODE_OPTIONS=--max-old-space-size=8192`, or they exit 134 with
`FATAL ERROR: Ineffective mark-compacts near heap limit` — a heap limit, not a type error.

`prisma generate` fails on Windows with `EPERM ... query_engine-windows.dll.node` while another
process holds the query engine. Stop the dev server and any running test process first.

> These are properties of this machine, not of the project. `npm run agent -- doctor` is where
> they belong once it exists; until then they live here so a session does not lose an hour to
> them.

## Subagents

Give a subagent the smallest tool set its job needs. An explorer does not need write access; a
verifier must not silently edit the candidate it is certifying. Authority comes from the
capability profiles in `.agent/agents/`, not from the skill it loaded.

## Reporting

Never report a gate's result from a piped command — the pipe's exit code is the last stage's.
Capture the tool's own exit code and record counts rather than the word "PASS".
