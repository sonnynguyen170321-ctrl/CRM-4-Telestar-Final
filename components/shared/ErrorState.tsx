import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ErrorStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
};

export function ErrorState({
  title,
  description,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-56 flex-col items-center justify-center rounded-md border border-red-200 bg-red-50 px-6 py-10 text-center",
        className
      )}
    >
      <AlertTriangle className="h-8 w-8 text-red-600" aria-hidden="true" />
      <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
