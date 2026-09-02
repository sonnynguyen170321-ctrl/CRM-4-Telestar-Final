import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PanelCardProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function PanelCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: PanelCardProps) {
  const hasHeader = title || description || actions;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-xl shadow-sm transition-shadow hover:shadow-md",
        className
      )}
    >
      {hasHeader ? (
        <div className="flex flex-col gap-3 border-b border-border/50 bg-background/50 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-[14px] font-bold text-foreground tracking-tight">
                {title}
              </h2>
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
      <div className={cn("p-5", contentClassName)}>{children}</div>
    </section>
  );
}
