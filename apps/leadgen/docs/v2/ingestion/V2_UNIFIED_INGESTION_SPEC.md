# V2 Unified Ingestion Spec

Status: **v0.2 patched**  
Scope: Company upload, contact upload, activity recap CSV. XLSX is deferred.

## 1. Purpose

V2 must not have one upload system for companies and another for activity recaps. Use a single ingestion framework so mapping, validation, row traceability, idempotency, rollback, and audit work consistently.

## 2. Job types

```ts
export type IngestionJobType =
  | 'company_upload'
  | 'contact_upload'
  | 'activity_recap';
```

Pilot supports CSV. XLSX is approved roadmap after CSV is stable.

## 3. Core tables / objects

```txt
ingestion_jobs
- id
- org_id
- client_account_id?
- project_id?
- job_type
- uploaded_by
- original_file_name
- source_file_storage_key
- status
- mapping_json
- row_counts_json
- created_at / updated_at

ingestion_rows
- id
- job_id
- source_row_number
- source_row_hash
- raw_row_json
- normalized_row_json
- validation_status
- validation_errors_json
- match_status
- matched_ids_json
- apply_status
- applied_target_ids_json
```

## 4. Job statuses

```txt
uploaded
mapped
validating
validated
applying
applied
partially_applied
failed
rolled_back
abandoned
```

## 5. CSV parser policy

The ingestion parser must handle common SDR spreadsheet failure modes.

Required pilot behavior:

- UTF-8 with BOM support,
- delimiter detection: comma, semicolon, tab,
- quoted fields,
- line breaks inside quoted fields,
- empty row skipping,
- duplicate header detection,
- whitespace trimming for headers,
- row-level errors isolated where possible.

Fatal conditions:

- cannot parse header row,
- file is empty,
- encoding cannot be decoded,
- file exceeds configured max size,
- parse failure prevents row boundary detection.

Validation threshold:

```txt
>20% invalid rows → job status remains validated_with_errors / needs_review before apply
row-level errors → row.validation_status = error
```

## 6. Batch/chunk policy

Do not apply thousands of rows in one transaction.

Pilot defaults:

```txt
parse/normalize chunk size: ~500 rows
DB apply batch size: 100–250 rows
progress write after each batch
```

If a batch fails:

- successful previous batches remain applied,
- failed rows are marked error,
- job becomes `partially_applied`,
- user can retry failed rows, rollback applied rows, or export errors.

## 7. Idempotency

### 7.1 Source row hash

Use source row hash for exact duplicate detection inside a job:

```txt
unique(job_id, source_row_hash)
```

### 7.2 Normalized dedupe key

Each job type defines a normalized dedupe key:

- company upload: canonical domain or normalized company name + context,
- contact upload: non-generic email / LinkedIn / phone+name+company context,
- activity recap: activity date + SDR + channel + company/contact evidence + outcome + normalized note hash.

### 7.3 Re-upload policy

Re-upload never blindly overwrites records.

- exact duplicate → skip,
- same normalized dedupe key with changed fields → create review/correction path,
- activity correction → superseding ActivityRecord,
- raw ingestion rows remain immutable.

## 8. `partially_applied` behavior

`partially_applied` is recoverable but not auto-resumed.

UI actions:

- Retry failed rows only,
- Rollback applied rows,
- Export failed/error rows,
- Open Manager Review for unresolved identity rows,
- Mark job abandoned.

Forbidden:

- blind re-run of entire job,
- duplicate apply of already applied rows,
- silent overwrite of target records.

## 9. Raw file retention

Pilot default:

- retain original uploaded file for 30 days in local/staging unless manually deleted,
- retain parsed raw_row_json needed for audit/debug,
- do not store secrets/API keys in raw rows,
- future GDPR/data retention policy can tighten this.

## 10. Row fan-out

Accepted rows fan out to typed targets:

```txt
company_upload → Company / Contact? / LeadAssignment
contact_upload → Contact / ContactIdentifier / LeadAssignment?
activity_recap → ActivityRecord or ManagerReviewItem
```

## 11. Rollback policy

Rollback should reverse target records created by the job when safe.

Never rollback:

- records manually edited after apply,
- records referenced by later activity/review/send records,
- records imported from V1 legacy source unless explicitly chosen.

## 12. Codex guardrails

Codex must not:

- create separate ingestion frameworks,
- implement XLSX in pilot unless explicitly approved,
- apply 5k rows in one transaction,
- silently overwrite ActivityRecords,
- treat `partially_applied` as success,
- create runtime code before the implementation phase.
