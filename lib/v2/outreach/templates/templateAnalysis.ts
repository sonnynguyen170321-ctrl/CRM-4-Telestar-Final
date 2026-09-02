import { CAMPAIGN_MERGE_VARIABLES } from "@/lib/v2/outreach/campaigns/mergeVariables";

export type TemplateAnalysis = {
  usedVariables: string[];
  requiredVariables: string[];
  missingRequiredVariables: string[];
  unknownVariables: string[];
  unusedRequiredVariables: string[];
  warnings: string[];
  score: number;
};

const KNOWN_VARIABLES = new Set(CAMPAIGN_MERGE_VARIABLES.map((variable) => variable.key));
const VARIABLE_PATTERN = /{{\s*([^{}]+?)\s*}}/g;

export function extractTemplateVariables(source: string): string[] {
  const variables = new Set<string>();
  let match: RegExpExecArray | null;
  VARIABLE_PATTERN.lastIndex = 0;
  while ((match = VARIABLE_PATTERN.exec(source)) !== null) {
    const key = normalizeLiquidVariable(match[1] ?? "");
    if (key) variables.add(key);
  }
  return Array.from(variables).sort((a, b) => a.localeCompare(b));
}

export function analyzeTemplate(input: {
  subjectTemplate: string;
  bodyTemplate: string;
  requiredVariables: readonly string[];
}): TemplateAnalysis {
  const subject = input.subjectTemplate.trim();
  const body = input.bodyTemplate.trim();
  const requiredVariables = Array.from(new Set(input.requiredVariables.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const usedVariables = extractTemplateVariables(`${subject}\n${body}`);
  const used = new Set(usedVariables);
  const warnings: string[] = [];

  if (!subject) warnings.push("Subject is empty.");
  if (!body) warnings.push("Body is empty.");
  if (subject.length > 90) warnings.push("Subject is longer than 90 characters.");
  if (body && !/\b(hi|hello|dear|chao|xin chao)\b/i.test(body)) warnings.push("No clear greeting detected.");
  if (body && !/(\?|\b(call|meet|meeting|conversation|reply|join|connect|chat)\b)/i.test(body)) warnings.push("No clear call to action detected.");

  const missingRequiredVariables = requiredVariables.filter((variable) => !used.has(variable));
  const unusedRequiredVariables = missingRequiredVariables;
  const unknownVariables = usedVariables.filter((variable) => !KNOWN_VARIABLES.has(variable) && !variable.startsWith("custom."));

  let score = 100;
  score -= warnings.length * 12;
  score -= unknownVariables.length * 10;
  score -= missingRequiredVariables.length * 8;
  score = Math.max(0, Math.min(100, score));

  return {
    usedVariables,
    requiredVariables,
    missingRequiredVariables,
    unknownVariables,
    unusedRequiredVariables,
    warnings,
    score,
  };
}

function normalizeLiquidVariable(expression: string): string | null {
  const first = expression.split("|")[0]?.trim() ?? "";
  const cleaned = first.replace(/^assign\s+/, "").replace(/\s.*$/, "").replace(/\[['\"]?([^'\"\]]+)['\"]?\]/g, ".$1");
  if (!cleaned || cleaned.includes("=") || /^['\"0-9]/.test(cleaned)) return null;
  return cleaned;
}
