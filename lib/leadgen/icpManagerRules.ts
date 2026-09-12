import { SIZE_BAND_MAP } from "@telestar/core-scoring/rules/dictionaries/sizeBands";
import { emptyIcpRulesV2 } from "@telestar/core-scoring/rules/emptyIcpRulesV2";
import {
  validateIcpVersionRulesV2,
  type IcpVersionRulesV2,
} from "@telestar/core-scoring/rules/schema-v2";

export function managerSimplificationNotes(rulesJson: unknown): string[] {
  const rules = validateIcpVersionRulesV2(rulesJson);
  const notes: string[] = [];
  const note = (condition: boolean, message: string) => {
    if (condition) notes.push(message);
  };

  note(
    rules.geography.targetRegions.length > 0 ||
      rules.geography.requiredOfficeCountries.length > 0 ||
      rules.geography.excludedOfficeCountries.length > 0 ||
      rules.geography.priorityTiers.length > 0 ||
      rules.geography.subNationalRegions.length > 0,
    "Regional and office-location rules will be removed",
  );
  note(
    rules.industry.industryKeywords.length > 0 ||
      rules.industry.subIndustries.length > 0,
    "Industry keywords and sub-industries will be folded into the visible industry rule",
  );
  note(
    rules.companyType.allow.length > 0 ||
      rules.companyType.deny.length > 0 ||
      rules.companyType.servicesConsultingPolicy.disqualify,
    "Company-type rules will be removed",
  );
  note(
    rules.persona.titleTiers.length > 0 ||
      rules.persona.titleKeywords.length > 0,
    "Title tiers and keywords will be folded into accepted buyer titles",
  );
  note(
    rules.persona.seniorityExclusions.length > 0 ||
      rules.persona.departmentAllowlist.length > 0 ||
      Object.keys(rules.persona.departmentSeniorityOverrides).length > 0 ||
      Object.keys(rules.persona.languageVariants).length > 0 ||
      rules.persona.requirePersonaForFinalQualification,
    "Department, localized-title, or advanced persona rules will be removed",
  );
  note(
    rules.size.sizeBands.length > 0,
    "Size bands will be converted to one inclusive employee range",
  );
  note(
    rules.size.minRevenueUsd != null ||
      rules.size.multiLocationOk === true ||
      rules.size.excludeTooSmall === true,
    "Revenue and advanced company-size rules will be removed",
  );
  note(
    rules.disqualifiers.genericEmailContact.disqualify ||
      rules.disqualifiers.onePersonCompany.disqualify ||
      rules.disqualifiers.websiteOffline.disqualify ||
      rules.disqualifiers.projectBased.disqualify ||
      rules.disqualifiers.competitorDenylist.length > 0,
    "Advanced automatic exclusions will be removed",
  );
  note(
    rules.accountSupplied.mode !== "score" ||
      rules.accountSupplied.companyList.length > 0,
    "Account-supplied list rules will be removed",
  );
  note(
    Object.values(rules.requiredEvidenceForFinalQualification).some(Boolean),
    "Advanced required-evidence flags will be removed",
  );
  note(Boolean(rules.subIcps?.length), "Sub-ICPs will be removed");
  note(Boolean(rules.negativeSignals?.length), "Negative signals will be removed");
  return notes;
}

export function normalizeManagerRules(
  rulesJson: unknown,
): IcpVersionRulesV2 {
  const source = validateIcpVersionRulesV2(rulesJson);
  const rules = emptyIcpRulesV2(source.ruleSetId, source.displayName);

  rules.geography.targetCountries = [...source.geography.targetCountries];
  rules.geography.excludedCountries = [...source.geography.excludedCountries];
  rules.industry.mode = source.industry.mode;
  rules.industry.targetIndustries = [...source.industry.targetIndustries];
  rules.industry.excludedIndustries = [...source.industry.excludedIndustries];

  rules.persona.titleAllowlist = Array.from(
    new Set([
      ...source.persona.titleAllowlist,
      ...source.persona.titleKeywords,
      ...source.persona.titleTiers.flatMap((tier) => [
        ...tier.titles,
        ...tier.keywords,
      ]),
    ]),
  );
  rules.persona.titleDenylist = [...source.persona.titleDenylist];
  rules.persona.seniorityFloor = source.persona.seniorityFloor;

  const bandRanges = source.size.sizeBands.map(
    (band) => SIZE_BAND_MAP[band as keyof typeof SIZE_BAND_MAP],
  );
  rules.size.minEmployees =
    source.size.minEmployees ??
    (bandRanges.length
      ? Math.min(...bandRanges.map((range) => range.minEmployees))
      : undefined);
  rules.size.maxEmployees =
    source.size.maxEmployees ??
    (bandRanges.length && bandRanges.every((range) => range.maxEmployees != null)
      ? Math.max(...bandRanges.map((range) => range.maxEmployees ?? 0))
      : undefined);

  return validateIcpVersionRulesV2(rules);
}