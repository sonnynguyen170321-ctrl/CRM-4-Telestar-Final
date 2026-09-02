import { Circle } from "lucide-react";

import { cn } from "@/lib/utils";
import { getTaskTransitionView, taskToneClasses } from "@/components/v2/shared/taskTransition";

export type PipelineStepStatus = "done" | "active" | "pending" | "error";

export type PipelineStep = {
  key: string;
  label: string;
  status: PipelineStepStatus;
  detail?: string;
};

// Each middle step is backed by a real V2Job row; no fabricated stages. Upload is
// synthetic (the ingestion job exists) and Done reflects the ingestion job's terminal status.

export function PipelineStepper({ steps }: { steps: PipelineStep[] }) {
  return (
    <ol className="flex items-stretch gap-2 overflow-x-auto rounded-md border border-border bg-muted/40 p-3">
      {steps.map((step, index) => (
        <li key={step.key} className="flex min-w-[112px] flex-1 flex-col items-center text-center">
          <div className="flex w-full items-center">
            <span
              className={cn(
                "h-0.5 flex-1 rounded-full",
                index === 0 ? "bg-transparent" : connectorClass(steps[index - 1].status)
              )}
              aria-hidden="true"
            />
            <StepDot status={step.status} index={index} />
            <span
              className={cn(
                "h-0.5 flex-1 rounded-full",
                index === steps.length - 1 ? "bg-transparent" : connectorClass(step.status)
              )}
              aria-hidden="true"
            />
          </div>
          <div className="mt-1.5 px-1">
            <div className={cn("text-xs font-semibold leading-4", stepTextClass(step.status))}>{step.label}</div>
            {step.detail ? <div className="mt-0.5 text-[10px] leading-3 text-muted-foreground">{step.detail}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepDot({ status, index }: { status: PipelineStepStatus; index: number }) {
  const lifecycle = stepLifecycleStatus(status);
  const view = getTaskTransitionView(lifecycle);
  const tone = taskToneClasses(view.tone);
  const Icon = view.icon;
  const base = "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 shadow-sm";

  if (status === "pending") {
    return (
      <span className={cn(base, "border-border bg-surface text-muted-foreground")}>
        <span className="text-xs font-semibold">{index + 1}</span>
        <Circle className="hidden" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className={cn(base, tone.iconTile, status === "done" ? "border-emerald-500" : status === "error" ? "border-red-500" : "border-primary/20")}>
      <Icon className={cn("h-4 w-4", view.inFlight && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
    </span>
  );
}

function stepLifecycleStatus(status: PipelineStepStatus) {
  if (status === "done") return "SUCCEEDED";
  if (status === "active") return "RUNNING";
  if (status === "error") return "FAILED";
  return "QUEUED";
}

function stepTextClass(status: PipelineStepStatus) {
  if (status === "done") return taskToneClasses("success").text;
  if (status === "active") return taskToneClasses("info").text;
  if (status === "error") return taskToneClasses("danger").text;
  return "text-muted-foreground";
}

function connectorClass(status: PipelineStepStatus) {
  return status === "done"
    ? "bg-emerald-300"
    : status === "active"
      ? "bg-primary"
      : status === "error"
        ? "bg-red-300"
        : "bg-muted";
}