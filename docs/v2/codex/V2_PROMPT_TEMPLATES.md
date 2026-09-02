# Lead Gen Intelligence — V2 Prompt Templates

## 1. Standard phase prompt skeleton

```txt
Read AGENTS.md first if it exists.

Context:
- V1 is frozen legacy/LTS.
- Current phase: [PHASE NAME].
- Use these specs: [LIST].

Task:
[CONCISE TASK]

Allowed files:
[EXACT FILES/PATHS]

Forbidden:
- Do not touch V1.
- Do not modify schema/migrations unless explicitly allowed.
- Do not proceed to next phase.

Verification:
[COMMANDS]

Final response must include:
1. Files changed
2. Verification output summary
3. Runtime/schema/V1 confirmation
4. Open questions
```

## 2. Docs-only prompt ending

```txt
Stop after docs are created/updated.
Do not implement runtime code.
Do not suggest commit unless asked.
```

## 3. Schema phase prompt ending

```txt
Do not add UI/API routes in this phase.
Run prisma validate/generate.
Explain migration and rollback assumptions.
```

## 4. UI phase prompt ending

```txt
Do not change server logic, scoring, schema, or V1.
Use existing mocks/specs.
Keep UI component scope narrow.
```
