import { createHash } from "node:crypto";

export function computeSourceRowHash(input: {
  headers: string[];
  values: unknown[];
}) {
  const normalized = input.headers.map((header, index) => [
    normalizeHashPart(header),
    normalizeHashPart(input.values[index]),
  ]);

  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

export function normalizeHeaderName(value: unknown) {
  const normalized = normalizeHashPart(value)
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[^a-z0-9]+/g, "_");

  return trimUnderscores(normalized);
}

/**
 * Strip leading/trailing underscores with index scans rather than `/^_+|_+$/`.
 * The anchored `_+$` form backtracks quadratically on a long run of underscores
 * that is not at the very end \u2014 header text is user-supplied, so the input is
 * uncontrolled (CodeQL js/polynomial-redos).
 */
export function trimUnderscores(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 95 /* _ */) start++;
  while (end > start && value.charCodeAt(end - 1) === 95) end--;
  return value.slice(start, end);
}

function normalizeHashPart(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim().replace(/\s+/g, " ");
}
