"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

import { V2_NOTIFICATION_EVENT_NAME, type V2Notification } from "@/lib/v2/notifications/events";

const STORAGE_KEY = "telestar:v2:notifications";
const MAX_EVENTS = 12;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<V2Notification[]>([]);

  useEffect(() => {
    // Load persisted notifications on mount before subscribing — intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(readStored());
    function onEvent(event: Event) {
      const detail = (event as CustomEvent<V2Notification>).detail;
      if (!detail) return;
      setItems((prev) => store([detail, ...prev.filter((item) => item.id !== detail.id)].slice(0, MAX_EVENTS)));
    }
    window.addEventListener(V2_NOTIFICATION_EVENT_NAME, onEvent);
    return () => window.removeEventListener(V2_NOTIFICATION_EVENT_NAME, onEvent);
  }, []);

  const unread = items.length;
  const label = useMemo(() => unread ? `${unread} background notifications` : "Notifications", [unread]);

  return (
    <div className="relative">
      <button
        type="button"
        className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-xs transition-colors duration-200 hover:bg-muted hover:text-foreground"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unread ? <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold text-white">{Math.min(unread, 9)}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-[320px] overflow-hidden rounded-lg border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bell</div>
            {items.length ? <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setItems(store([]))}>Clear</button> : null}
          </div>
          <div className="max-h-[360px] overflow-y-auto p-2">
            {items.length ? items.map((item) => <NotificationRow key={item.id} item={item} />) : <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">No background notifications yet.</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NotificationRow({ item }: { item: V2Notification }) {
  const body = (
    <div className="rounded-md border border-border bg-background p-3 text-left transition-colors hover:bg-muted/60">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{item.title}</span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{item.kind}</span>
      </div>
      {item.description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p> : null}
      <p className="mt-2 text-[11px] text-muted-foreground">{formatNotificationTime(item.createdAt)}</p>
    </div>
  );
  return item.href ? <Link href={item.href} className="mb-2 block last:mb-0">{body}</Link> : <div className="mb-2 last:mb-0">{body}</div>;
}

function readStored(): V2Notification[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_EVENTS) : [];
  } catch {
    return [];
  }
}

function store(items: V2Notification[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  return items;
}

function formatNotificationTime(value: string) {
  return value.slice(0, 16).replace("T", " ") + " UTC";
}