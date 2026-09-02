import { createHash } from "node:crypto";

export type WeightedVariant = { id: string; weight: number };

export function assignDeterministicVariant(input: {
  organizationId: string;
  campaignId: string;
  enrollmentId: string;
  stepId: string;
  variants: readonly WeightedVariant[];
}): WeightedVariant {
  const variants = input.variants.filter((variant) => variant.weight > 0);
  if (variants.length === 0) throw new Error("At least one positive-weight variant is required.");
  const totalWeight = variants.reduce((sum, variant) => sum + variant.weight, 0);
  const digest = createHash("sha256")
    .update([input.organizationId, input.campaignId, input.enrollmentId, input.stepId].join(":"))
    .digest();
  let bucket = digest.readUInt32BE(0) % totalWeight;
  for (const variant of variants) {
    if (bucket < variant.weight) return variant;
    bucket -= variant.weight;
  }
  return variants[variants.length - 1];
}