import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";

export type PrefillRequirement = {
  targetTitles: string[];
  targetCountries: string[];
  targetIndustries: string[];
  companySizeMin: number | null;
  companySizeMax: number | null;
};

const dedupe = (values: readonly string[]) =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

/** Seed a new ICP's rules from what the client asked for. Only fills what the requirement states. */
export function applyRequirementPrefill(
  rules: IcpVersionRulesV2,
  requirement: PrefillRequirement | null,
): IcpVersionRulesV2 {
  if (!requirement) return rules;
  const next = structuredClone(rules);
  const titles = dedupe(requirement.targetTitles);
  const countries = dedupe(requirement.targetCountries);
  const industries = dedupe(requirement.targetIndustries);
  if (titles.length) next.persona.titleAllowlist = titles;
  if (countries.length) next.geography.targetCountries = countries;
  if (industries.length) {
    next.industry.targetIndustries = industries;
    next.industry.mode = "allowlist";
  }
  if (requirement.companySizeMin != null) next.size.minEmployees = requirement.companySizeMin;
  if (requirement.companySizeMax != null) next.size.maxEmployees = requirement.companySizeMax;
  return next;
}
