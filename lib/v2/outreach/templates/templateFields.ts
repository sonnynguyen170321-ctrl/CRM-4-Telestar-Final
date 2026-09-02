export const TEMPLATE_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

export type ComposeTemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export function normalizeTemplateStatus(value: FormDataEntryValue | string | null | undefined): ComposeTemplateStatus {
  const raw = typeof value === "string" ? value.toUpperCase().trim() : "";
  return TEMPLATE_STATUSES.includes(raw as ComposeTemplateStatus) ? (raw as ComposeTemplateStatus) : "DRAFT";
}

export function parseRequiredVariables(value: FormDataEntryValue | string | null | undefined): string[] {
  const raw = typeof value === "string" ? value : "";
  return Array.from(
    new Set(
      raw
        .split(/[\n,]/)
        .map((part) => part.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

export function stringifyRequiredVariables(value: readonly string[] | null | undefined): string {
  return (value ?? []).join("\n");
}

export function templateStatusTone(status: ComposeTemplateStatus): "green" | "amber" | "slate" {
  if (status === "ACTIVE") return "green";
  if (status === "DRAFT") return "amber";
  return "slate";
}
