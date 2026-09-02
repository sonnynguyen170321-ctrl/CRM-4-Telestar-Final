"use client";

import { useState, useTransition } from "react";
import { UserPlus, ShieldCheck, Ban, RotateCcw } from "lucide-react";

import { PanelCard } from "@/components/shared/PanelCard";
import { createUserAction, setUserRoleAction, setUserStatusAction } from "@/app/v2/settings/actions";
import type { OrgUser } from "@/lib/v2/tenant/manageUsers";

const ROLES = ["OWNER", "ADMIN", "MANAGER", "TEAM_LEAD", "SDR", "VIEWER"] as const;

export function UsersPanel({
  users,
  canManage,
  currentUserId,
}: {
  users: OrgUser[];
  canManage: boolean;
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; tempPassword: string } | null>(null);
  const [showForm, setShowForm] = useState(false);

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createUserAction(fd);
      if (res.ok) {
        setCreated({ email: fd.get("email") as string, tempPassword: res.tempPassword });
        setShowForm(false);
      } else setError(res.error);
    });
  }

  function mutate(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await action(fd);
      if (!res.ok && res.error) setError(res.error);
    });
  }

  return (
    <PanelCard
      title="Users & roles"
      actions={
        canManage ? (
          <button
            type="button"
            onClick={() => { setShowForm((v) => !v); setCreated(null); }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/95 shadow-sm transition-colors"
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> Add user
          </button>
        ) : null
      }
      contentClassName="p-0"
    >
      {error ? <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-700">{error}</div> : null}
      {created ? (
        <div className="border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-800">
          Created <strong>{created.email}</strong>. Temporary password:{" "}
          <code className="rounded bg-surface border border-hairline px-1.5 py-0.5 font-mono text-emerald-900">{created.tempPassword}</code>{" "}
          — share it securely; they should change it after first login.
        </div>
      ) : null}

      {showForm && canManage ? (
        <form onSubmit={onCreate} className="grid gap-2 border-b border-hairline bg-surface-raised/40 p-4 sm:grid-cols-2">
          <input name="name" placeholder="Full name" required className={inputCls} />
          <input name="email" type="email" placeholder="email@company.com" required className={inputCls} />
          <select name="role" defaultValue="SDR" className={inputCls}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input name="tempPassword" placeholder="Temp password (optional, ≥10 chars)" className={inputCls} />
          <div className="sm:col-span-2">
            <button type="submit" disabled={pending} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm">
              {pending ? "Creating…" : "Create user"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="divide-y divide-hairline bg-surface">
        {users.map((u) => {
          const isSelf = u.userId === currentUserId;
          const disabled = u.status === "DISABLED";
          return (
            <div key={u.membershipId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  {u.name ?? u.email}
                  {isSelf ? <span className="rounded-md bg-secondary border border-hairline px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">You</span> : null}
                  {disabled ? <span className="rounded-md bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">Disabled</span> : null}
                </div>
                <div className="text-xs text-muted-foreground">{u.email}{u.hasCredential ? "" : " · no password set"}</div>
              </div>
              <div className="flex items-center gap-2">
                {canManage && !isSelf ? (
                  <select
                    defaultValue={u.role}
                    disabled={pending}
                    onChange={(e) => {
                      const fd = new FormData();
                      fd.set("userId", u.userId);
                      fd.set("role", e.target.value);
                      mutate(setUserRoleAction, fd);
                    }}
                    className="h-8 rounded-md border border-hairline bg-surface px-2 text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
                    aria-label={`Role for ${u.email}`}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md bg-secondary border border-hairline px-2 py-1 text-xs font-semibold text-muted-foreground">
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" />{u.role}
                  </span>
                )}
                {canManage && !isSelf ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("userId", u.userId);
                      fd.set("status", disabled ? "ACTIVE" : "DISABLED");
                      mutate(setUserStatusAction, fd);
                    }}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${disabled ? "text-emerald-600 hover:bg-emerald-500/10" : "text-red-600 hover:bg-red-500/10"}`}
                  >
                    {disabled ? <><RotateCcw className="h-3 w-3" aria-hidden="true" />Reactivate</> : <><Ban className="h-3 w-3" aria-hidden="true" />Disable</>}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {users.length === 0 ? <div className="px-4 py-6 text-center text-sm text-muted-foreground">No users.</div> : null}
      </div>
    </PanelCard>
  );
}

const inputCls = "h-9 w-full rounded-md border border-hairline bg-surface px-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors";
