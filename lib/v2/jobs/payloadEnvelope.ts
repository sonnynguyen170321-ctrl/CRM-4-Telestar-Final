import { createHash } from "node:crypto";

import { createNonRetryableJobError } from "./errors";

const PAYLOAD_ENVELOPE_SCHEMA_VERSION = 1;

export type V2JobPayloadEnvelope = {
  payload: unknown;
  meta: {
    payloadHash: string;
    schemaVersion: 1;
  };
};

export function createPayloadEnvelope(payload: unknown): V2JobPayloadEnvelope {
  return {
    payload,
    meta: {
      payloadHash: hashPayload(payload),
      schemaVersion: PAYLOAD_ENVELOPE_SCHEMA_VERSION,
    },
  };
}

export function hashPayload(payload: unknown) {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function parsePayloadEnvelope(snapshot: unknown):
  | { ok: true; envelope: V2JobPayloadEnvelope }
  | { ok: false; reason: string } {
  if (!isRecord(snapshot)) {
    return { ok: false, reason: "Payload snapshot is not an object." };
  }

  const meta = snapshot.meta;

  if (!isRecord(meta)) {
    return { ok: false, reason: "Payload envelope meta is missing." };
  }

  if (meta.schemaVersion !== PAYLOAD_ENVELOPE_SCHEMA_VERSION) {
    return { ok: false, reason: "Payload envelope schema version is unsupported." };
  }

  if (typeof meta.payloadHash !== "string" || !meta.payloadHash) {
    return { ok: false, reason: "Payload envelope hash is missing." };
  }

  const payload = snapshot.payload;
  const expectedHash = hashPayload(payload);

  if (meta.payloadHash !== expectedHash) {
    return { ok: false, reason: "Payload envelope hash does not match payload." };
  }

  return {
    ok: true,
    envelope: {
      payload,
      meta: {
        payloadHash: meta.payloadHash,
        schemaVersion: PAYLOAD_ENVELOPE_SCHEMA_VERSION,
      },
    },
  };
}

export function requirePayloadEnvelope(snapshot: unknown) {
  const parsed = parsePayloadEnvelope(snapshot);

  if (!parsed.ok) {
    throw createNonRetryableJobError(
      "MALFORMED_PAYLOAD_ENVELOPE",
      parsed.reason
    );
  }

  return parsed.envelope;
}

export function stableStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw createNonRetryableJobError(
        "PAYLOAD_VALIDATION_FAILED",
        "Payload contains a non-finite number."
      );
    }

    return JSON.stringify(value);
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => {
      const entry = value[key];

      if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") {
        throw createNonRetryableJobError(
          "PAYLOAD_VALIDATION_FAILED",
          `Payload contains unsupported value at key '${key}'.`
        );
      }

      return `${JSON.stringify(key)}:${stableStringify(entry)}`;
    });

    return `{${entries.join(",")}}`;
  }

  throw createNonRetryableJobError(
    "PAYLOAD_VALIDATION_FAILED",
    "Payload contains unsupported JSON value."
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
