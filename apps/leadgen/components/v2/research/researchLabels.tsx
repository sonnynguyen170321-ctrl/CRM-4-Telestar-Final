// Humanized labels + tones for research candidate/run enums, so raw strings like "DISCOVERED"
// never reach the UI. Single source used by the grid, drawer, and rail.

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export function candidateStatusMeta(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "DISCOVERED": return { label: "New", tone: "info" };
    case "DUPLICATE": return { label: "Seen before", tone: "warning" };
    case "PROMOTED": return { label: "In pipeline", tone: "success" };
    case "DISMISSED": return { label: "Dismissed", tone: "neutral" };
    default: return { label: status, tone: "neutral" };
  }
}

export function runStatusMeta(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "SUCCEEDED": return { label: "Done", tone: "success" };
    case "RUNNING": return { label: "Running", tone: "info" };
    case "QUEUED": return { label: "Queued", tone: "neutral" };
    case "FAILED": return { label: "Failed", tone: "danger" };
    default: return { label: status, tone: "neutral" };
  }
}

export function prospectKindLabel(kind: string): string {
  return kind === "CONTACT" ? "New contact" : "New company";
}

export function emailStatusMeta(status: string | null): { label: string; tone: Tone } | null {
  if (!status) return null;
  switch (status) {
    case "VERIFIED": return { label: "verified", tone: "success" };
    case "GUESSED": return { label: "guessed", tone: "warning" };
    case "INVALID": return { label: "invalid", tone: "danger" };
    default: return { label: "unverified", tone: "neutral" };
  }
}
