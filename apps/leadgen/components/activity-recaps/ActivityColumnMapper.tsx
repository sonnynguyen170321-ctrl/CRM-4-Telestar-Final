"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  canonicalActivityFields,
  suggestionsToMapping,
} from "@/lib/activityRecaps/mapping";
import type {
  ActivityColumnMapping,
  ActivityColumnMappingSuggestion,
  CanonicalActivityField,
} from "@/lib/activityRecaps/types";

type ActivityColumnMapperProps = {
  headers: string[];
  suggestions: ActivityColumnMappingSuggestion[];
  mapping: ActivityColumnMapping;
  onMappingChange: (mapping: ActivityColumnMapping) => void;
};

export function ActivityColumnMapper({
  headers,
  suggestions,
  mapping,
  onMappingChange,
}: ActivityColumnMapperProps) {
  const suggestionByField = new Map(
    suggestions.map((suggestion) => [suggestion.canonicalField, suggestion])
  );

  function setSingleField(field: CanonicalActivityField, column: string) {
    onMappingChange({
      ...mapping,
      [field]: column ? [column] : [],
    });
  }

  function toggleNoteColumn(column: string, checked: boolean) {
    const current = new Set(mapping.noteCombined ?? []);
    if (checked) {
      current.add(column);
    } else {
      current.delete(column);
    }

    onMappingChange({
      ...mapping,
      noteCombined: Array.from(current),
    });
  }

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle>Column mapping</CardTitle>
        <CardDescription>
          Review auto-detected headers and adjust any mappings before
          standardizing activity rows.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => onMappingChange(suggestionsToMapping(suggestions))}
          >
            Reset to suggestions
          </button>
          <span className="text-xs text-slate-500">
            Required fields can stay blank for preview, but rows may show
            Unknown SDR or missing lead/company warnings.
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {canonicalActivityFields.map(({ field, label, required, allowMultiple }) => {
            const suggestion = suggestionByField.get(field);
            const selected = mapping[field] ?? [];

            return (
              <div
                key={field}
                className="rounded-xl border border-slate-200 bg-slate-50/50 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <label
                      className="text-sm font-semibold text-slate-900"
                      htmlFor={`activity-map-${field}`}
                    >
                      {label}
                    </label>
                    {required ? (
                      <span className="ml-2 text-xs font-medium text-rose-600">
                        Required
                      </span>
                    ) : null}
                  </div>
                  <ConfidenceBadge confidence={suggestion?.confidence ?? 0} />
                </div>

                {allowMultiple ? (
                  <div className="mt-3 max-h-36 space-y-2 overflow-auto rounded-lg border border-slate-200 bg-white p-2">
                    {headers.map((header) => (
                      <label
                        key={header}
                        className="flex items-center gap-2 text-xs text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(header)}
                          onChange={(event) =>
                            toggleNoteColumn(header, event.target.checked)
                          }
                        />
                        <span className="truncate">{header}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <select
                    id={`activity-map-${field}`}
                    className="mt-2 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    value={selected[0] ?? ""}
                    onChange={(event) => setSingleField(field, event.target.value)}
                  >
                    <option value="">Do not map</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                )}

                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {suggestion?.reason ?? "No suggestion available."}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const className =
    confidence >= 85
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : confidence >= 55
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <Badge variant="outline" className={className}>
      {confidence > 0 ? `${confidence}%` : "No match"}
    </Badge>
  );
}

