# Lead Gen Intelligence — Manual Send Dry-Run Spec

**Status:** Draft for review  
**Purpose:** pull a safe outreach slice forward without building the full sequence engine.

## 0. Executive Decision

Full outreach automation is deferred. A manual single-send flow can be introduced early, starting with dry-run only.

## 1. SEND0 — Dry-run only

Workflow:

```txt
Open Lead Drawer
→ choose approved template
→ resolve variables
→ preview To / Subject / Body
→ show suppression and missing variable warnings
→ log preview optional
→ no email is sent
```

## 2. SEND1 — Manual single send

Only after dry-run is trusted:

```txt
user confirms send
system checks suppression
system sends one email
system records EmailSend + ActivityRecord
```

## 3. Required checks

```txt
contact has valid email identifier
email not suppressed
project/account allows send
template approved
variables resolved or user confirms blanks
lead assignment linked
```

## 4. Forbidden early

```txt
multi-step sequences
auto-enrollment
bulk sending
open/click tracking
IMAP reply detection
AI-generated email auto-send
```

## 5. Variable snapshot

At send time, store resolved variables:

```txt
recipient
subject
body
variable_values_json
template_version_id
lead_assignment_id
user_id
```


---

## Codex Guardrails
- Do not modify V1 routes, V1 API handlers, V1 scoring, V1 export, V1 AI, or V1 feedback logic.
- Do not modify `prisma/schema.prisma` from this spec alone.
- Do not create migrations until the relevant schema phase is approved.
- Do not implement runtime code until the phase prompt explicitly allows it.
- Preserve append-only history and source-of-truth boundaries.

## Human Review Gate
Before implementation, confirm:
1. The decision matches the V7 master plan.
2. The spec does not contradict another spec or ADR.
3. Open questions are resolved or explicitly deferred.
4. Codex allowed files are narrow enough for the next phase.
