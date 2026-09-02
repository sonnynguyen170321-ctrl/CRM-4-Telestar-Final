import type {
  HardGateEvaluation,
  HardGateEvaluationResult,
  HardGatePolicyAction,
  HardGatePolicyResult,
  HardGateRule,
  NormalizedScoringContext,
  RuleOperator,
  RuleSeverity,
  UnknownDataPolicy,
} from "./types";

const POLICY_ACTION_RANK: Record<HardGatePolicyAction, number> = {
  none: 0,
  low_confidence_continue: 1,
  review_required: 2,
  soft_penalty: 3,
  strong_penalty: 4,
  terminal: 5,
};

export function evaluateHardGates(
  context: NormalizedScoringContext
): HardGateEvaluation {
  const results = context.icpRules.hardGates.map((rule) =>
    evaluateHardGateRule(rule, context)
  );
  const policyResults = [evaluateMissingWebsitePolicy(context)];
  const activePolicyResults = policyResults.filter(
    (result) => result.outcome === "policy_applied"
  );
  const triggeredResults = results.filter((result) => result.triggered);
  const missingDataResults = results.filter(
    (result) => result.outcome === "missing_data"
  );
  const allActions = [
    ...triggeredResults.map((result) => result.policyAction),
    ...missingDataResults.map((result) => result.policyAction),
    ...activePolicyResults.map((result) => result.policyAction),
  ];
  const strongestPolicyAction = allActions.reduce<HardGatePolicyAction>(
    (strongest, action) =>
      POLICY_ACTION_RANK[action] > POLICY_ACTION_RANK[strongest]
        ? action
        : strongest,
    "none"
  );

  return {
    results,
    policyResults,
    summary: {
      triggeredCount: triggeredResults.length,
      missingDataCount: missingDataResults.length,
      terminalCount:
        triggeredResults.filter((result) => result.policyAction === "terminal")
          .length +
        activePolicyResults.filter((result) => result.policyAction === "terminal")
          .length,
      reviewRequired:
        allActions.includes("review_required") ||
        allActions.includes("strong_penalty") ||
        allActions.includes("terminal"),
      strongestPolicyAction,
      triggeredRuleIds: triggeredResults.map((result) => result.ruleId),
      missingDataRuleIds: missingDataResults.map((result) => result.ruleId),
    },
  };
}

function evaluateHardGateRule(
  rule: HardGateRule,
  context: NormalizedScoringContext
): HardGateEvaluationResult {
  const actualValue = resolveRuleFieldValue(rule.field, context);
  const hasActualValue = isKnownValue(actualValue);

  if (!hasActualValue) {
    return buildHardGateResult(rule, {
      actualValue,
      outcome: "missing_data",
      triggered: false,
      policyAction: mapMissingDataPolicyToAction(rule.missingDataPolicy),
    });
  }

  const triggered = compareRuleValue(rule.operator, actualValue, rule.value);

  return buildHardGateResult(rule, {
    actualValue,
    outcome: triggered ? "triggered" : "not_triggered",
    triggered,
    policyAction: triggered ? mapSeverityToAction(rule.severity) : "none",
  });
}

function evaluateMissingWebsitePolicy(
  context: NormalizedScoringContext
): HardGatePolicyResult {
  if (context.company.canonicalDomain) {
    return {
      policyId: "missing_website",
      label: "Missing website policy",
      outcome: "not_applicable",
      policyAction: "none",
      reasonCode: "website_present",
    };
  }

  return {
    policyId: "missing_website",
    label: "Missing website policy",
    outcome: "policy_applied",
    policyAction: mapMissingWebsitePolicyToAction(
      context.icpRules.missingWebsitePolicy
    ),
    reasonCode: "missing_website_policy",
  };
}

function buildHardGateResult(
  rule: HardGateRule,
  result: {
    actualValue: unknown;
    outcome: HardGateEvaluationResult["outcome"];
    triggered: boolean;
    policyAction: HardGatePolicyAction;
  }
): HardGateEvaluationResult {
  const baseResult: HardGateEvaluationResult = {
    ruleId: rule.id,
    label: rule.label,
    field: rule.field,
    operator: rule.operator,
    actualValue: result.actualValue,
    outcome: result.outcome,
    triggered: result.triggered,
    severity: rule.severity,
    policyAction: result.policyAction,
    reasonCode: rule.reasonCode,
    missingDataPolicy: rule.missingDataPolicy,
  };

  if (rule.value !== undefined) {
    baseResult.expectedValue = rule.value;
  }

  if (rule.maxScoreIfTriggered !== undefined) {
    baseResult.maxScoreIfTriggered = rule.maxScoreIfTriggered;
  }

  return baseResult;
}

function resolveRuleFieldValue(
  field: string,
  context: NormalizedScoringContext
): unknown {
  switch (field) {
    case "companyName":
      return context.company.companyName;
    case "normalizedCompanyName":
      return context.company.normalizedCompanyName;
    case "website":
    case "canonicalDomain":
      return context.company.canonicalDomain;
    case "companyCountry":
      return context.company.normalizedCompanyCountry;
    case "companyIndustry":
      return context.company.normalizedCompanyIndustry;
    case "companyStaffCountRange":
      return context.company.companyStaffCountRange;
    case "employeeCount":
      return (
        context.company.staffRange.minEmployees ??
        context.company.staffRange.maxEmployees
      );
    case "emailDomainType":
      return context.contact?.emailDomainType;
    case "websiteStatus":
      return context.websiteEvidence.status;
    case "websiteQuality":
      return context.websiteEvidence.quality;
    case "hasProductEvidence":
      return (
        context.websiteEvidence.productSignals.length > 0 ||
        context.websiteEvidence.pricingSignals.length > 0 ||
        context.websiteEvidence.apiSignals.length > 0
      );
    case "hasServiceEvidence":
      return context.websiteEvidence.serviceSignals.length > 0;
    default:
      return undefined;
  }
}

function compareRuleValue(
  operator: RuleOperator,
  actualValue: unknown,
  expectedValue: unknown
): boolean {
  switch (operator) {
    case "equals":
      return normalizeComparableValue(actualValue) === normalizeComparableValue(expectedValue);
    case "not_equals":
      return normalizeComparableValue(actualValue) !== normalizeComparableValue(expectedValue);
    case "in":
      return Array.isArray(expectedValue)
        ? expectedValue
            .map((value) => normalizeComparableValue(value))
            .includes(normalizeComparableValue(actualValue))
        : false;
    case "not_in":
      return Array.isArray(expectedValue)
        ? !expectedValue
            .map((value) => normalizeComparableValue(value))
            .includes(normalizeComparableValue(actualValue))
        : false;
    case "contains":
      return String(actualValue)
        .toLowerCase()
        .includes(String(expectedValue ?? "").toLowerCase());
    case "not_contains":
      return !String(actualValue)
        .toLowerCase()
        .includes(String(expectedValue ?? "").toLowerCase());
    case "exists":
      return isKnownValue(actualValue);
    case "missing":
      return !isKnownValue(actualValue);
    case "lt":
      return compareNumber(actualValue, expectedValue, (actual, expected) => actual < expected);
    case "lte":
      return compareNumber(actualValue, expectedValue, (actual, expected) => actual <= expected);
    case "gt":
      return compareNumber(actualValue, expectedValue, (actual, expected) => actual > expected);
    case "gte":
      return compareNumber(actualValue, expectedValue, (actual, expected) => actual >= expected);
  }
}

function compareNumber(
  actualValue: unknown,
  expectedValue: unknown,
  compare: (actual: number, expected: number) => boolean
): boolean {
  const actual = Number(actualValue);
  const expected = Number(expectedValue);

  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return false;
  }

  return compare(actual, expected);
}

function mapSeverityToAction(severity: RuleSeverity): HardGatePolicyAction {
  if (severity === "terminal") {
    return "terminal";
  }

  if (severity === "strong_penalty") {
    return "strong_penalty";
  }

  if (severity === "soft_penalty") {
    return "soft_penalty";
  }

  return "review_required";
}

function mapMissingDataPolicyToAction(
  policy: UnknownDataPolicy
): HardGatePolicyAction {
  if (policy === "fail") {
    return "terminal";
  }

  if (policy === "soft_penalty") {
    return "soft_penalty";
  }

  if (policy === "low_confidence_continue") {
    return "low_confidence_continue";
  }

  return "review_required";
}

function mapMissingWebsitePolicyToAction(
  policy: NormalizedScoringContext["icpRules"]["missingWebsitePolicy"]
): HardGatePolicyAction {
  if (policy === "terminal") {
    return "terminal";
  }

  if (policy === "low_confidence_continue") {
    return "low_confidence_continue";
  }

  return "review_required";
}

function isKnownValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

function normalizeComparableValue(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ");
}
