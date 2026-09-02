import { Check, CircleAlert, CircleDot } from "lucide-react";

import { cn } from "@/lib/utils";

export type V2StepStatus = "complete" | "current" | "upcoming" | "warning" | "error";

type V2StepperProps = {
  steps: Array<{
    id: string;
    label: string;
    description?: string;
    status: V2StepStatus;
  }>;
  className?: string;
};

const statusClassName: Record<V2StepStatus, string> = {
  complete: "border-[#16A34A] bg-[#16A34A] text-white",
  current: "border-primary bg-primary text-primary-foreground",
  upcoming: "border-border bg-card text-muted-foreground",
  warning: "border-[#F59E0B] bg-[#F59E0B] text-white",
  error: "border-destructive bg-destructive text-destructive-foreground",
};

export function V2Stepper({ steps, className }: V2StepperProps) {
  return (
    <ol className={cn("grid gap-2 md:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]", className)}>
      {steps.map((step, index) => {
        const Icon =
          step.status === "complete"
            ? Check
            : step.status === "warning" || step.status === "error"
              ? CircleAlert
              : CircleDot;

        return (
          <li key={step.id} className="relative rounded-md border border-border bg-card px-3 py-2 shadow-xs">
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  statusClassName[step.status]
                )}
              >
                <Icon className="h-3 w-3" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground">
                  {index + 1}. {step.label}
                </div>
                {step.description ? (
                  <div className="mt-0.5 text-xs text-muted-foreground">{step.description}</div>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
