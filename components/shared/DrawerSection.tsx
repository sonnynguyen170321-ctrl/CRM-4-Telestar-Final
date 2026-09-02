import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type DrawerSectionProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function DrawerSection({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: DrawerSectionProps) {
  const hasHeader = title || description || actions;

  return (
    <section
      className={cn(
        "rounded-md border border-border bg-card p-4 shadow-xs",
        className
      )}
    >
      {hasHeader ? (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? (
              <h3 className="text-sm font-semibold text-foreground">
                {title}
              </h3>
            ) : null}
            {description ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn("space-y-3", contentClassName)}>{children}</div>
    </section>
  );
}
