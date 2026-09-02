"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

export function V2DetailDrawer({
  open,
  onClose,
  children,
  widthClass = "lg:w-[640px]",
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  widthClass?: string;
  labelledBy?: string;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex justify-end bg-foreground/30"
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <button type="button" className="hidden flex-1 cursor-default lg:block" aria-label="Close drawer" onClick={onClose} />
          <motion.aside
            className={cn("flex h-full w-full flex-col border-l border-hairline bg-surface shadow-xl", widthClass)}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.24, ease: "easeOut" }}
          >
            {children}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function EntityHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  onClose,
  titleId,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  titleId?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-hairline bg-surface px-4 py-4 shadow-sm">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted-foreground">{eyebrow}</p>
        <h2 id={titleId} className="mt-1 truncate text-lg font-bold text-foreground">{title}</h2>
        {subtitle ? <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {actions}
        <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-hairline bg-surface text-foreground outline-none transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2" aria-label="Close drawer">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function DrawerSection({ title, description, children, action }: { title: string; description?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
          {description ? <p className="mt-1 text-xs text-muted-foreground/70">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function EvidenceList({
  items,
  empty,
}: {
  items: Array<{ id: string; title: ReactNode; detail?: ReactNode; meta?: ReactNode }>;
  empty: ReactNode;
}) {
  if (!items.length) {
    return <div className="rounded-lg border border-dashed border-hairline bg-secondary p-3 text-xs leading-5 text-muted-foreground">{empty}</div>;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="rounded-lg border border-hairline bg-surface p-3 shadow-sm">
          <div className="text-sm font-bold text-foreground">{item.title}</div>
          {item.detail ? <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</div> : null}
          {item.meta ? <div className="mt-2 text-[11px] text-muted-foreground">{item.meta}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function DrawerTimeline({
  items,
  empty,
}: {
  items: Array<{ id: string; label: ReactNode; status?: ReactNode; detail?: ReactNode; at?: ReactNode }>;
  empty: ReactNode;
}) {
  if (!items.length) {
    return <div className="rounded-lg border border-dashed border-hairline bg-secondary p-3 text-xs leading-5 text-muted-foreground">{empty}</div>;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="rounded-lg border border-hairline bg-surface p-3 text-xs shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-foreground/80">{item.label}</span>
            {item.status}
          </div>
          {item.detail ? <p className="mt-1 text-muted-foreground">{item.detail}</p> : null}
          {item.at ? <p className="mt-1 text-[11px] text-muted-foreground">{item.at}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function NextActionRail({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-2 border-t border-hairline bg-surface px-4 py-3 shadow-sm", className)}>{children}</div>;
}

export function RuntimeStatusStrip({
  items,
}: {
  items: Array<{ label: string; value: ReactNode; tone?: "good" | "warn" | "info" | "muted" }>;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className={cn("rounded-lg border p-3 shadow-sm", toneClass(item.tone ?? "muted"))}>
          <div className="text-[11px] font-semibold opacity-70">{item.label}</div>
          <div className="mt-1 break-words text-sm font-semibold">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function toneClass(tone: "good" | "warn" | "info" | "muted") {
  if (tone === "good") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-600";
  if (tone === "warn") return "border-amber-500/20 bg-amber-500/10 text-amber-600";
  if (tone === "info") return "border-primary/20 bg-primary/10 text-primary";
  return "border-hairline bg-secondary text-foreground";
}
