"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  localFeedbackCompanyTypes,
  localFeedbackQualifications,
  type LocalFeedbackExample,
} from "@/lib/feedback";
import type { CompanyScoreResult, CompanyType, Qualification } from "@/lib/types";

type LocalFeedbackPanelProps = {
  company: CompanyScoreResult;
  onSave: (feedback: {
    final_company_score: number;
    final_company_type: CompanyType;
    final_qualification: Qualification;
    final_note: string;
  }) => void | Promise<void>;
  savedFeedback?: LocalFeedbackExample;
  canPersistFeedback?: boolean;
};

export function LocalFeedbackPanel({
  company,
  onSave,
  savedFeedback,
  canPersistFeedback = false,
}: LocalFeedbackPanelProps) {
  const [finalQualification, setFinalQualification] = useState<Qualification>(
    savedFeedback?.final_qualification ?? company.qualification
  );
  const [finalType, setFinalType] = useState<CompanyType>(
    savedFeedback?.final_company_type ?? company.type
  );
  const [finalScore, setFinalScore] = useState(
    String(savedFeedback?.final_company_score ?? company.company_score)
  );
  const [finalNote, setFinalNote] = useState(savedFeedback?.final_note ?? "");
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "failed"
  >(savedFeedback ? "saved" : "idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  async function saveFeedback() {
    const trimmedScore = finalScore.trim();

    if (trimmedScore.length === 0) {
      setScoreError("Final score is required.");
      return;
    }

    const numericScore = Number(trimmedScore);

    if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
      setScoreError("Final score must be a number from 0 to 100.");
      return;
    }

    setScoreError(null);
    setSaveStatus("saving");
    setSaveError(null);

    try {
      await onSave({
        final_company_score: Math.round(numericScore),
        final_company_type: finalType,
        final_qualification: finalQualification,
        final_note: finalNote,
      });
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("failed");
      setSaveError(
        error instanceof Error ? error.message : "Feedback save failed."
      );
    }
  }

  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Local correction for {company.company_name}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {canPersistFeedback
              ? "Corrections are saved as SDR feedback examples and will appear in /companies."
              : "Save company rows first before saving SDR feedback."}
          </p>
        </div>
        {savedFeedback && (
          <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
            Feedback saved
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            Final qualification
          </label>
          <Select value={finalQualification} onValueChange={(value) => setFinalQualification(value as Qualification)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {localFeedbackQualifications.map((qualification) => (
                <SelectItem key={qualification} value={qualification}>
                  {qualification}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            Final company type
          </label>
          <Select value={finalType} onValueChange={(value) => setFinalType(value as CompanyType)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {localFeedbackCompanyTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            Final score
          </label>
          <Input
            type="number"
            min={0}
            max={100}
            value={finalScore}
            onChange={(event) => setFinalScore(event.target.value)}
          />
          {scoreError && <p className="text-xs text-destructive">{scoreError}</p>}
        </div>

        <div className="grid gap-2 md:row-span-2">
          <label className="text-xs font-medium text-muted-foreground">
            Reviewer note
          </label>
          <Textarea
            value={finalNote}
            onChange={(event) => setFinalNote(event.target.value)}
            placeholder="Add local review context"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void saveFeedback()}
          disabled={saveStatus === "saving" || !canPersistFeedback}
        >
          {saveStatus === "saving" ? "Saving feedback" : "Save SDR feedback"}
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          Saving creates a FeedbackExample only. It does not mutate the local
          score result or trigger AI/retraining.
        </p>
      </div>
      {saveStatus === "saved" && (
        <p className="mt-3 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          Feedback saved. /companies and exports will use this SDR final overlay.
        </p>
      )}
      {saveStatus === "failed" && saveError && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {saveError}
        </p>
      )}
    </div>
  );
}
