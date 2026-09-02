import "server-only";

import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/server/prisma";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type ResearchEvidenceInput = {
  organizationId: string;
  runId?: string | null;
  candidateId?: string | null;
  idempotencyKey: string;
  sourceKind: string;
  provider?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  sourceSnippet?: string | null;
  query?: string | null;
  confidence?: number | null;
  evidenceJson?: JsonValue;
};

export type ResearchFieldObservationInput = {
  organizationId: string;
  candidateId: string;
  evidenceId?: string | null;
  fieldName: string;
  valueText?: string | null;
  valueJson?: JsonValue;
  confidence?: number | null;
  sourceKind: string;
};

export type ResearchProviderAttemptInput = {
  organizationId: string;
  runId?: string | null;
  candidateId?: string | null;
  stage: string;
  provider: string;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  requestJson?: JsonValue;
  responseJson?: JsonValue;
  errorMessage?: string | null;
  startedAt?: Date;
  finishedAt?: Date | null;
};

export type ResearchEmailPatternInput = {
  organizationId: string;
  domain: string;
  pattern: string;
  confidence: number;
  sampleCount?: number;
  sourceJson?: JsonValue;
};

export async function recordResearchEvidence(input: ResearchEvidenceInput): Promise<string> {
  const id = createId("rev");
  await prisma.$executeRaw`
    INSERT INTO "V2ResearchEvidence" (
      "id", "organizationId", "runId", "candidateId", "idempotencyKey", "sourceKind",
      "provider", "sourceUrl", "sourceTitle", "sourceSnippet", "query", "confidence", "evidenceJson"
    )
    VALUES (
      ${id}, ${input.organizationId}, ${input.runId ?? null}, ${input.candidateId ?? null}, ${input.idempotencyKey}, ${input.sourceKind},
      ${input.provider ?? null}, ${input.sourceUrl ?? null}, ${input.sourceTitle ?? null}, ${input.sourceSnippet ?? null},
      ${input.query ?? null}, ${input.confidence ?? null}, ${toJson(input.evidenceJson)}::jsonb
    )
    ON CONFLICT ("organizationId", "idempotencyKey") DO UPDATE
    SET "candidateId" = COALESCE(EXCLUDED."candidateId", "V2ResearchEvidence"."candidateId"),
        "provider" = COALESCE(EXCLUDED."provider", "V2ResearchEvidence"."provider"),
        "sourceUrl" = COALESCE(EXCLUDED."sourceUrl", "V2ResearchEvidence"."sourceUrl"),
        "sourceTitle" = COALESCE(EXCLUDED."sourceTitle", "V2ResearchEvidence"."sourceTitle"),
        "sourceSnippet" = COALESCE(EXCLUDED."sourceSnippet", "V2ResearchEvidence"."sourceSnippet"),
        "query" = COALESCE(EXCLUDED."query", "V2ResearchEvidence"."query"),
        "confidence" = COALESCE(EXCLUDED."confidence", "V2ResearchEvidence"."confidence"),
        "evidenceJson" = COALESCE(EXCLUDED."evidenceJson", "V2ResearchEvidence"."evidenceJson")
  `;
  return id;
}

export async function recordResearchFieldObservation(input: ResearchFieldObservationInput): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "V2ResearchFieldObservation" (
      "id", "organizationId", "candidateId", "evidenceId", "fieldName",
      "valueText", "valueJson", "confidence", "sourceKind"
    )
    VALUES (
      ${createId("rfo")}, ${input.organizationId}, ${input.candidateId}, ${input.evidenceId ?? null}, ${input.fieldName},
      ${input.valueText ?? null}, ${toJson(input.valueJson)}::jsonb, ${input.confidence ?? null}, ${input.sourceKind}
    )
  `;
}

export async function recordResearchProviderAttempt(input: ResearchProviderAttemptInput): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "V2ResearchProviderAttempt" (
      "id", "organizationId", "runId", "candidateId", "stage", "provider", "status",
      "requestJson", "responseJson", "errorMessage", "startedAt", "finishedAt"
    )
    VALUES (
      ${createId("rpa")}, ${input.organizationId}, ${input.runId ?? null}, ${input.candidateId ?? null},
      ${input.stage}, ${input.provider}, ${input.status}, ${toJson(input.requestJson)}::jsonb,
      ${toJson(input.responseJson)}::jsonb, ${input.errorMessage ?? null}, ${input.startedAt ?? new Date()},
      ${input.finishedAt ?? new Date()}
    )
  `;
}


export type ResearchEmailPatternRow = {
  pattern: string;
  confidence: number;
  sampleCount: number;
};

export async function listResearchEmailPatterns(organizationId: string, domain: string, limit = 5): Promise<ResearchEmailPatternRow[]> {
  const cleanDomain = domain.trim().toLowerCase();
  if (!organizationId || !cleanDomain) return [];
  return prisma.v2ResearchEmailPattern.findMany({
    where: { organizationId, domain: cleanDomain },
    orderBy: [{ confidence: "desc" }, { sampleCount: "desc" }, { lastSeenAt: "desc" }],
    take: Math.max(1, Math.min(20, limit)),
    select: { pattern: true, confidence: true, sampleCount: true },
  });
}
export async function upsertResearchEmailPattern(input: ResearchEmailPatternInput): Promise<void> {
  const domain = input.domain.trim().toLowerCase();
  const pattern = input.pattern.trim().toLowerCase();
  if (!domain || !pattern) return;

  await prisma.$executeRaw`
    INSERT INTO "V2ResearchEmailPattern" (
      "id", "organizationId", "domain", "pattern", "confidence", "sampleCount", "sourceJson", "lastSeenAt", "updatedAt"
    )
    VALUES (
      ${createId("rep")}, ${input.organizationId}, ${domain}, ${pattern}, ${clampConfidence(input.confidence)},
      ${Math.max(0, input.sampleCount ?? 1)}, ${toJson(input.sourceJson)}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organizationId", "domain", "pattern") DO UPDATE
    SET "confidence" = GREATEST("V2ResearchEmailPattern"."confidence", EXCLUDED."confidence"),
        "sampleCount" = "V2ResearchEmailPattern"."sampleCount" + EXCLUDED."sampleCount",
        "sourceJson" = COALESCE(EXCLUDED."sourceJson", "V2ResearchEmailPattern"."sourceJson"),
        "lastSeenAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
  `;
}

export function buildResearchEvidenceKey(parts: Array<string | number | null | undefined>): string {
  return parts.map((part) => String(part ?? "_").trim().toLowerCase().replace(/\s+/g, "-")).join(":").slice(0, 480);
}

function toJson(value: JsonValue | undefined): string {
  return JSON.stringify(value ?? null);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
}
