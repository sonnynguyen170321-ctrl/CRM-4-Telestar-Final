import Link from "next/link";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type V2DetailDrawerProps = {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  closeHref?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function V2DetailDrawer({
  open,
  title,
  subtitle,
  closeHref,
  actions,
  footer,
  children,
  className,
}: V2DetailDrawerProps) {
  if (!open) {
    return null;
  }

  return (
    <aside
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-card shadow-2xl sm:max-w-2xl xl:max-w-3xl",
        className
      )}
      aria-label="Detail drawer"
    >
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-foreground">{title}</h2>
          {subtitle ? (
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {closeHref ? (
            <Link
              href={closeHref}
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
              aria-label="Close drawer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer ? (
        <footer className="border-t border-border bg-card px-5 py-3">{footer}</footer>
      ) : null}
    </aside>
  );
}
