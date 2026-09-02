# Next Session Plan — Outreach Goes Live + CRM Actionability

## Context & Problem Statement

Outreach hiện tại là "đồ chơi":
- Có runtime (SMTP, IMAP, sequence engine, suppression gate) nhưng **không có enrollment UI**.
- Lead workspace hiển thị companies nhưng **không có action buttons** ngoài Re-score + Compose link.
- ContextBar (ICP loader) đang render ở **mọi /v2 page** nhưng chỉ relevant cho `/v2/leads`.
- Contacts chưa show rõ link về company → SDR không biết contact thuộc cty nào khi nhìn danh sách.
- Không có **batch action** (enroll nhiều leads vào sequence cùng lúc).
- Workflow user cần: filter company insights → load ICP → re-score → batch enroll vào outreach hoặc export.

## Scope: 4 work blocks

---

### Block 1: ContextBar scoping — chỉ show ở /v2/leads

**Problem**: ContextBar (Account/Project/ICP selectors) renders từ `app/v2/layout.tsx` → mọi /v2 page đều có cái bar to đùng, dư thừa cho outreach/contacts/admin/etc.

**Solution**:
- Move ContextBar render ra khỏi `app/v2/layout.tsx`.
- Đặt ContextBar chỉ trong `app/v2/leads/page.tsx` (hoặc tạo `app/v2/leads/layout.tsx`).
- Các page khác được giải phóng vertical space.

**Files**: `app/v2/layout.tsx`, `app/v2/leads/page.tsx` (hoặc new `app/v2/leads/layout.tsx`)

---

### Block 2: Lead workspace actionability — "Apollo-style" lead actions

**Problem**: Leads page là read-only table + drawer. SDR không có next-step actions: enroll sequence, add to list, change status bulk.

**Solution** (Apollo.io-inspired):
1. **Row checkbox selection** — multi-select leads trong table.
2. **Bulk action bar** (sticky bottom) khi ≥1 row selected:
   - "Enroll in sequence" → pick a published sequence + sender → batch enroll
   - "Export selected" → download CSV chỉ selected leads
   - "Change status" → bulk workflow status update
3. **LeadDrawer actions upgrade**:
   - "Enroll in sequence" button (single lead) → pick sequence + sender → create V2SequenceEnrollment
   - Show enrollment status nếu lead đã enrolled
   - Show outreach timeline (messages sent/replied/bounced)
4. **Company insight chips** trong lead table:
   - Show industry, size (from V2CompanyIntelligenceProfile.classificationJson) inline
   - SDR nhìn table biết ngay company context

**New files**:
- `lib/v2/outreach/sequences/enrollLead.ts` — `enrollLead(db, { organizationId, sequenceId, leadAssignmentId, contactId, senderAccountId })`: insert V2SequenceEnrollment + enqueue first SEQUENCE_STEP_EXECUTE. Idempotent on (org, sequence, lead).
- `lib/v2/outreach/sequences/batchEnroll.ts` — loops enrollLead for multiple leads, returns success/skip/error per lead.
- `components/v2/leads/LeadBulkActionBar.tsx` — client component, sticky bottom bar.
- `components/v2/leads/EnrollSequenceModal.tsx` — sequence picker + sender picker + confirm.

**Modified files**:
- `components/v2/leads/LeadWorkspaceTable.tsx` — add checkboxes + selection state
- `components/v2/leads/LeadDrawerActions.tsx` — add "Enroll in sequence" + enrollment status
- `app/v2/leads/page.tsx` — pass sequence list + sender list for enrollment modal

---

### Block 3: Contacts → Company linking visibility

**Problem**: Contact page shows leadAssignmentCount but no company name in the table. SDR nhìn contact list không biết liên kết company.

**Solution**:
- `queryContacts` SQL: join company name through LeadAssignment → V2Company (lấy company name từ most recent active LA).
- Add "Company" column vào contacts table.
- Contact drawer already shows linkedLeadAssignments (with companyName) — đã có ✅.

**Files**: `lib/v2/crm/queryContacts.ts`, `app/v2/contacts/page.tsx`, `lib/v2/crm/shapeContacts.ts`

---

### Block 4: Sequence enrollment runtime + worker integration

**Problem**: Sequence authoring (create/publish) exists but there's no **enrollment creation path** from UI, and `SEQUENCE_STEP_EXECUTE` jobs need a scheduler to pick up due enrollments.

**Solution** (Apollo-style auto-sequencing):
1. **Enrollment creation** (`enrollLead.ts`):
   - Validates: sequence must be ACTIVE, lead must have a valid contact email, sender must be active, not already enrolled in this sequence.
   - Inserts V2SequenceEnrollment (status=ACTIVE, currentStepOrdinal=0).
   - Enqueues first SEQUENCE_STEP_EXECUTE job immediately (or with delay from step 1's delayMinutes).
   
2. **Step progression** (already built in `sequenceStepHandler.ts`):
   - After executing a step, handler sets `nextStepAt` for the next step's delay.
   - Worker needs to **poll due enrollments** and enqueue their next SEQUENCE_STEP_EXECUTE.

3. **Sequence scheduler** (new):
   - `scripts/v2-sequence-scheduler.mjs` — interval script (like imap-poller) that:
     - SELECTs enrollments WHERE status='ACTIVE' AND nextStepAt <= NOW() AND no pending SEQUENCE_STEP_EXECUTE job for that enrollment.
     - Enqueues SEQUENCE_STEP_EXECUTE for each.
   - Add `npm run v2:sequence-scheduler` to package.json.
   - OR: piggyback on the existing worker loop (simpler) — after draining jobs, check for due enrollments.

4. **liveSendEnabled toggle UI** (on Senders page):
   - Add a toggle/button on `/v2/outreach/senders` to flip liveSendEnabled.
   - Gated behind `product_tree.write` permission.

**Files**:
- `lib/v2/outreach/sequences/enrollLead.ts` (new)
- `lib/v2/outreach/sequences/batchEnroll.ts` (new)
- `scripts/v2-sequence-scheduler.mjs` (new) OR extend `scripts/v2-job-worker.mjs`
- `app/v2/outreach/senders/page.tsx` (add liveSendEnabled toggle)
- `package.json` (add v2:sequence-scheduler script if separate)

---

## Execution order

```
Block 1 (15 min) → Block 3 (20 min) → Block 4 runtime (40 min) → Block 2 UI (60 min)
```

1. **Block 1**: Quick fix — move ContextBar, ship immediately.
2. **Block 3**: Quick data fix — contacts show company.
3. **Block 4**: Runtime — enrollLead + scheduler so sequences actually run.
4. **Block 2**: UI — selection + bulk bar + enrollment modal. Depends on Block 4's enrollLead.

## Apollo.io sequence UX reference

How Apollo does it:
- From contact/lead list: select → "Add to sequence" → pick sequence → pick sender mailbox → choose start step (default: step 1) → optionally personalize first email → "Add".
- From lead detail: same flow as a single-lead enrollment.
- Enrollment view: per-lead shows which sequence, current step, next send time, status (active/paused/completed/halted).
- Pause/resume: user can pause an enrollment manually.
- Sequence analytics: per sequence shows enrolled count, completion rate, reply rate.

We'll match: single enroll from drawer, batch enroll from table, enrollment status on drawer, pause/resume toggle.

## Safety invariants (carried from AGENTS.md)

- Suppression gate (Inv 10): enrollment creates messages via sequenceStepHandler → EMAIL_SEND job → executeSend → suppression check. Never bypassed.
- Idempotency (Inv 6): enrollment unique on (org, sequence, lead). Re-enrolling same lead = noop.
- Tenant isolation (Inv 5): all queries scoped by org from session.
- No fake rows (Inv 7): enrollment status is real DB state, not derived.
- Assessments immutable (Inv 4): scoring from bulk bar creates new assessments.

## Out of scope (next-next session)

- Sequence analytics dashboard (reply rate per sequence)
- A/B testing on sequence steps
- Drag-and-drop canvas (current server-action forms are sufficient)
- Email template library (Templates tab still locked)
- Smart send-time optimization
- Lead routing / round-robin sender assignment
