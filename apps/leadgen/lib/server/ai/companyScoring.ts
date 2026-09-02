import { z } from "zod";

import {
  companyTypeValues,
  isCompanyTypeValue,
  isQualificationValue,
  qualificationValues,
} from "@/lib/server/api/enums";

export const AI_COMPANY_SCORING_PROMPT_VERSION = "ai-company-scorer-v1";

export const aiCompanyScoringSchema = z.object({
  qualification: z.enum(qualificationValues),
  companyType: z.enum(companyTypeValues),
  companyScore: z.coerce.number().min(0).max(100),
  confidence: z.coerce.number().min(0).max(1),
  reason: z.string().trim().min(1).max(300),
  oneSentenceCompanySummary: z.string().trim().min(1).max(250),
  icpSegment: z.string().trim().max(80).optional().nullable(),
  outreachAngle: z.string().trim().max(180).optional().nullable(),
  evidenceSummary: z.string().trim().max(250).optional().nullable(),
});

export type AiCompanyScoringOutput = z.infer<typeof aiCompanyScoringSchema>;

export const aiCompanyScoringResponseSchema = {
  type: "OBJECT",
  properties: {
    qualification: {
      type: "STRING",
      enum: qualificationValues,
    },
    companyType: {
      type: "STRING",
      enum: companyTypeValues,
    },
    companyScore: {
      type: "INTEGER",
    },
    confidence: {
      type: "NUMBER",
    },
    reason: {
      type: "STRING",
    },
    oneSentenceCompanySummary: {
      type: "STRING",
    },
    icpSegment: {
      type: "STRING",
    },
    outreachAngle: {
      type: "STRING",
    },
    evidenceSummary: {
      type: "STRING",
    },
  },
  required: [
    "qualification",
    "companyType",
    "companyScore",
    "confidence",
    "reason",
    "oneSentenceCompanySummary",
  ],
};

export function buildAiCompanyScoringPrompts(input: unknown) {
  return {
    systemPrompt: [
      "You are scoring B2B company fit for TeleStar.",
      "Use only the compact company fields, local rule result, and website evidence provided.",
      "Do not guess beyond available evidence. Prefer uncertain when evidence is weak.",
      "Services, consulting, agency, outsourcing, or B2C-only companies should be Not Relevant and usually unqualified when clear.",
      "Product-led SaaS, cloud, API, AI, data, security, or platform companies may be qualified when evidence supports it.",
      "Return JSON only. Do not include markdown fences or commentary.",
      `Allowed companyType values: ${companyTypeValues.join(", ")}.`,
      `Allowed qualification values: ${qualificationValues.join(", ")}.`,
      "Keep reason under 300 characters. Keep summary under 250 characters.",
      "Optional fields: icpSegment under 80 characters, outreachAngle under 180 characters, evidenceSummary under 250 characters.",
      "Return exactly one JSON object with these keys: qualification, companyType, companyScore, confidence, reason, oneSentenceCompanySummary, icpSegment, outreachAngle, evidenceSummary.",
      "Example shape: {\"qualification\":\"uncertain\",\"companyType\":\"SAAS\",\"companyScore\":55,\"confidence\":0.55,\"reason\":\"short reason\",\"oneSentenceCompanySummary\":\"one sentence\",\"icpSegment\":\"B2B SaaS teams\",\"outreachAngle\":\"Ask about platform growth\",\"evidenceSummary\":\"Product and API signals found\"}",
    ].join("\n"),
    userPrompt: JSON.stringify(input, null, 2),
  };
}

export function parseAiCompanyScoringOutput(text: string) {
  const parsedJson = JSON.parse(extractJsonObject(text)) as unknown;
  const parsed = aiCompanyScoringSchema.parse(parsedJson);

  return {
    qualification: parsed.qualification,
    companyType: parsed.companyType,
    companyScore: clamp(Math.round(parsed.companyScore), 0, 100),
    confidence: clamp(parsed.confidence, 0, 1),
    reason: parsed.reason,
    oneSentenceCompanySummary: parsed.oneSentenceCompanySummary,
    icpSegment: parsed.icpSegment ?? null,
    outreachAngle: parsed.outreachAngle ?? null,
    evidenceSummary: parsed.evidenceSummary ?? null,
  } satisfies AiCompanyScoringOutput;
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenceMatch?.[1]?.trim() ?? trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("AI response did not include a JSON object.");
  }

  return candidate.slice(firstBrace, lastBrace + 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function validateAiLabels({
  companyType,
  qualification,
}: {
  companyType: string;
  qualification: string;
}) {
  if (!isCompanyTypeValue(companyType)) {
    throw new Error("AI response included an invalid company type.");
  }

  if (!isQualificationValue(qualification)) {
    throw new Error("AI response included an invalid qualification.");
  }
}
