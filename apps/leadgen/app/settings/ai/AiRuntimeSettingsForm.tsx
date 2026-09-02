"use client";

import { useState } from "react";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";

type AiRuntimeSettingsFormProps = {
  initialEnabled: boolean;
  initialMode: "disabled" | "uncertain_only" | "all_companies";
  initialMaxRowsPerUpload: number;
};

type AiStatusResponse = {
  enabled: boolean;
  mode: "disabled" | "uncertain_only" | "all_companies";
  maxRowsPerUpload: number;
};

export function AiRuntimeSettingsForm({
  initialEnabled,
  initialMode,
  initialMaxRowsPerUpload,
}: AiRuntimeSettingsFormProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [mode, setMode] = useState<"uncertain_only" | "all_companies">(
    initialMode === "uncertain_only" ? "uncertain_only" : "all_companies"
  );
  const [maxRowsPerUpload, setMaxRowsPerUpload] = useState(
    String(initialMaxRowsPerUpload)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveSettings() {
    setIsSaving(true);
    setMessage(null);
    setError(null);

    try {
      const parsedMaxRows = Number(maxRowsPerUpload);
      const response = await fetch("/api/ai/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled,
          scoringMode: mode,
          maxRowsPerUpload: parsedMaxRows,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as
        | { data?: AiStatusResponse; error?: string }
        | Record<string, never>;

      if (!response.ok) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "AI settings could not be saved."
        );
      }

      if ("data" in body && body.data) {
        setEnabled(body.data.enabled);
        setMode(
          body.data.mode === "uncertain_only"
            ? "uncertain_only"
            : "all_companies"
        );
        setMaxRowsPerUpload(String(body.data.maxRowsPerUpload));
      }

      setMessage("AI runtime settings saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "AI settings could not be saved."
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-2 rounded-md border p-3">
          <span className="block text-sm font-medium">AI enabled</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={enabled ? "true" : "false"}
            onChange={(event) => setEnabled(event.target.value === "true")}
          >
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </select>
        </label>

        <label className="space-y-2 rounded-md border p-3">
          <span className="block text-sm font-medium">AI scoring mode</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={mode}
            onChange={(event) =>
              setMode(
                event.target.value === "uncertain_only"
                  ? "uncertain_only"
                  : "all_companies"
              )
            }
          >
            <option value="all_companies">All companies</option>
            <option value="uncertain_only">Uncertain only</option>
          </select>
        </label>

        <label className="space-y-2 rounded-md border p-3">
          <span className="block text-sm font-medium">Max rows per upload</span>
          <input
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            min={1}
            max={5000}
            type="number"
            value={maxRowsPerUpload}
            onChange={(event) => setMaxRowsPerUpload(event.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={saveSettings} disabled={isSaving}>
          <Save className="h-4 w-4" />
          {isSaving ? "Saving" : "Save runtime AI settings"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Provider, model, and API key still come from server environment
          variables. The key is never shown or editable here.
        </p>
      </div>

      {message && (
        <div className="rounded-md border bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
