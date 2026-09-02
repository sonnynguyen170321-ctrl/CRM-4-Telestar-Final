import { z } from "zod";

export const AI_COMPANY_ICP_PROMPT_VERSION = "ai-company-icp-v1";

export const companyIcpInsightSchema = z.object({
  targetCustomerSegment: z.string().trim().min(1).max(500),
  targetVerticals: z.array(z.string().trim().min(1).max(80)).max(8),
  buyerPersonas: z.array(z.string().trim().min(1).max(80)).max(8),
  useCasesPainPoints: z.array(z.string().trim().min(1).max(120)).max(8),
  sdrMessagingAngle: z.string().trim().min(1).max(700),
  confidence: z.coerce.number().min(0).max(1),
  evidenceNote: z.string().trim().min(1).max(700),
});

export type CompanyIcpInsightOutput = z.infer<typeof companyIcpInsightSchema>;

export const companyIcpInsightResponseSchema = {
  type: "OBJECT",
  properties: {
    targetCustomerSegment: { type: "STRING" },
    targetVerticals: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    buyerPersonas: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    useCasesPainPoints: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    sdrMessagingAngle: { type: "STRING" },
    confidence: { type: "NUMBER" },
    evidenceNote: { type: "STRING" },
  },
  required: [
    "targetCustomerSegment",
    "targetVerticals",
    "buyerPersonas",
    "useCasesPainPoints",
    "sdrMessagingAngle",
    "confidence",
    "evidenceNote",
  ],
};

export function buildCompanyIcpPrompts(input: unknown) {
  return {
    systemPrompt: [
      "You create concise Company ICP insight for SDR outreach.",
      "Company ICP means the company's own likely customer profile, not TeleStar's ICP.",
      "Use only the compact company fields, summarized website evidence, local rule result, AI assessment, and SDR feedback context provided.",
      "Do not invent private data, named customers, funding facts, or claims that are not supported by the evidence.",
      "If evidence is weak, state that clearly, use low confidence, and recommend manual review.",
      "Keep the output short, practical, and useful for writing outbound messaging.",
      "Return JSON only. Do not include markdown fences or commentary.",
      "Return exactly one JSON object with these keys: targetCustomerSegment, targetVerticals, buyerPersonas, useCasesPainPoints, sdrMessagingAngle, confidence, evidenceNote.",
    ].join("\n"),
    userPrompt: JSON.stringify(input, null, 2),
  };
}

export function parseCompanyIcpInsightOutput(text: string) {
  const parsedJson = JSON.parse(extractJsonObject(text)) as unknown;
  const parsed = companyIcpInsightSchema.parse(parsedJson);

  return {
    targetCustomerSegment: parsed.targetCustomerSegment,
    targetVerticals: parsed.targetVerticals,
    buyerPersonas: parsed.buyerPersonas,
    useCasesPainPoints: parsed.useCasesPainPoints,
    sdrMessagingAngle: parsed.sdrMessagingAngle,
    confidence: clamp(parsed.confidence, 0, 1),
    evidenceNote: parsed.evidenceNote,
  } satisfies CompanyIcpInsightOutput;
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
