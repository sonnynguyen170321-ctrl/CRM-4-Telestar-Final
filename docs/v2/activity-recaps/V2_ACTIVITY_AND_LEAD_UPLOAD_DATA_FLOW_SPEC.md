# V2.A0.1 — Activity + Lead Upload Data Flow Spec

## 1. Executive Decision

- HOLD V2.A1 implementation.
- GO for V2.A0.1 planning/spec only.
- V2.A1 should not run until import profile, timestamp, wide-row expansion, and `sourceActivityHash` decisions are reviewed and locked.

This phase exists because real uploaded SDR files are polymorphic. V2.A1 must consume event-level activity rows, not guess whether every spreadsheet row is an activity.

## 2. Why This Spec Exists

Real SDR files are not uniform. A single spreadsheet row can represent:

- one lead snapshot
- one activity event
- multiple activity events
- one pipeline/status snapshot
- one meeting tracker row
- unknown/mixed row

Treating all rows as activity events causes:

- phantom activities when lead batches contain a stage but no historical action
- duplicate events when wide rows contain email, call, and LinkedIn status in one row
- corrupted timeline order when upload time or modified time is used as event time
- wrong LeadAssignment matching when status snapshots imply historical outreach
- future outreach issues when imported columns become fake send history instead of real touch events

V2 must distinguish raw row ingestion from canonical event creation. Raw rows are audit evidence. Activity events are event-level facts extracted from those rows only when the import profile and timestamp policy support it.

## 3. Import Profile Taxonomy

`ImportRowKind` / `ImportProfile` candidates are:

- `lead_snapshot`
- `activity_event`
- `wide_activity_bundle`
- `pipeline_snapshot`
- `meeting_tracker`
- `unknown_mixed`

### `lead_snapshot`

- Meaning: a row describing a prospect, company, contact, or future work queue item.
- Common columns: company name, website/domain, contact name, email, phone, LinkedIn, title, geography, industry, list/source, owner, optional stage.
- Examples from SDR-style sheets: new lead batch, "Team B Enterprise" contact/company list, campaign prospect list, enrichment export.
- Expected output: later creates or suggests Company, Contact, and LeadAssignment candidates.
- Creates activity events: no; zero `CanonicalActivityRow` events.
- Timestamp required: no.
- Manager review behavior: review if company/contact evidence is weak, duplicate/conflicting, destructive status is present, or a stage looks like completed activity without a usable timestamp.

### `activity_event`

- Meaning: a row describing one historical SDR action or one activity outcome.
- Common columns: activity date, SDR/owner, channel, status/result, note, company/contact evidence.
- Examples from SDR-style sheets: one row for "LinkedIn Sent" on a date, one row for "Call No Pickup", one row for "Meeting booked".
- Expected output: one event-level `CanonicalActivityRow`.
- Creates activity events: yes, exactly one if the row has a usable activity signal.
- Timestamp required: required for auto-apply; missing or unsafe timestamps still allow raw ingestion but require review.
- Manager review behavior: review if timestamp is missing/unparseable/conflicting, identity is weak, channel/type is unclear, or outcome is destructive.

### `wide_activity_bundle`

- Meaning: a row where one prospect/contact row contains multiple channel-specific activity columns.
- Common columns: company/contact fields plus Email Stage, Email Date, Call Stage, Call Date, LinkedIn Stage, LinkedIn Date, WhatsApp/Zalo stage/date, notes.
- Examples from SDR-style sheets: one row tracking 1st/2nd/3rd email, call pickup/no pickup, LinkedIn sent/message for the same contact.
- Expected output: `0..N` event-level `CanonicalActivityRow` rows.
- Creates activity events: yes, one per usable channel/stage/date signal; no event for blank or non-activity signals.
- Timestamp required: required per expanded event for auto-apply; missing timestamp blocks auto-apply for that event only.
- Manager review behavior: review expanded events with ambiguous channel, missing date, conflicting dates, destructive outcome, or weak identity.

### `pipeline_snapshot`

- Meaning: a current CRM or pipeline state observation, not full activity history.
- Common columns: stage, status, owner, last activity time, created time, modified time, pipeline, deal/lead status, company/contact evidence.
- Examples from SDR-style sheets: "Need-call list", "Meetings Booked", "SQL", "Qualified", "Not Interested" pipeline export.
- Expected output: later status observation or manager-reviewed LeadAssignment state suggestion.
- Creates activity events: not generic outreach events; at most one status observation event later if explicitly mapped.
- Timestamp required: not required for raw ingestion; required or manager-confirmed if status observation is applied as occurredAt.
- Manager review behavior: review destructive or conflicting pipeline changes, status snapshots that imply missing history, and any status without clear LeadAssignment context.

### `meeting_tracker`

- Meaning: a row tracking meeting lifecycle, distinct from generic outreach history.
- Common columns: Date Book, Date Happen, Meeting Time, Meeting Status, Status, Follow Up, Show-up, No Show, Rescheduled, owner, company/contact fields.
- Examples from SDR-style sheets: Fingermind-style meeting trackers, Brandon-tracker-style sheets, booked/demo/held/no-show trackers.
- Expected output: booking event and/or meeting occurrence event later, plus review items when context is missing.
- Creates activity events: yes only for mapped meeting lifecycle events, not for every tracker status.
- Timestamp required: required for auto-apply of meeting events; missing dates still allow ingestion.
- Manager review behavior: review if meeting booked has no LeadAssignment, dates conflict, status is unclear, or meeting state is destructive/conflicting.

### `unknown_mixed`

- Meaning: file or row has mixed signals and cannot be safely classified.
- Common columns: partial company/contact evidence, stage/status, missing date, unclear notes, corrupted text, mixed lead and activity columns.
- Examples from SDR-style sheets: contact/company file with `Stage = LI sent` but no timestamp or notes; combined lead/pipeline/activity export.
- Expected output: raw ingestion plus user confirmation or manager review before apply.
- Creates activity events: no automatic events.
- Timestamp required: not enough information to decide; activity apply is blocked.
- Manager review behavior: requires user confirmation/review. Unknown/ambiguous profile should not auto-apply activity.

## 4. Ambiguous Import Profile Resolution

Team B Enterprise style example:

- has contact/company fields
- `Stage = LI sent`
- no timestamp
- no notes

This can be either:

- lead batch upload: the row is a future work queue item with an initial/current stage label
- activity recap: the row claims LinkedIn was sent, but lacks event time and notes

Decision:

- Future upload flow should ask user to choose file type/profile.
- System may suggest profile based on headers and sample rows.
- User must confirm the profile before apply.
- SDR can upload, but ambiguous/destructive auto-apply requires Team Lead/Manager review.
- Team Lead/Manager should be able to override the selected profile before apply.
- Unknown/ambiguous profile should not auto-apply activity.
- Do not rely on structure alone for ambiguous files.

Future profile selection UX, conceptually:

1. User uploads file.
2. System parses sample rows and suggests a profile such as lead batch, activity recap, pipeline snapshot, or meeting tracker.
3. User confirms or changes the profile before validation/apply.
4. Ambiguous rows are flagged with examples and reason codes.
5. Team Lead/Manager can override the selected profile before apply when the chosen profile would create activity, status, meeting, or destructive outcomes.

No UI is implemented in V2.A0.1.

## 5. Raw Row to Canonical Event Flow

Data flow:

```txt
RawIngestionRow
-> import profile detection / user-selected profile
-> row kind classification
-> mapping validation
-> timestamp parsing
-> expansion if wide row
-> CanonicalActivityRow[] or lead/status/meeting observation
-> identity resolver later
-> manager review later
-> apply later
```

`CanonicalActivityRow` remains event-level, not spreadsheet-row-level.

One raw row may produce no activity events. One raw row may produce one activity event. One raw row may produce multiple activity events after wide-row expansion. Lead, pipeline, and meeting observations must not be forced into generic outreach activity rows.

## 6. Wide-Row Expansion Policy

Locked policy:

- One raw row may produce `0..N` `CanonicalActivityRow` events.
- Example: Email Stage + Call Stage + LinkedIn Stage in one row produces separate email/call/linkedin events.
- No event should be created if the row has no usable activity signal.
- Missing timestamp blocks auto-apply but does not block raw ingestion.

Conceptual mapping:

```txt
WideRowChannelMapping:
  channel
  stageColumn
  dateColumn?
  noteColumn?
  sourceColumnName
```

Expansion rules:

- Each configured channel mapping is evaluated independently.
- A non-empty stage/status can create an event candidate only if it maps to a real activity bucket.
- Empty, data-quality-only, qualification-only, or pipeline-only values do not create channel events.
- If channel-specific date exists, it is the timestamp candidate for that event.
- If no channel-specific date exists, activity date may be a fallback.
- Missing or unsafe timestamp creates warning/review state, not a fake occurredAt.

This is spec/pseudocode only. No TypeScript contract is changed in V2.A0.1.

## 7. sourceRowHash vs sourceActivityHash

Definitions:

- `sourceRowHash` = deterministic hash for the original raw uploaded row.
- `sourceActivityHash` = deterministic hash for each event extracted from that row.

`sourceRowHash` alone is insufficient for wide rows because one raw row can produce multiple activity events. If all expanded events share only `sourceRowHash`, the system cannot distinguish the email event from the call event or LinkedIn event for idempotency, correction handling, review, and future append-only activity history.

Proposed formula:

```txt
sourceActivityHash = sha256(
  sourceRowHash +
  channel +
  sourceColumnName +
  rawStage +
  rawTimestamp +
  eventIndexWithinRow
)
```

Critical status marker:

- This formula is PROPOSED in V2.A0.1.
- It is NOT IMPLEMENTED yet.
- It is NOT a live runtime or schema contract until V2.A0.2 or a later approved phase ratifies it.
- No deduplication runtime should rely on this formula until the approved implementation phase locks it.

`eventIndexWithinRow` is a deterministic index assigned during wide-row expansion based on configured mapping order. It prevents collisions when multiple extracted events from the same raw row have the same channel, stage, and timestamp.

Clarifications:

- `sourceActivityHash` should be locked before event apply/runtime.
- It may be added to contracts/schema in a later phase.
- Do not change schema in V2.A0.1.

## 8. Timestamp Policy

`TimestampQuality` values:

- `exact_datetime`
- `date_only`
- `inferred_from_note`
- `missing`
- `unparseable`
- `conflicting`

Policy table:

| TimestampQuality | Ingest raw row? | Auto-apply policy |
|---|---:|---|
| `exact_datetime` | yes | possible if identity is high-confidence and event is non-conflicting |
| `date_only` | yes | possible with lower confidence / local timezone rule later |
| `inferred_from_note` | yes | no auto-apply by default |
| `missing` | yes | no auto-apply |
| `unparseable` | yes | no auto-apply |
| `conflicting` | yes | manager review |

Important decisions:

- Do not reject a whole file just because timestamps are missing.
- Do not use upload `createdAt` as `occurredAt` for historical activity recaps.
- For `lead_snapshot`, timestamp is not required.
- For activity auto-apply, timestamp is required or must be safely interpretable.

Upload time may be stored as ingestion metadata. It is not evidence that the activity occurred at upload time.

## 9. Inter-Column Timestamp Conflict Policy

Conflict examples:

- TimeStamp Email differs from Activity Date.
- Last Activity Time differs from Modified Time.
- Meeting Date Book differs from Date Happen.

Decision:

- Channel-specific timestamp wins for the channel event.
- Activity Date can be fallback if no channel-specific timestamp exists.
- Last Activity Time can support `pipeline_snapshot` observation.
- Modified Time is metadata, not `occurredAt`, unless no better timestamp exists and manager confirms.
- Date Book and Date Happen represent different meeting lifecycle moments.
- Conflicts should create warnings and may require manager review.

Do not collapse all timestamp columns into one generic date. Different timestamp columns often represent different operational facts.

## 10. Stage / Status Buckets

### 1. Activity Event

Examples:

- 1st Email Sent
- 2nd Email Sent
- 3rd Email Sent
- LinkedIn Sent
- LinkedIn Message
- Calls No Pickup
- Calls Pickup
- WhatsApp Mess
- Zalo Message

These can create activity events when channel/type and timestamp are usable. Missing timestamp blocks auto-apply.

### 2. Lead Lifecycle / Pipeline Status

Examples:

- New Contacts
- Need-call list
- Meetings Booked
- Meetings Held
- SQL
- Qualified
- Not Interested

These should affect LeadAssignment status later only through explicit pipeline/status handling and review rules. They should not automatically become outreach events.

### 3. Qualification Result

Examples:

- Not Relevant
- Relevant
- Bad Fit
- Wrong ICP
- Cannot access website

These are qualification observations or review signals. They should not create activity events by default. Destructive or final-looking outcomes require manager review before changing LeadAssignment state.

### 4. Data Quality / Contact Validity

Examples:

- Invalid email
- Bounced
- Invalid number
- Wrong number
- No longer working
- Đổi công ty
- risky email validation
- catch-all email validation

These are contact validity or data-quality signals. They may create review items or future contact identifier validity updates. They should not be treated as generic activity stages.

### 5. Meeting Lifecycle

Examples:

- Date Book
- Date Happen
- Meeting booked
- Meeting held
- No show
- Rescheduled
- Follow up needed

These can create meeting lifecycle events when mapped under `meeting_tracker` or explicit meeting activity context. Missing dates or missing LeadAssignment context require review.

### 6. Unknown / Ambiguous

Examples:

- corrupted encoding
- mojibake
- unclear mixed notes
- stage without timestamp

These should create warnings and manager review. They should not auto-create activity events or lead status changes.

## 11. Encoding / Locale / SEA Data Handling

Policy:

- Preserve raw text exactly in `rawRowJson`.
- Normalized text may trim and normalize whitespace.
- Detect obvious mojibake/corrupted encoding and warn.
- Vietnamese terms like “Đổi công ty” should map to data quality/contact validity review, not automatic disqualification.
- Do not silently convert locale-specific statuses into destructive lead outcomes.
- Email validation labels like risky/catch-all/bounced should not be treated as activity stages.

Locale-specific labels should be mapped through explicit reviewed rules. If a term is unclear, preserve it and route to review instead of guessing.

## 12. Manager Review Trigger Rules

Triggers:

- missing/unparseable/conflicting timestamp for activity event
- ambiguous import profile
- no company and no contact evidence
- multiple company/contact/lead candidates
- meeting booked but no LeadAssignment exists
- pipeline status conflicts with existing lead state
- destructive outcome: not interested, bounced, wrong person, left company, invalid contact
- changed company / đổi công ty
- activity exists but channel unclear
- stage exists but no usable date
- corrupted symbols/mojibake
- lead batch row has stage that looks like completed activity but no timestamp
- status snapshot attempts to imply full history

Auto-apply requirements:

- high identity confidence
- timestamp quality exact/date_only
- activity type/outcome unambiguous
- non-destructive update
- no conflict with current LeadAssignment state

If any requirement fails, the row or expanded event should remain ingested but should not apply automatically.

## 13. Lead Batch Upload Policy

Lead gen batch upload is for future work queue creation.

Rules:

- It should create/suggest Company, Contact, and LeadAssignment later.
- It should not create activity events.
- Stage values in lead batch should be treated as optional initial status, not historical evidence, unless user confirms.
- Timestamp is not required.
- Future SDR actions inside the tool should generate server-side activity timestamps.

Lead batch import and activity recap import may share ingestion infrastructure. They must not share unsafe assumptions about row meaning.

## 14. Pipeline / CRM Snapshot Policy

Pipeline snapshot is a current state observation.

Rules:

- It should not reconstruct missing history.
- Stage + Last Activity Time can create at most one status observation event later.
- Created Time / Modified Time are metadata unless explicitly mapped.
- Pipeline status updates should be manager-reviewed if destructive or conflicting.

Pipeline exports are especially risky because they often contain current state, last activity metadata, and modified timestamps together. V2 must not infer a complete activity timeline from a status snapshot.

## 15. Meeting Tracker Policy

Meeting tracker is a distinct import profile.

Rules:

- Meeting tracker detection should be user-declared first, heuristic second.
- Heuristic examples: Date Book, Date Happen, Meeting Time, Meeting Status, Status, Follow Up, Show-up, No Show, Rescheduled.
- Date Book = booking event.
- Date Happen = meeting occurrence event.
- Status may determine `meeting_booked`, `meeting_done`, `no_show`, `rescheduled`, `follow_up_needed`.
- Missing meeting date should not reject file but should block auto-apply.
- Meeting booked without LeadAssignment should create manager review later.
- Fingermind-style and Brandon-tracker-style meeting sheets may use different column names for the same concepts, so mapping must be profile/template-based, not hardcoded to one sheet.

Meeting lifecycle events can affect reporting and next actions, but they must not be treated as generic outreach history.

## 16. Future Outreach Compatibility

Do not implement outreach now.

The activity model must support future touch history:

- Email follow-up 1/2/3/4 should become event touch sequence, not fixed columns.
- Imported historical rows should not become fake sends.
- Manual send later should create `EmailSend` and `ActivityRecord`, not fake imported history.

Future fields likely needed:

- `touchIndex`
- `occurredAt`
- `actor`/SDR user
- `channel`
- `activityType`
- `outcome`
- contact/company/LeadAssignment context
- `sourceActivityHash`
- note/rawStatus/source

This keeps imported recap history separate from first-party outreach actions created inside V2.

## 17. Impact on Existing V2.A0 Contracts

Current V2.A0 contracts are event-level and include `CanonicalActivityRow` plus `sourceRowHash`. They do not yet model import profiles, timestamp quality, wide-row fan-out, or per-event source hashes.

A later V2.A0.2 should consider adding pure TypeScript contracts for:

- `ImportRowKind`
- `TimestampQuality`
- `sourceActivityHash`
- `WideRowChannelMapping`
- `ImportProfileDetectionResult`
- expanded activity event result type

Important:

- V2.A0.2 may patch pure TypeScript contracts first.
- Schema patch is not automatic.
- Schema change should only happen if reviewers explicitly approve exact DB fields and phase scope.

Do not edit V2.A0 contracts in V2.A0.1.

## 18. Recommended Next Phase After Review

Decision tree:

If reviewers approve taxonomy, timestamp policy, and `sourceActivityHash` proposal:

- V2.A0.2 — patch pure contracts/normalization for import profiles, timestamp quality, proposed `sourceActivityHash`, and wide-row expansion contracts.
- Schema only if explicitly approved in a separate scoped phase.

If reviewers think schema is needed:

- Create separate schema phase before V2.A1, but only after exact fields are approved.

If reviewers disagree on taxonomy/hash/timestamp policy or find meeting/pipeline/lead batch ambiguity unresolved:

- NO-GO for V2.A1.
- Return to data model review before any implementation.

Then:

- V2.A1 — Activity Match Confidence Resolver, pure logic only, consuming event-level `CanonicalActivityRow` or expanded activity event contract.
- V2.A2 — Manager Review Workflow Foundation.
- V2.A3 — Activity Recap Import Runtime.
- V2.L0 — Lead Batch Import Planning/Runtime, separate from activity recap if needed.

## 19. Explicit Out of Scope

- no code
- no schema
- no migration
- no API
- no UI
- no runtime parser
- no DB writes
- no identity resolver
- no manager review creation
- no scoring
- no AI
- no outreach/send implementation
- no V1 import/backfill
- no dynamic V1 joins

## 20. Open Review Questions

1. Is the 5-profile taxonomy correct, including `unknown_mixed`?
2. Should `meeting_tracker` be separate or subtype of `activity_event`?
3. Should `pipeline_snapshot` be separate or subtype of lead lifecycle?
4. Should `sourceActivityHash` be added before V2.A1?
5. Should `sourceActivityHash` become a DB field later or remain runtime-only until ActivityRecord exists?
6. Should ambiguous profile selection require user confirmation?
7. Should missing timestamp block only auto-apply, not ingestion?
8. What timestamp conflict rule should win?
9. Which status/stage mappings are missing for Vietnam/SEA SDR data?
10. Should V2.A0.2 patch contracts before V2.A1?
11. Should lead batch import be a separate phase from activity recap import?
12. What is the smallest safe implementation after this spec?

This spec is intentionally decision-oriented. Its job is to protect scope and prevent V2 from becoming a second CSV spaghetti system.
