"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Pause, Play, Trash2, X } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/v2/format/datetime";

import {
  pauseEnrollmentsAction,
  resumeEnrollmentsAction,
  removeEnrollmentsAction,
} from "@/app/v2/outreach/campaigns/[campaignId]/leads/actions";

type Detail = {
  enrollment: {
    id: string;
    status: string;
    currentStepOrdinal: number;
    nextStepAt: string | null;
    email: string | null;
    enrolledAt: string | null;
    contactName: string | null;
    companyName: string | null;
  };
  messages: Array<{ id: string; status: string; subject: string | null; toAddress: string | null; sentAt: string | null; createdAt: string | null }>;
  activities: Array<{ id: string; eventKind: string; channel: string; occurredAt: string | null }>;
};

// Per-lead enrollment drawer (opened from the leads table). Fetches detail + message
// history + activity timeline; admins get inline pause/resume/remove. Mounted with a
// `key={enrollmentId}` so state is fresh per open.
export function EnrollmentRowDrawer({
  campaignId,
  enrollmentId,
  isAdmin,
  onClose,
  onActed,
}: {
  campaignId: string;
  enrollmentId: string;
  isAdmin: boolean;
  onClose: () => void;
  onActed: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "idle">("loading");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    fetch(`/v2/outreach/campaigns/${campaignId}/enrollments/${enrollmentId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.ok) {
          setData(body as Detail);
          setStatus("idle");
        } else setStatus("error");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, enrollmentId]);

  function act(fn: (campaignId: string, ids: string[]) => Promise<{ changed: number }>) {
    startTransition(async () => {
      await fn(campaignId, [enrollmentId]);
      onActed();
      onClose();
    });
  }

  const e = data?.enrollment;

  return (
    <>
      <button type="button" aria-label="Close" className="fixed inset-0 z-30 cursor-default bg-foreground/20" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Enrollment</div>
            <h2 className="mt-0.5 truncate text-lg font-semibold text-foreground">{e?.contactName ?? "Lead"}</h2>
            <div className="truncate text-xs text-muted-foreground">{e?.email ?? ""}{e?.companyName ? ` · ${e.companyName}` : ""}</div>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {status === "loading" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : null}
          {status === "error" ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Could not load enrollment.</div> : null}

          {e ? (
            <>
              <dl className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <Row label="Status" value={e.status} />
                <Row label="Current step" value={`Step ${e.currentStepOrdinal + 1}`} />
                <Row label="Next send" value={e.nextStepAt ? formatDateTime(e.nextStepAt) : "—"} />
                <Row label="Enrolled" value={e.enrolledAt ? formatDate(e.enrolledAt) : "—"} />
              </dl>

              <Section title={`Messages (${data!.messages.length})`}>
                {data!.messages.length === 0 ? (
                  <Empty>No messages sent yet.</Empty>
                ) : (
                  <ul className="space-y-1.5">
                    {data!.messages.map((m) => (
                      <li key={m.id} className="rounded-md border border-border bg-white p-2.5 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium text-foreground">{m.subject ?? "(no subject)"}</span>
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{m.status}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{m.sentAt ? formatDateTime(m.sentAt) : formatDateTime(m.createdAt ?? "")}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={`Activity (${data!.activities.length})`}>
                {data!.activities.length === 0 ? (
                  <Empty>No activity yet.</Empty>
                ) : (
                  <ul className="space-y-1">
                    {data!.activities.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                        <span>{a.eventKind.replace("outreach.", "")} <span className="text-muted-foreground">· {a.channel}</span></span>
                        <span className="text-xs text-muted-foreground">{a.occurredAt ? formatDate(a.occurredAt) : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          ) : null}
        </div>

        {isAdmin && e ? (
          <div className="flex items-center gap-2 border-t border-border px-5 py-3">
            <ActionBtn onClick={() => act(resumeEnrollmentsAction)} disabled={pending} icon={Play} label="Resume" tone="emerald" />
            <ActionBtn onClick={() => act(pauseEnrollmentsAction)} disabled={pending} icon={Pause} label="Pause" tone="amber" />
            <ActionBtn onClick={() => act(removeEnrollmentsAction)} disabled={pending} icon={Trash2} label="Remove" tone="red" />
            {pending ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : null}
          </div>
        ) : null}
      </aside>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-foreground">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">{children}</div>;
}

function ActionBtn({
  onClick,
  disabled,
  icon: Icon,
  label,
  tone,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: typeof Play;
  label: string;
  tone: "emerald" | "amber" | "red";
}) {
  const cls = { emerald: "text-emerald-700 hover:bg-emerald-50", amber: "text-amber-700 hover:bg-amber-50", red: "text-red-700 hover:bg-red-50" }[tone];
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border text-sm font-medium transition-colors disabled:opacity-50 ${cls}`}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}
