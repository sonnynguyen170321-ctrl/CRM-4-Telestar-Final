# ECS Fargate task-definition templates

Fill in the placeholders, then register (or paste into the ECS console "Create with JSON"):

```bash
aws ecs register-task-definition --region ap-southeast-1 \
  --cli-input-json file://deploy/task-def.app.json
```

Placeholders to replace in every file:
- `<ACCOUNT>` — your 12-digit AWS account id.
- `<REGION>` — `ap-southeast-1`.
- The `secrets[].valueFrom` ARNs — the Secrets Manager secret ARNs from runbook step 9. These assume
  **individual** secrets. If you used one JSON secret, use the
  `arn:...:secret:telestar-XXXX:DATABASE_URL::` form (append `:<jsonKey>::`).

All three share the same image (`telestar-v2:latest`); only `family`, `command`, sizing, and ports
differ. See `docs/v2/AWS_MIGRATION_RUNBOOK.md` for the full sequence. Logs go to the `/ecs/<family>`
CloudWatch group (auto-created).
