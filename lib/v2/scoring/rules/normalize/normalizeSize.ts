import { resolveSizeBand, qualitativeSizeToBand } from "../dictionaries/sizeBands";
import type { SizeBandKey } from "../dictionaries/sizeBands";

// SC2: raw size evidence -> { employeeCount, band, known }.
// Prefers explicit headcount; falls back to a qualitative phrase. Pure.

export type NormalizedSize = {
  employeeCount: number | null;
  sizeBand: SizeBandKey | null;
  sizeKnown: boolean;
};

export function normalizeSize(
  employeeCount: number | undefined | null,
  employeeRange: string | undefined | null
): NormalizedSize {
  if (typeof employeeCount === "number" && Number.isFinite(employeeCount) && employeeCount >= 1) {
    const band = resolveSizeBand(employeeCount);
    return { employeeCount, sizeBand: band, sizeKnown: true };
  }

  const qualitativeBand = qualitativeSizeToBand(employeeRange ?? "");
  if (qualitativeBand) {
    return { employeeCount: null, sizeBand: qualitativeBand, sizeKnown: true };
  }

  return { employeeCount: null, sizeBand: null, sizeKnown: false };
}
