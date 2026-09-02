# ADR-017 — Manual Send Dry-Run Before Real Send

Status: Patched / accepted for pilot safety.

## Decision

V2.SEND0 renders manual-send preview only. It does not create EmailSend.

Dry-run preview shows:

```txt
to/from
subject
body
resolved variables
missing variables
suppression status
contact email validity
```

Persist at most an audit event such as `email_dry_run_previewed`.

Real send in V2.SEND1 creates:

```txt
EmailSend
ActivityRecord
AuditEvent
```

## Consequences

- Avoids overbuilt dry-run snapshot model.
- Prevents accidental duplicate sends.
- Keeps early outreach slice safe and inspectable.
