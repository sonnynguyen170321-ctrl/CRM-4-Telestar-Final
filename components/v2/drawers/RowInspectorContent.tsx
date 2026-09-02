import { DrawerSection } from "./V2DetailDrawer";

type IdentityMatch = {
  kind: string;
  confidence: number;
  reasons: string[];
} | null;

type RowInspectorData = {
  id: string;
  sourceRowNumber: number;
  rowStatus: string;
  rawRowJson: unknown;
  normalizedRowJson: unknown;
  matchedCompanyName: string | null;
  matchedContactName: string | null;
  matchedCompanyId: string | null;
  matchedContactId: string | null;
  errorMessage: string | null;
};

export function RowInspectorContent({ row }: { row: RowInspectorData }) {
  const identity = getIdentityMatch(row.normalizedRowJson);

  return (
    <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
      <DrawerSection title="Linked records">
        <dl className="grid gap-2 rounded-md border p-3 text-sm shadow-sm">
          <Row label="Matched company" value={row.matchedCompanyName ?? row.matchedCompanyId ?? "Not linked"} />
          <Row label="Matched contact" value={row.matchedContactName ?? row.matchedContactId ?? "Not linked"} />
          <Row label="Identity kind" value={identity ? identity.kind : "Not evaluated"} />
          <Row label="Identity confidence" value={identity ? String(identity.confidence) : "\u2014"} />
        </dl>
      </DrawerSection>

      {identity && identity.reasons.length > 0 ? (
        <DrawerSection title="Identity reasons">
          <ul className="space-y-1 rounded-md border p-3 text-sm text-muted-foreground shadow-sm">
            {identity.reasons.map((reason, index) => (
              <li key={`${reason}-${index}`} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </DrawerSection>
      ) : null}

      {row.errorMessage ? (
        <DrawerSection title="Error">
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 shadow-sm">
            {row.errorMessage}
          </div>
        </DrawerSection>
      ) : null}

      <DrawerSection title="Raw row">
        <JsonBlock value={row.rawRowJson} />
      </DrawerSection>

      <DrawerSection title="Normalized row">
        <JsonBlock value={row.normalizedRowJson} />
      </DrawerSection>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-foreground">{value}</dd>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <div className="rounded-md border border-border bg-foreground p-3 shadow-sm">
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
        {formatJson(value)}
      </pre>
    </div>
  );
}

function RowStatusBadge({ status }: { status: string }) {
  const tone = status === "ERROR"
    ? "border-red-200 bg-red-50 text-red-700"
    : status === "MATCHED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-border bg-muted/40 text-muted-foreground";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {status}
    </span>
  );
}

function formatJson(value: unknown) {
  if (value === null || value === undefined) return "Not recorded";
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
}

function getIdentityMatch(value: unknown): IdentityMatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const identityMatch = (value as { identityMatch?: unknown }).identityMatch;
  if (!identityMatch || typeof identityMatch !== "object" || Array.isArray(identityMatch)) return null;
  const parsed = identityMatch as { kind?: unknown; confidence?: unknown; reasons?: unknown };
  return {
    kind: typeof parsed.kind === "string" ? parsed.kind : "unknown",
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    reasons: Array.isArray(parsed.reasons)
      ? parsed.reasons.filter((reason): reason is string => typeof reason === "string")
      : [],
  };
}
