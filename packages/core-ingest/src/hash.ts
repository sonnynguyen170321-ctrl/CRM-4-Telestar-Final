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
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized;
}

function normalizeHashPart(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim().replace(/\s+/g, " ");
}
