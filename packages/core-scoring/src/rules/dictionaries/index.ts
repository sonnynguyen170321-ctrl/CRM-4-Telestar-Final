// SC1 reference dictionaries barrel + version manifest.
//
// DICTIONARY_VERSIONS is snapshotted into the scoring fingerprint so a dictionary
// data bump triggers a clean rescore (plan 4c.5/4c.6). Pure data only.
//
// NOTE: explicit per-file re-exports (no bare directory imports) keep this barrel
// loadable by the smoke-script TS loader, which resolves `./x` -> `./x.ts`.

export * from "./regions";
export * from "./genericEmail";
export * from "./seniority";
export * from "./industry";
export * from "./sizeBands";

import { REGIONS_DICTIONARY_VERSION } from "./regions";
import { GENERIC_EMAIL_DICTIONARY_VERSION } from "./genericEmail";
import { SENIORITY_DICTIONARY_VERSION } from "./seniority";
import { INDUSTRY_DICTIONARY_VERSION } from "./industry";
import { SIZE_BANDS_DICTIONARY_VERSION } from "./sizeBands";

export type DictionaryVersions = {
  regions: string;
  genericEmail: string;
  seniority: string;
  industry: string;
  sizeBands: string;
};

/** Current versions of every reference dictionary, in deterministic key order. */
export const DICTIONARY_VERSIONS: DictionaryVersions = {
  regions: REGIONS_DICTIONARY_VERSION,
  genericEmail: GENERIC_EMAIL_DICTIONARY_VERSION,
  seniority: SENIORITY_DICTIONARY_VERSION,
  industry: INDUSTRY_DICTIONARY_VERSION,
  sizeBands: SIZE_BANDS_DICTIONARY_VERSION,
};
