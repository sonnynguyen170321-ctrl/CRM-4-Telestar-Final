import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <section
      className={cn(
        "relative mb-6 px-5 sm:px-6 pt-6 pb-4 border-b border-hairline bg-glass backdrop-blur-md shadow-sm",
        className
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent opacity-60 pointer-events-none" />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-6 items-center rounded-full bg-primary/10 px-2.5 text-[11px] font-semibold tracking-wide text-primary">
                {eyebrow}
              </span>
            </div>
          ) : null}
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground lg:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0 relative z-10">{actions}</div> : null}
      </div>
    </section>
  );
}
