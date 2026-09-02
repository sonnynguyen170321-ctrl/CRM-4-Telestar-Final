# V2 Leads — People/CRM Augment Plan (mock parity)

Status: PLANNED (audit done 2026-06-21). Owner decisions locked:
- **Identity**: AUGMENT the existing `/v2/leads` scoring workspace — keep scoring (Fit/Qualification/Why) AND add the mock's CRM columns + drawer sections. One page does both.
- **New-model scope**: FULL mock fidelity — Notes + Tasks/Next-Action + Log-Activity all functional.

Mock = "07 Contacts & Leads / Lead Assignment Drawer" (people layer). Reference screenshot supplied by owner.

## Decision consequences
- `/v2/leads` stays LeadAssignment-row + Project/ICP context. We DO NOT switch to a contact-row directory; instead we surface contact-centric data per row/drawer.
- Activity-log "Log Activity" REUSES `V2ActivityRecord` via a manual insert path (manual `sourceActivityHash`, `timestampQuality='manual'`). No new activity model.
- Net-new schema = `V2LeadNote` + `V2Task` only.

## Audit summary (wired vs gap)
Wired already: contact/company/ICP/assessment, `getLeadWorkspaceDetail`, `queryLeadTimeline`, `queryContacts`/`getContactDetail`, M1 `ownerUserId`/`assignedAt` columns (NOT yet surfaced).
Gaps to close: Owner col+avatar, Last Touch, Meeting status, Manager-Review flag, Linked Projects#/ICPs# (per contact), SDR Owner + Assigned date in drawer, Notes, Next Action/Tasks, Recent Touch History read model, Quick Actions write paths, contact phone (from identifier).

## Phase L1 — read-model extends (no schema)
Change-kind: read-model + UI columns.
- Extend `LeadWorkspaceRow` read model (`buildLeadRowsSql` in queryLeadWorkspace.ts):
  - `ownerUserId`, `ownerName` (JOIN V2User on la.ownerUserId)
  - `assignedAt`
  - `lastTouchAt` + `lastTouchChannel` (MAX occurredAt across V2OutreachActivity + V2ActivityRecord for the lead)
  - `meetingStatus` (derive: workflowStatus IN MEETING_BOOKED/MEETING_DONE, else from meeting activity)
  - `reviewStatus` (EXISTS active/any V2ManagerReviewItem for leadAssignmentId → Reviewed/Not Reviewed)
  - `linkedProjectCount`, `linkedIcpCount` (per CONTACT: COUNT DISTINCT projectId/icpVersionId across that contact's ACTIVE assignments; company-level fallback by companyId)
- Extend `getLeadWorkspaceDetail` to include ownerUserId/ownerName/assignedAt.
- Add columns to `LeadWorkspaceTable`: Owner, Last Touch, Meeting, Manager Review (append; keep scoring cols).
- Note enum gap: map workflowStatus → mock labels (In Progress/Nurturing/Paused/New) in a presenter; flag any missing status (e.g. PAUSED) for owner.
- SEE-IT: table shows the new columns from real data.

## Phase L2 — schema: V2LeadNote + V2Task
Change-kind: schema + migration + read-model.
- `V2LeadNote`: id, organizationId, leadAssignmentId, authorUserId, body (text), createdAt, deletedAt. Index [org, leadAssignmentId, createdAt]. Soft FK convention.
- `V2Task`: id, organizationId, leadAssignmentId, contactId?, title, detail?, dueAt?, status (OPEN/DONE/CANCELLED), ownerUserId?, createdByUserId, createdAt, completedAt?, deletedAt. Index [org, ownerUserId, status, dueAt], [org, leadAssignmentId, status].
- Migration additive/nullable, IF NOT EXISTS, non-destructive (migrate deploy).
- Read models: `queryLeadNotes(org, leadId)`, `queryLeadTasks(org, leadId)` (or fold into detail). Next Action = earliest OPEN task by dueAt.
- SEE-IT: drawer shows Notes + Next Action/Tasks read-only.

## Phase L3 — write paths (Quick Actions)
Change-kind: runtime + UI actions. Perm: workflow.update (SDR works own leads); audit each.
- `addLeadNote` (insert V2LeadNote, audit).
- `createLeadTask` (insert V2Task; default owner = lead owner or actor; audit) + `completeTask`.
- `logLeadActivity` (insert V2ActivityRecord manual: channel/activityType/outcome/eventKind, timestampQuality='manual', random sourceActivityHash; audit). Reuses timeline.
- SEE-IT: Quick Actions (Log Activity / Add Note / Create Task) work; appear in drawer + timeline.

## Phase L4 — drawer rebuild to mock layout
Change-kind: UI. Augment existing tabbed drawer (do not delete scoring tabs).
- Contact Overview: company, Linked Projects list+count, Linked ICPs list+count, Current Lead Assignments (across projects) w/ status + owner.
- Lead Assignment Details: Project, ICP, **SDR Owner** (L1), Status, **Assigned date** (L1), **Notes** (L2/L3).
- Next Action card (earliest open task + due) (L2/L3).
- Recent Touch History (channel + relative time) from touch read model.
- Quick Actions row: Log Activity / Add Note / Create Task (L3).
- Contact header: phone (from PHONE identifier), location (company country fallback; flag if true contact location wanted).
- SEE-IT: drawer matches mock.

## Invariants to honor
2 (LeadAssignment unit), 3 (workflow ≠ qualification ≠ ownership), 4 (assessments immutable — notes/tasks/activity never mutate them), 5 (org+actor from session), 6 (idempotent writes where applicable), 8 (soft-delete filters), 12 (one change-kind/phase), 13 (smoke per phase), 14 (SEE-IT each backend phase), 15 (no commit/advance without review).

## Open items for owner
- workflowStatus has no PAUSED; mock shows "Paused". Add status, or map to NURTURE/NOT_INTERESTED?
- Contact location: add `V2Contact.city/country`, or use company country only?
- Task ownership/assignment UI depth (assign task to other SDR?) — defer or include in L3?
