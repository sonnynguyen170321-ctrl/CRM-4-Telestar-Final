# V2 Activity Recaps Spec

Status: **v0.2 patched**  
Scope: CSV-first SDR activity recap import and review workflow.

## 1. Purpose

Activity Recaps are a core product workflow for Telestar's BPO SDR operations. They convert daily/weekly SDR working sheets into normalized, reviewable activity data that managers can trust.

## 2. Pilot file format

Pilot runtime supports **CSV only**.

XLSX is deferred until after CSV ingestion is stable.

Reason:

- CSV is easier to parse, debug, diff, and recover.
- Excel-specific issues such as merged cells, hidden sheets, formulas, and multi-sheet ambiguity should not block pilot.

## 3. CanonicalActivityRow

```ts
export type CanonicalActivityRow = {
  activityDate: string | null;
  sdrUser: string | null;
  clientAccountName?: string | null;
  projectName?: string | null;
  companyName?: string | null;
  companyWebsite?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactLinkedIn?: string | null;
  channel: 'email' | 'linkedin' | 'call' | 'whatsapp' | 'zalo' | 'other' | 'unknown';
  activityType: 'first_touch' | 'follow_up' | 'connection_request' | 'call_attempt' | 'positive_reply' | 'meeting_booked' | 'other' | 'unknown';
  outcome: string | null;
  note: string | null;
  sourceRowHash: string;
};
```

## 4. Source-of-truth policy

Activity recap data is operational evidence. It must not blindly mutate lead qualification, final score, or pipeline status.

Allowed:

- create ActivityRecord for high-confidence match,
- create ManagerReviewItem for low-confidence/no-match/conflict,
- suggest status changes,
- show SDR recap metrics.

Forbidden:

- auto-change final qualification,
- auto-overwrite SDR/manager review,
- auto-mark meeting booked without review unless explicitly configured later,
- auto-create contacts from generic email alone.

## 5. Idempotency and correction behavior

ActivityRecord is append-only.

### Exact duplicate

If re-uploaded row has the same activity dedupe key and no meaningful changes:

```txt
skip
```

### Minor correction

If re-uploaded row appears to correct a previous record:

```txt
create new ActivityRecord
set supersedes_activity_record_id = old record
old record remains immutable
hide superseded old record from default activity view
```

### Manager correction

Manager resolution creates a new corrected record or a resolution state. It must not mutate the original raw ingestion row.

## 6. Activity dedupe key

Pilot dedupe key should be deterministic and stable:

```txt
org_id
project_id if available
sdr_user
activity_date
channel
activity_type
normalized company/contact evidence
normalized outcome
normalized note hash
```

If project_id is missing, dedupe can still detect row duplicates but cannot safely link to LeadAssignment.

## 7. Matching flow

```txt
normalize row
→ resolve company
→ resolve contact
→ resolve project/ICP context
→ resolve LeadAssignment if possible
→ create ActivityRecord or ManagerReviewItem
```

Low-confidence matches must go to manager review.

## 8. Create-from-recap

Managers need a fast path:

```txt
Create company/contact from recap row
```

Required UI context:

- raw row,
- normalized row,
- matched candidates,
- missing fields,
- selected project/ICP,
- action audit.

## 9. Metrics

Track:

- uploaded rows,
- normalized rows,
- auto-matched rows,
- suggested matches,
- manager review rows,
- no-match rows,
- created-from-recap count,
- duplicate skipped count,
- superseded correction count.

## 10. Codex guardrails

Codex must not:

- implement XLSX in pilot,
- mutate final qualification from recap outcomes,
- overwrite ActivityRecord,
- auto-accept fuzzy matches,
- create dangerous bulk actions.
