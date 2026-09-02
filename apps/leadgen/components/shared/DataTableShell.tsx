import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type DataTableShellProps = {
  title?: string;
  description?: string;
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function DataTableShell({
  title,
  description,
  toolbar,
  footer,
  children,
  className,
}: DataTableShellProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-md border border-border bg-card shadow-xs",
        className
      )}
    >
      {title || description || toolbar ? (
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
        </div>
      ) : null}
      <div className="overflow-x-auto">{children}</div>
      {footer ? <div className="border-t border-border px-4 py-3">{footer}</div> : null}
    </section>
  );
}
