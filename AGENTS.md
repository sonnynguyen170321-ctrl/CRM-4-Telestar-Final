<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Active initiative — Runtime Hardening + BullMQ migration

The primary bug-fix + update flow for this repo. Any agent (Claude Code, Gemini CLI,
OpenCode, etc.) working on runtime correctness, sequencing, email, import, or workers:

1. Read **`docs/runtime-hardening/STATUS.md`** first — current phase, next unchecked task, blockers.
2. Execute that task from **`docs/runtime-hardening/PLAN.md`** (corrected P0–P11 roadmap with acceptance tests).
3. Tick the checkbox + update `STATUS.md`; commit referencing the task id (e.g. `P0.1`).

Key constraints: Neon HTTP driver has **no interactive transactions** (workers use
`DIRECT_URL`); BullMQ workers run on a **separate always-on host + Redis**, never on
Vercel; reuse existing `lib/crypto.ts` and `lib/sequences/engine.ts`. Claude Code users:
full guardrails are in `.claude/rules/runtime-hardening.md`.

Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Drop: articles (a/an/the), filler (just/really/basically), pleasantries, hedging
- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.
- Pattern: [thing] [action] [reason]. [next step].
- Not: "Sure! I'd be happy to help you with that."
- Yes: "Bug in auth middleware. Fix:"

Switch level: /caveman lite|full|ultra|wenyan
Stop: "stop caveman" or "normal mode"

Auto-Clarity: drop caveman for security warnings, irreversible actions, user confused. Resume after.

Boundaries: code/commits/PRs written normal.
