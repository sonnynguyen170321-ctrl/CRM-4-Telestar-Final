"use client";

import { useState } from "react";
import { PlugZap } from "lucide-react";

import { Button } from "@/components/ui/button";

type AiTestResult = {
  success: boolean;
  provider: string;
  model: string;
  text: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
};

export function AiConnectionTest() {
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<AiTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function testConnection() {
    setIsTesting(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch("/api/ai/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: "Say pong in one short sentence.",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as
        | AiTestResult
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "AI connection test failed."
        );
      }

      if (!("success" in body) || !body.success) {
        throw new Error("AI connection test response was not successful.");
      }

      setResult(body);
    } catch (testError) {
      setError(
        testError instanceof Error
          ? testError.message
          : "AI connection test failed."
      );
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button type="button" onClick={testConnection} disabled={isTesting}>
        <PlugZap className="h-4 w-4" />
        {isTesting ? "Testing connection" : "Test connection"}
      </Button>

      {result && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <p className="font-medium text-foreground">Connection test passed</p>
          <div className="mt-2 grid gap-2 text-muted-foreground sm:grid-cols-2">
            <StatusLine label="Provider" value={result.provider} />
            <StatusLine label="Model" value={result.model} />
            <StatusLine
              label="Latency"
              value={`${result.latencyMs.toLocaleString()} ms`}
            />
            <StatusLine
              label="Tokens"
              value={`${result.inputTokens ?? "?"} in / ${
                result.outputTokens ?? "?"
              } out`}
            />
          </div>
          <p className="mt-3 text-muted-foreground">{result.text}</p>
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

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="font-medium text-foreground">{label}:</span> {value}
    </p>
  );
}
