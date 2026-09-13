import type { DimensionHit, DimensionResult, NormalizedScoringEvidence } from "../evidence";
import type { IcpVersionRulesV2 } from "../schema-v2";
import { expandRegionsToCountries } from "../dictionaries/regions";
import { foldText } from "../normalize/normalizeCountry";

// SC2: geo dimension. Country/region fit + priority-tier bonus + required-office.
// Excluded countries are handled by the terminal gate, not here. Pure.

export function geoScore(
  evidence: NormalizedScoringEvidence,
  rules: IcpVersionRulesV2
): DimensionResult {
  const { geography } = rules;
  const hits: DimensionHit[] = [];
  const missingEvidence: string[] = [];

  const allowed = new Set(
    [
      ...geography.targetCountries,
      ...expandRegionsToCountries(geography.targetRegions),
    ].map((country) => foldText(country))
  );
  const hasGeoConstraint =
    allowed.size > 0 || geography.requiredOfficeCountries.length > 0;

  if (!hasGeoConstraint) {
    return { dimension: "geo", score: 70, hits, missingEvidence };
  }

  const country = evidence.company.country;

  if (!evidence.company.countryKnown || !country) {
    missingEvidence.push("geo_unknown");
    const policyScore =
      geography.unknownCountryPolicy === "fail"
        ? 0
        : geography.unknownCountryPolicy === "soft_penalty"
        ? 40
        : 50;
    return { dimension: "geo", score: policyScore, hits, missingEvidence };
  }

  let score: number;
  const foldedCountry = foldText(country);

  if (allowed.size === 0 || allowed.has(foldedCountry)) {
    score = 100;
    hits.push({
      id: "geo_target_match",
      label: `In target geography (${country})`,
      reasonCode: "target_geo_match_explicit",
    });

    for (const tier of geography.priorityTiers) {
      if (tier.countries.map((c) => foldText(c)).includes(foldedCountry)) {
        score = Math.min(100, score + tier.weightBonus);
        hits.push({
          id: `geo_priority_tier_${tier.tier}`,
          label: `Priority tier ${tier.tier} geography`,
          reasonCode: "target_geo_priority_tier",
        });
        break;
      }
    }
  } else {
    score = 10;
    hits.push({
      id: "geo_outside_target",
      label: `Outside target geography (${country})`,
      reasonCode: "target_geo_mismatch_explicit",
    });
  }

  // Required office/factory location (STS: factory in Vietnam).
  if (geography.requiredOfficeCountries.length > 0) {
    const requiredOffices = new Set(
      geography.requiredOfficeCountries.map((c) => foldText(c))
    );
    const hasRequiredOffice = evidence.company.officeCountries.some((office) =>
      requiredOffices.has(foldText(office))
    );

    if (hasRequiredOffice) {
      hits.push({
        id: "geo_required_office_present",
        label: "Has office/factory in required location",
        reasonCode: "required_office_present",
      });
    } else {
      score = Math.min(score, 30);
      missingEvidence.push("required_office_missing");
    }
  }

  return { dimension: "geo", score, hits, missingEvidence };
}
