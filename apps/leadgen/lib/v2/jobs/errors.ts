import type { JsonObject } from "./types";

const MAX_ERROR_MESSAGE_LENGTH = 500;
const SECRET_KEY_PATTERN =
  /(api[_-]?key|authorization|cookie|database[_-]?url|db[_-]?url|password|secret|token)/i;

export class V2JobError extends Error {
  readonly errorCode: string;
  readonly retryable: boolean;
  readonly metadata: JsonObject;

  constructor(input: {
    errorCode: string;
    message: string;
    retryable: boolean;
    metadata?: JsonObject;
  }) {
    super(input.message);
    this.name = "V2JobError";
    this.errorCode = input.errorCode;
    this.retryable = input.retryable;
    this.metadata = input.metadata ?? {};
  }
}

export function createRetryableJobError(
  errorCode: string,
  message: string,
  metadata?: JsonObject
) {
  return new V2JobError({ errorCode, message, retryable: true, metadata });
}

export function createNonRetryableJobError(
  errorCode: string,
  message: string,
  metadata?: JsonObject
) {
  return new V2JobError({ errorCode, message, retryable: false, metadata });
}

export function serializeJobError(error: unknown, metadata: JsonObject = {}) {
  const jobError = error instanceof V2JobError ? error : null;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "V2 job failed.";
  const retryable = jobError?.retryable ?? true;
  const errorCode = jobError?.errorCode ?? "JOB_RUNTIME_ERROR";
  const safeMetadata = toJsonSafe({
    ...(jobError?.metadata ?? {}),
    ...metadata,
  });

  return {
    errorCode,
    errorMessage: truncate(redactString(message), MAX_ERROR_MESSAGE_LENGTH),
    retryable,
    metadata: safeMetadata,
  };
}

export function toJsonSafe(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[MaxDepth]";
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return typeof value === "string" ? redactString(value) : value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => toJsonSafe(entry, depth + 1));
  }

  if (typeof value === "object") {
    const output: JsonObject = {};

    for (const [key, entry] of Object.entries(value as JsonObject).slice(0, 30)) {
      output[key] = SECRET_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : toJsonSafe(entry, depth + 1);
    }

    return output;
  }

  return String(value);
}

function redactString(value: string) {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/(api[_-]?key|token|secret|password)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s"]+/gi, "postgres://[REDACTED]");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
