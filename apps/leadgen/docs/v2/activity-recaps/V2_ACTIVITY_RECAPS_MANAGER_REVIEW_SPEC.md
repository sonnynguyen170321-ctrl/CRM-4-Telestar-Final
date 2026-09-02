# V2 Activity Recaps Manager Review Spec

Status: **v0.2 patched**

## 1. Purpose

Manager Review protects the primary dataset from messy SDR recap sheets. It handles uncertain identity matches, no-match rows, duplicate suspicions, and suggested status changes.

## 2. ManagerReviewItem reasons

```txt
no_match_from_recap
multiple_company_candidates
multiple_contact_candidates
generic_email_only
fuzzy_name_only
no_project_context
possible_duplicate_activity
possible_activity_correction
status_change_suggested
stale_activity_date
company_domain_conflict
```

## 3. Resolution actions

Allowed one-by-one actions:

- link to existing company/contact/LeadAssignment,
- create company/contact from recap row,
- create LeadAssignment after selecting Project/ICP,
- create corrected ActivityRecord,
- dismiss as non-actionable,
- snooze,
- assign to another manager,
- add manager note.

## 4. Unresolved queue policy

ManagerReviewItems do not expire automatically in pilot.

Rationale:

- Automatic expiry can hide operational problems.
- BPO managers need traceability.
- Early pilot may produce many unmatched rows while the database fills.

## 5. Safety valve for large queues

Low-risk bulk dismiss is allowed. Bulk accept/update is forbidden.

### Allowed bulk dismiss categories

```txt
no_match_from_recap
duplicate_suspected
stale_activity_date
```

Requirements:

- manager must choose dismiss reason,
- action is audited,
- dismissed items remain queryable,
- no Company/Contact/LeadAssignment/Activity mutation happens during bulk dismiss.

### Forbidden in pilot

```txt
bulk accept matches
bulk create contacts
bulk create companies
bulk mutate lead statuses
bulk meeting-booked updates
```

## 6. Priority and assignment

Recommended fields:

```txt
priority: low | normal | high
assigned_to_user_id?
due_at?
snooze_until?
resolution_status: open | resolved | dismissed | snoozed
resolution_note
```

## 7. UX requirements

The manager drawer must show:

- source row,
- normalized row,
- suggested candidates,
- confidence reason codes,
- what will be created/linked if accepted,
- safe actions only.

## 8. Metrics

Track:

- open review items,
- resolved review items,
- dismissed review items,
- average resolution time,
- unresolved > 7 days,
- top reason codes.
