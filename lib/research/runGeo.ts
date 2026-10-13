import { builderParamsToRulesV2, resolveCountry } from '@telestar/core-research/rulesFromParams';
import type { ResearchBuilderParams } from '@telestar/core-research/buildDiscoveryQueries';

/**
 * The countries a research run targets, as canonical names, and whether they may REJECT a person.
 *
 * `geoGate` is false when any geography could not be placed (a region name, an unknown place) or the run
 * said Worldwide: a rejection against a PARTIAL country list would delete real prospects. The same rule
 * company verification uses (`BuilderRules.geoGate`), so a company and a person are held to one definition
 * of "the target countries".
 */
export type RunGeo = { targetCountries: string[]; geoGate: boolean };

const NO_GEO: RunGeo = { targetCountries: [], geoGate: false };

export function runGeoFrom(paramsJson: unknown, icpRulesJson: unknown): RunGeo {
  const params = paramsJson as (Partial<ResearchBuilderParams> & Record<string, unknown>) | null;
  try {
    if (params && Array.isArray(params.industries)) {
      const built = builderParamsToRulesV2(params as ResearchBuilderParams, 'geo');
      const targetCountries = built.rules.geography.targetCountries;
      return { targetCountries, geoGate: built.geoGate && targetCountries.length > 0 };
    }
    const geography = (icpRulesJson as { geography?: { targetCountries?: unknown; targetRegions?: unknown } } | null)?.geography;
    const raw = Array.isArray(geography?.targetCountries) ? (geography!.targetCountries as unknown[]) : [];
    const countries = raw.map((c) => (typeof c === 'string' ? resolveCountry(c) : null));
    const regions = Array.isArray(geography?.targetRegions) ? (geography!.targetRegions as unknown[]) : [];
    const targetCountries = countries.filter((c): c is string => c !== null);
    // Every listed country resolved, and no region stands in for countries we do not list.
    return { targetCountries, geoGate: targetCountries.length > 0 && targetCountries.length === raw.length && regions.length === 0 };
  } catch (error) {
    // Unreadable rules never reject anyone.
    console.error('[research] could not read the run geography', { error });
    return NO_GEO;
  }
}
