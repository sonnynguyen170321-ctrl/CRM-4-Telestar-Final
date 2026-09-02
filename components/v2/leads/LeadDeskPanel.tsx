import { CheckCircle2, StickyNote, ListTodo, Activity, UserCircle2, CalendarClock } from "lucide-react";

import {
  addLeadNoteAction,
  createLeadTaskAction,
  completeLeadTaskAction,
  logLeadActivityAction,
} from "@/app/v2/workspace/leads/actions";
import type { LeadWorkspaceDetail, LeadNote, LeadTask, AssignableMember } from "@/lib/v2/crm";

// Contacts & Leads "desk": Lead Assignment Details (owner/assigned), Notes, Tasks
// (next actions), and Log Activity. All data is real DB (notes/tasks/owner), all
// writes go through gated server actions. Presentational + native forms only.

const inputCls =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20";

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

export function LeadDeskPanel({
  detail,
  notes,
  tasks,
  members,
}: {
  detail: LeadWorkspaceDetail;
  notes: LeadNote[];
  tasks: LeadTask[];
  members: AssignableMember[];
}) {
  const leadId = detail.leadAssignmentId;
  const openTasks = tasks.filter((t) => t.status === "OPEN");
  const nextAction = openTasks[0] ?? null;

  return (
    <div className="space-y-5">
      {/* Lead Assignment Details */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">Lead assignment details</h3>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <Detail label="Project" value={detail.projectName} />
          <Detail label="ICP" value={`${detail.icpProfileName} v${detail.icpVersionNumber}`} />
          <Detail label="SDR owner" value={detail.ownerName ?? "Unassigned"} icon={<UserCircle2 className="h-3.5 w-3.5" />} />
          <Detail label="Status" value={detail.workflowStatus} />
          <Detail label="Assigned" value={fmtDate(detail.assignedAt)} icon={<CalendarClock className="h-3.5 w-3.5" />} />
          <Detail label="Last touch" value={detail.lastTouchAt ? `${fmtDate(detail.lastTouchAt)}${detail.lastTouchChannel ? ` · ${detail.lastTouchChannel}` : ""}` : "No touch"} />
        </dl>
      </section>

      {/* Next Action */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-1.5">
          <ListTodo className="h-4 w-4 text-primary" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-foreground">Next action</h3>
        </div>
        {nextAction ? (
          <div className="mt-2 rounded-lg border border-primary/20 bg-accent p-3">
            <div className="text-sm font-medium text-foreground">{nextAction.title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {nextAction.dueAt ? `Due ${fmtDate(nextAction.dueAt)}` : "No due date"}
              {nextAction.ownerName ? ` · ${nextAction.ownerName}` : ""}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No open task. Create one below.</p>
        )}
      </section>

      {/* Tasks */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Tasks</h3>
        {tasks.length > 0 ? (
          <ul className="mb-3 space-y-2">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
                <div className="min-w-0">
                  <div className={`text-sm font-medium ${task.status === "OPEN" ? "text-foreground" : "text-muted-foreground line-through"}`}>
                    {task.title}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {task.dueAt ? `Due ${fmtDate(task.dueAt)}` : "No due date"}
                    {task.ownerName ? ` · ${task.ownerName}` : ""}
                  </div>
                  {task.detail ? <p className="mt-1 text-xs text-muted-foreground">{task.detail}</p> : null}
                </div>
                {task.status === "OPEN" ? (
                  <form action={completeLeadTaskAction}>
                    <input type="hidden" name="taskId" value={task.id} />
                    <button type="submit" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Done
                    </button>
                  </form>
                ) : (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{task.status}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-muted-foreground">No tasks yet.</p>
        )}
        <form action={createLeadTaskAction} className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          <input type="hidden" name="leadAssignmentId" value={leadId} />
          <input name="title" placeholder="Create a task / next action…" className={inputCls} required />
          <div className="grid gap-2 sm:grid-cols-2">
            <input type="datetime-local" name="dueAt" className={inputCls} aria-label="Due date" />
            <select name="ownerUserId" defaultValue="" className={inputCls} aria-label="Assign to">
              <option value="">Assign to me</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.name ?? m.email}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90">
            Create task
          </button>
        </form>
      </section>

      {/* Notes */}
      <section>
        <div className="mb-2 flex items-center gap-1.5">
          <StickyNote className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-foreground">Notes</h3>
        </div>
        {notes.length > 0 ? (
          <ul className="mb-3 space-y-2">
            {notes.map((note) => (
              <li key={note.id} className="rounded-lg border border-border bg-card p-3">
                <p className="whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
                <div className="mt-1 text-xs text-muted-foreground">
                  {note.authorName ?? "Unknown"} · {fmtDate(note.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-muted-foreground">No notes yet.</p>
        )}
        <form action={addLeadNoteAction} className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          <input type="hidden" name="leadAssignmentId" value={leadId} />
          <textarea name="body" rows={3} placeholder="Add a note…" className={inputCls} required />
          <button type="submit" className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90">
            Add note
          </button>
        </form>
      </section>

      {/* Log Activity */}
      <section>
        <div className="mb-2 flex items-center gap-1.5">
          <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-foreground">Log activity</h3>
        </div>
        <form action={logLeadActivityAction} className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          <input type="hidden" name="leadAssignmentId" value={leadId} />
          <div className="grid gap-2 sm:grid-cols-2">
            <select name="channel" defaultValue="call" className={inputCls} aria-label="Channel">
              <option value="call">Call</option>
              <option value="email">Email</option>
              <option value="linkedin">LinkedIn</option>
              <option value="meeting">Meeting</option>
              <option value="note">Note</option>
              <option value="other">Other</option>
            </select>
            <input name="outcome" placeholder="Outcome (e.g. Connected)" className={inputCls} />
          </div>
          <textarea name="note" rows={2} placeholder="What happened? (optional)" className={inputCls} />
          <button type="submit" className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90">
            Log activity
          </button>
        </form>
      </section>
    </div>
  );
}

function Detail({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 sm:block">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">{icon}{label}</dt>
      <dd className="text-sm font-medium text-foreground sm:mt-0.5">{value}</dd>
    </div>
  );
}
