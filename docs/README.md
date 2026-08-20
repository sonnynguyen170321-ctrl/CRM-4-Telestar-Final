---
classification: CURRENT_CANONICAL
---

# `docs/` — what is current and what is not

Documents do not decide anything. When one disagrees with the code, the document is the
defect. This index exists because the repository accumulated fourteen `STATUS.md` and
`RESUME_HERE.md` files, several describing finished initiatives in the present tense, and an
agent reading one had no way to tell which.

## Source hierarchy

1. Running code and configuration
2. `.agent/generated/` — facts derived from 1
3. Tests
4. Current canonical docs (this layer)
5. Reference docs
6. Historical records — **never current truth, never auto-loaded**

## Classification

Every non-obvious document carries one, in YAML front matter:

| Classification | Means |
|---|---|
| `CURRENT_CANONICAL` | Live. Safe to act on. |
| `CURRENT_REFERENCE` | Live background; not a resume pointer. |
| `GENERATED` | Derived from code. Never hand-edited. |
| `HISTORICAL` | A record of finished work, kept for its reasoning. Not a description of today. |
| `NEEDS_REVIEW` | Classification unresolved. Treat as not current. |
| `SUPERSEDED` | Replaced by a named successor. |

`npm run agent -- check` fails when a status document carries none.

## Live pointers

| Initiative | Pointer |
|---|---|
| Engineering Intelligence OS | [`agent-os/STATUS.md`](./agent-os/STATUS.md) |
| Telestar AI remediation | [`telestar-ai-remediation/STATUS.md`](./telestar-ai-remediation/STATUS.md) |
| Revenue AI | [`revenue-ai/STATUS.md`](./revenue-ai/STATUS.md) |
| Pre-domain hardening | [`pre-domain-hardening/STATUS.md`](./pre-domain-hardening/STATUS.md) |
| Production certification | [`production-certification/STATUS.md`](./production-certification/STATUS.md) |
| Warmup certification | [`warmup-certification/STATUS.md`](./warmup-certification/STATUS.md) |

## Finished — kept for reasoning, not for behaviour

`admin-control-center` · `automation-engine` · `commercial-intelligence` · `deliverability` ·
`design-flags` · `runtime-hardening`

Each carries a NOT CURRENT banner naming where the behaviour now lives — usually a scoped rule
under `.claude/rules/` or a skill under `.agent/skills/`, both of which load on demand instead
of being remembered.

## Why they were not moved into `docs/archive/`

§XXXVI describes an archive directory, and moving them would have been the tidier shape. It
was not done, deliberately: these documents are referenced by source comments, tests and other
docs, and relocating six directories would have broken those references to make an index
prettier. Classification achieves what the archive is *for* — no old status document competing
as current truth — without a rename storm.

If a document later has no reader at all, delete it. Git keeps history; the working tree
carries what is current.

## Adding a document

Ask first whether it is a fact. If the code already knows it, generate it —
`.agent/generated/` — and write nothing. Prose explains *why*; generators state *what*.

If it is genuinely prose, give it a classification, and when its subject finishes, change that
classification rather than leaving it to be read as live.
