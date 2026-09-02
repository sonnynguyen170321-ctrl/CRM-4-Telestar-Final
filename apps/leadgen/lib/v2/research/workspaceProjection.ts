import type { ResearchProgressPayload } from "./progress";
import type { ResearchCandidateRow, ResearchRunRow } from "./queryResearch";

export type ResearchRuntimeSource = "legacy_v2job" | "v2runtime" | "hybrid";

export type ResearchWorkspaceHealth =
  | "no_run"
  | "provider_missing"
  | "running"
  | "needs_review"
  | "has_failures"
  | "completed";

export type ResearchWorkspaceAction =
  | "launch_run"
  | "configure_provider"
  | "process_next_batch"
  | "review_candidates"
  | "open_leads"
  | "inspect_failure";

export type ResearchWorkspaceProjection = {
  run: ResearchRunRow | null;
  health: {
    state: ResearchWorkspaceHealth;
    label: string;
    detail: string;
  };
  pipeline: {
    source: ResearchRuntimeSource;
    status: string;
    cursor: number;
    totalQueries: number;
    percent: number;
    jobs: ResearchProgressPayload["jobs"];
  };
  metrics: {
    reviewable: number;
    promoted: number;
    dismissed: number;
    duplicates: number;
    enriched: number;
    withLeadAssignment: number;
  };
  candidates: ResearchCandidateRow[];
  selectedCandidate: ResearchCandidateRow | null;
  actions: {
    next: ResearchWorkspaceAction;
    label: string;
    detail: string;
    canProcess: boolean;
    canReview: boolean;
    canOpenLeads: boolean;
  };
  notifications: Array<{
    kind: "info" | "warning" | "error" | "success";
    message: string;
  }>;
};

export function deriveResearchWorkspaceProjection(input: {
  run: ResearchRunRow | null;
  candidates: ResearchCandidateRow[];
  progress: ResearchProgressPayload | null;
  selectedCandidateId?: string | null;
  runtimeSource?: ResearchRuntimeSource;
}): ResearchWorkspaceProjection {
  const selectedCandidate = input.selectedCandidateId
    ? input.candidates.find((candidate) => candidate.id === input.selectedCandidateId) ?? null
    : null;
  const jobs = input.progress?.jobs ?? { queued: 0, running: 0, failed: 0, succeeded: 0 };
  const metrics = deriveResearchWorkspaceMetrics(input.candidates);
  const health = deriveResearchWorkspaceHealth({ run: input.run, progress: input.progress, metrics });
  const next = deriveResearchWorkspaceAction({ health: health.state, jobs, metrics });

  return {
    run: input.run,
    health,
    pipeline: {
      source: input.progress?.runtime.source ?? input.runtimeSource ?? "legacy_v2job",
      status: input.progress?.status ?? input.run?.status ?? "IDLE",
      cursor: input.progress?.cursor ?? input.run?.queryCursor ?? 0,
      totalQueries: input.progress?.totalQueries ?? input.run?.queryCount ?? 0,
      percent: input.progress?.percent ?? progressPercent(input.run?.queryCursor ?? 0, input.run?.queryCount ?? 0),
      jobs,
    },
    metrics,
    candidates: input.candidates,
    selectedCandidate,
    actions: next,
    notifications: deriveResearchWorkspaceNotifications({ health: health.state, progress: input.progress, metrics }),
  };
}

export function deriveResearchWorkspaceMetrics(candidates: ResearchCandidateRow[]): ResearchWorkspaceProjection["metrics"] {
  return {
    reviewable: candidates.filter((candidate) => candidate.status === "DISCOVERED" || candidate.status === "DUPLICATE").length,
    promoted: candidates.filter((candidate) => candidate.status === "PROMOTED").length,
    dismissed: candidates.filter((candidate) => candidate.status === "DISMISSED").length,
    duplicates: candidates.filter((candidate) => candidate.status === "DUPLICATE").length,
    enriched: candidates.filter((candidate) => candidate.enrichedAt || candidate.insight).length,
    withLeadAssignment: candidates.filter((candidate) => candidate.hasLeadAssignment || candidate.leadAssignmentId).length,
  };
}

function deriveResearchWorkspaceHealth(input: {
  run: ResearchRunRow | null;
  progress: ResearchProgressPayload | null;
  metrics: ResearchWorkspaceProjection["metrics"];
}): ResearchWorkspaceProjection["health"] {
  if (!input.run) {
    return { state: "no_run", label: "No run selected", detail: "Launch or select a research run to start reviewing prospects." };
  }
  if (input.progress && !input.progress.providerConfigured) {
    return { state: "provider_missing", label: "Provider missing", detail: "Configure a search provider before live discovery can continue." };
  }
  if (input.progress?.jobs.failed || input.run.status === "FAILED") {
    return { state: "has_failures", label: "Needs attention", detail: input.progress?.errorMessage ?? input.run.errorMessage ?? "A research job failed." };
  }
  if (input.progress && (input.progress.jobs.queued > 0 || input.progress.jobs.running > 0 || input.progress.cursor < input.progress.totalQueries)) {
    return { state: "running", label: "Running", detail: "The run is still processing bounded discovery or enrichment work." };
  }
  if (input.metrics.reviewable > 0) {
    return { state: "needs_review", label: "Needs review", detail: "Review sourced prospects, run depth research, or add qualified prospects to leads." };
  }
  return { state: "completed", label: "Completed", detail: "No active research work remains for this run." };
}

function deriveResearchWorkspaceAction(input: {
  health: ResearchWorkspaceHealth;
  jobs: ResearchProgressPayload["jobs"];
  metrics: ResearchWorkspaceProjection["metrics"];
}): ResearchWorkspaceProjection["actions"] {
  if (input.health === "no_run") {
    return action("launch_run", "Launch run", "Create a company or contact research run.", false, false, false);
  }
  if (input.health === "provider_missing") {
    return action("configure_provider", "Configure provider", "Add a search provider key before processing.", false, false, input.metrics.promoted > 0);
  }
  if (input.health === "has_failures") {
    return action("inspect_failure", "Inspect failure", "Open the run timeline and retry failed work when ready.", input.jobs.queued > 0, input.metrics.reviewable > 0, input.metrics.promoted > 0);
  }
  if (input.health === "running") {
    return action("process_next_batch", "Process next batch", "Continue this run without draining other research runs.", true, input.metrics.reviewable > 0, input.metrics.promoted > 0);
  }
  if (input.metrics.reviewable > 0) {
    return action("review_candidates", "Review candidates", "Promote good-fit prospects or dismiss noisy matches.", false, true, input.metrics.promoted > 0);
  }
  if (input.metrics.promoted > 0) {
    return action("open_leads", "Open leads", "Continue with promoted prospects in the lead workspace.", false, false, true);
  }
  return action("launch_run", "Launch run", "Run a wider search to find more prospects.", false, false, false);
}

function deriveResearchWorkspaceNotifications(input: {
  health: ResearchWorkspaceHealth;
  progress: ResearchProgressPayload | null;
  metrics: ResearchWorkspaceProjection["metrics"];
}): ResearchWorkspaceProjection["notifications"] {
  const notifications: ResearchWorkspaceProjection["notifications"] = [];
  if (input.health === "provider_missing") {
    notifications.push({ kind: "warning", message: "Search provider is not configured." });
  }
  if (input.progress?.jobs.failed) {
    notifications.push({ kind: "error", message: `${input.progress.jobs.failed} research job failed.` });
  }
  if (input.metrics.reviewable > 0) {
    notifications.push({ kind: "info", message: `${input.metrics.reviewable} candidates need SDR review.` });
  }
  if (input.metrics.promoted > 0) {
    notifications.push({ kind: "success", message: `${input.metrics.promoted} candidates are already in leads.` });
  }
  return notifications;
}

function action(
  next: ResearchWorkspaceAction,
  label: string,
  detail: string,
  canProcess: boolean,
  canReview: boolean,
  canOpenLeads: boolean
): ResearchWorkspaceProjection["actions"] {
  return { next, label, detail, canProcess, canReview, canOpenLeads };
}

function progressPercent(cursor: number, totalQueries: number) {
  if (totalQueries <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((cursor / totalQueries) * 100)));
}
